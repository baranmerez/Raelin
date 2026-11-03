//! Workspace file I/O. A workspace is one `.raelin` file (JSON with boards and base64
//! pictures); the page parses and validates it, Rust only moves the bytes.
//!
//! The WebView never hands us a path we trust: workspace files and exports are picked
//! in native dialogs opened from Rust, and only those picks (plus the last workspace
//! file, remembered by Rust itself) end up in the `Allowed` list the commands check.

use std::collections::HashSet;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::UNIX_EPOCH;
use tauri::{AppHandle, Emitter, Manager, State};
use tauri_plugin_dialog::DialogExt;

const EXTENSION: &str = "raelin";
const LAST_FILE: &str = "last-workspace.txt";
/// Boards are small; this is room for many pictures of up to 10 MB each.
const MAX_WORKSPACE_BYTES: u64 = 256 * 1024 * 1024;

/// Paths the user approved in a native dialog during this run.
#[derive(Default)]
pub struct Allowed {
    /// Workspace files: may be read and written for the rest of the run.
    workspaces: Mutex<HashSet<PathBuf>>,
    /// Export targets; each one is consumed by a single write.
    files: Mutex<HashSet<PathBuf>>,
}

impl Allowed {
    fn allow_workspace(&self, path: &Path) -> Result<(), String> {
        if !is_workspace_path(path) {
            return Err(format!(
                "Yalnız .{EXTENSION} dosyası açılabilir veya kaydedilebilir."
            ));
        }
        lock(&self.workspaces)?.insert(path.to_path_buf());
        Ok(())
    }

    fn check_workspace(&self, path: &str) -> Result<PathBuf, String> {
        let path = PathBuf::from(path);
        if lock(&self.workspaces)?.contains(&path) {
            Ok(path)
        } else {
            Err("Bu dosyaya erişim izni yok; dosyayı yeniden seç.".into())
        }
    }

    fn take_file(&self, path: &str) -> Result<PathBuf, String> {
        let target = PathBuf::from(path);
        if lock(&self.files)?.remove(&target) {
            Ok(target)
        } else {
            Err("Bu dosyaya yazma izni yok; kaydetme yerini yeniden seç.".into())
        }
    }
}

/// Workspace file Raelin was started with (double-click in Explorer), handed out once.
#[derive(Default)]
pub struct LaunchFile(Mutex<Option<PathBuf>>);

impl LaunchFile {
    pub fn new(path: Option<PathBuf>) -> Self {
        Self(Mutex::new(path))
    }
}

/// Event that tells the page to open a workspace file passed to a second launch.
pub const OPEN_EVENT: &str = "workspace:open";

/// The first existing `.raelin` file among command-line arguments (program path excluded).
/// Relative paths are taken from `cwd`, the folder the launch came from.
pub fn workspace_arg(args: &[String], cwd: &Path) -> Option<PathBuf> {
    args.iter().skip(1).find_map(|arg| {
        let path = cwd.join(arg);
        (is_workspace_path(&path) && path.is_file()).then_some(path)
    })
}

/// A second launch with a file: approve it like a dialog pick and let the page open it.
pub fn open_from_second_launch(app: &AppHandle, args: &[String], cwd: &str) {
    let Some(path) = workspace_arg(args, Path::new(cwd)) else {
        return;
    };
    let state = app.state::<Allowed>();
    if state.allow_workspace(&path).is_ok() {
        let _ = app.emit(OPEN_EVENT, path.to_string_lossy().into_owned());
    }
}

fn lock<T>(m: &Mutex<T>) -> Result<std::sync::MutexGuard<'_, T>, String> {
    m.lock().map_err(|_| "İç durum kilitlenemedi.".to_string())
}

fn is_workspace_path(path: &Path) -> bool {
    path.is_absolute()
        && path
            .extension()
            .is_some_and(|ext| ext.eq_ignore_ascii_case(EXTENSION))
}

/// Decodes `encodeURIComponent` output; header values must be ASCII, file paths are not.
fn percent_decode(text: &str) -> Result<String, String> {
    let bytes = text.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%' {
            let hex = text.get(i + 1..i + 3).ok_or("Bozuk başlık değeri.")?;
            out.push(u8::from_str_radix(hex, 16).map_err(|_| "Bozuk başlık değeri.")?);
            i += 3;
        } else {
            out.push(bytes[i]);
            i += 1;
        }
    }
    String::from_utf8(out).map_err(|_| "Bozuk başlık değeri.".into())
}

/// Raw request body plus the percent-encoded `x-path` header.
fn raw_body_and_path<'a>(
    request: &'a tauri::ipc::Request<'_>,
) -> Result<(&'a [u8], String), String> {
    let tauri::ipc::InvokeBody::Raw(bytes) = request.body() else {
        return Err("Dosya baytları bekleniyordu.".into());
    };
    let path = request
        .headers()
        .get("x-path")
        .and_then(|v| v.to_str().ok())
        .ok_or("x-path başlığı eksik.")?;
    Ok((bytes, percent_decode(path)?))
}

/// Size and modification time: enough to notice that someone else changed the file.
fn stamp(path: &Path) -> Result<String, String> {
    let meta = fs::metadata(path).map_err(|e| format!("{}: {e}", path.display()))?;
    let modified = meta
        .modified()
        .ok()
        .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
        .map_or(0, |d| d.as_nanos());
    Ok(format!("{}:{modified}", meta.len()))
}

/// Write to a sibling temp file, then rename over the target, so a crash never
/// leaves a half-written file behind.
fn write_atomic(path: &Path, content: impl AsRef<[u8]>) -> Result<(), String> {
    let mut name = path
        .file_name()
        .ok_or_else(|| format!("Geçersiz dosya yolu: {}", path.display()))?
        .to_os_string();
    name.push(".tmp");
    let tmp = path.with_file_name(name);
    fs::write(&tmp, content).map_err(|e| format!("{}: {e}", tmp.display()))?;
    fs::rename(&tmp, path).map_err(|e| format!("{}: {e}", path.display()))
}

fn last_file_store(app: &AppHandle) -> Option<PathBuf> {
    app.path().app_config_dir().ok().map(|d| d.join(LAST_FILE))
}

/// Best effort: a missing config folder only means the next start shows the example.
fn remember_last_file(app: &AppHandle, path: &Path) {
    if let Some(store) = last_file_store(app) {
        if let Some(parent) = store.parent() {
            let _ = fs::create_dir_all(parent);
        }
        let _ = fs::write(store, path.to_string_lossy().as_bytes());
    }
}

/// Native open dialog for a workspace file. Blocking dialogs must not run on the main
/// thread, hence async.
#[tauri::command]
pub async fn pick_workspace_open(
    app: AppHandle,
    state: State<'_, Allowed>,
) -> Result<Option<String>, String> {
    let Some(picked) = app
        .dialog()
        .file()
        .set_title("Çalışma alanını aç")
        .add_filter("Raelin çalışma alanı", &[EXTENSION])
        .blocking_pick_file()
    else {
        return Ok(None);
    };
    let path = picked.into_path().map_err(|e| e.to_string())?;
    state.allow_workspace(&path)?;
    Ok(Some(path.to_string_lossy().into_owned()))
}

/// Native save dialog for a workspace file; the dialog itself asks before replacing one.
#[tauri::command]
pub async fn pick_workspace_save(
    app: AppHandle,
    state: State<'_, Allowed>,
    default_name: String,
) -> Result<Option<String>, String> {
    let Some(picked) = app
        .dialog()
        .file()
        .set_title("Çalışma alanını kaydet")
        .add_filter("Raelin çalışma alanı", &[EXTENSION])
        .set_file_name(default_name)
        .blocking_save_file()
    else {
        return Ok(None);
    };
    let path = picked.into_path().map_err(|e| e.to_string())?;
    state.allow_workspace(&path)?;
    Ok(Some(path.to_string_lossy().into_owned()))
}

/// The last workspace file Raelin itself read or wrote, re-approved for this run.
#[tauri::command]
pub fn last_workspace_file(app: AppHandle, state: State<'_, Allowed>) -> Option<String> {
    let text = fs::read_to_string(last_file_store(&app)?).ok()?;
    let path = PathBuf::from(text.trim());
    if !path.is_file() || state.allow_workspace(&path).is_err() {
        return None;
    }
    Some(path.to_string_lossy().into_owned())
}

/// The file Raelin was started with, approved for this run; `None` after the first call.
#[tauri::command]
pub fn launch_file(state: State<'_, Allowed>, launch: State<'_, LaunchFile>) -> Option<String> {
    let path = lock(&launch.0).ok()?.take()?;
    state.allow_workspace(&path).ok()?;
    Some(path.to_string_lossy().into_owned())
}

#[tauri::command]
pub fn is_workspace_allowed(state: State<'_, Allowed>, path: String) -> bool {
    state.check_workspace(&path).is_ok()
}

/// The file's stamp, or `None` when it does not exist (yet).
#[tauri::command]
pub fn probe_workspace_file(
    state: State<'_, Allowed>,
    path: String,
) -> Result<Option<String>, String> {
    let path = state.check_workspace(&path)?;
    if !path.exists() {
        return Ok(None);
    }
    stamp(&path).map(Some)
}

/// Raw UTF-8 bytes of a workspace file (no JSON round trip for large files).
#[tauri::command]
pub fn read_workspace_file(
    app: AppHandle,
    state: State<'_, Allowed>,
    path: String,
) -> Result<tauri::ipc::Response, String> {
    let path = state.check_workspace(&path)?;
    let meta = fs::metadata(&path).map_err(|e| format!("{}: {e}", path.display()))?;
    if meta.len() > MAX_WORKSPACE_BYTES {
        return Err(format!("Dosya çok büyük: {}", path.display()));
    }
    let bytes = fs::read(&path).map_err(|e| format!("{}: {e}", path.display()))?;
    remember_last_file(&app, &path);
    Ok(tauri::ipc::Response::new(bytes))
}

/// Writes a workspace file atomically and returns its new stamp. Raw body; the path
/// comes percent-encoded in `x-path`.
#[tauri::command]
pub fn write_workspace_file(
    app: AppHandle,
    state: State<'_, Allowed>,
    request: tauri::ipc::Request<'_>,
) -> Result<String, String> {
    let (bytes, path) = raw_body_and_path(&request)?;
    if bytes.len() as u64 > MAX_WORKSPACE_BYTES {
        return Err("Çalışma alanı 256 MB'tan büyük olamaz.".into());
    }
    let path = state.check_workspace(&path)?;
    write_atomic(&path, bytes)?;
    remember_last_file(&app, &path);
    stamp(&path)
}

/// Native save dialog for an export; the returned path may be written once, and only
/// when it has the expected extension.
fn pick_export(
    app: &AppHandle,
    state: &Allowed,
    default_name: String,
    label: &str,
    ext: &str,
) -> Result<Option<String>, String> {
    let Some(picked) = app
        .dialog()
        .file()
        .add_filter(label, &[ext])
        .set_file_name(default_name)
        .blocking_save_file()
    else {
        return Ok(None);
    };
    let path = picked.into_path().map_err(|e| e.to_string())?;
    let matches = path
        .extension()
        .is_some_and(|found| found.eq_ignore_ascii_case(ext));
    if !matches {
        return Err(format!("Yalnız .{ext} dosyasına kaydedilebilir."));
    }
    lock(&state.files)?.insert(path.clone());
    Ok(Some(path.to_string_lossy().into_owned()))
}

#[tauri::command]
pub async fn pick_markdown_file(
    app: AppHandle,
    state: State<'_, Allowed>,
    default_name: String,
) -> Result<Option<String>, String> {
    pick_export(&app, &state, default_name, "Markdown", "md")
}

/// `kind` is "png" or "svg".
#[tauri::command]
pub async fn pick_image_file(
    app: AppHandle,
    state: State<'_, Allowed>,
    default_name: String,
    kind: String,
) -> Result<Option<String>, String> {
    let label = match kind.as_str() {
        "png" => "PNG resmi",
        "svg" => "SVG resmi",
        _ => return Err(format!("Desteklenmeyen biçim: {kind}")),
    };
    pick_export(&app, &state, default_name, label, &kind)
}

/// Writes an exported picture to a path picked with `pick_image_file`. Raw body; the
/// path comes percent-encoded in `x-path`.
#[tauri::command]
pub fn write_image_file(
    state: State<'_, Allowed>,
    request: tauri::ipc::Request<'_>,
) -> Result<(), String> {
    let (bytes, path) = raw_body_and_path(&request)?;
    let target = state.take_file(&path)?;
    write_atomic(&target, bytes)
}

#[tauri::command]
pub fn write_markdown(
    state: State<'_, Allowed>,
    path: String,
    content: String,
) -> Result<(), String> {
    let target = state.take_file(&path)?;
    write_atomic(&target, &content)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn decodes_percent_encoded_paths() {
        assert_eq!(
            percent_decode("C%3A%5CUsers%5C%C3%96rnek").unwrap(),
            r"C:\Users\Örnek"
        );
        assert!(percent_decode("%G1").is_err());
        assert!(percent_decode("%4").is_err());
    }

    #[test]
    fn only_approved_raelin_files_pass() {
        let allowed = Allowed::default();
        let file = std::env::temp_dir().join("raelin-test.raelin");
        let text = file.to_string_lossy().into_owned();
        assert!(allowed.check_workspace(&text).is_err());
        allowed.allow_workspace(&file).unwrap();
        assert!(allowed.check_workspace(&text).is_ok());
        // Approval is per file, and only for workspace files with a full path.
        let sibling = std::env::temp_dir().join("other.raelin");
        assert!(allowed.check_workspace(&sibling.to_string_lossy()).is_err());
        assert!(
            allowed
                .allow_workspace(&std::env::temp_dir().join("x.json"))
                .is_err()
        );
        assert!(
            allowed
                .allow_workspace(Path::new("relative.raelin"))
                .is_err()
        );
    }

    #[test]
    fn launch_argument_must_be_an_existing_raelin_file() {
        let dir = std::env::temp_dir();
        let file = dir.join("raelin-launch-test.raelin");
        fs::write(&file, "{}").unwrap();
        let args = |rest: &[&str]| {
            std::iter::once("raelin.exe")
                .chain(rest.iter().copied())
                .map(String::from)
                .collect::<Vec<_>>()
        };
        assert_eq!(
            workspace_arg(&args(&["--flag", "raelin-launch-test.raelin"]), &dir),
            Some(dir.join("raelin-launch-test.raelin"))
        );
        assert_eq!(workspace_arg(&args(&["missing.raelin"]), &dir), None);
        assert_eq!(workspace_arg(&args(&["notes.txt"]), &dir), None);
        // The program path itself never counts.
        assert_eq!(
            workspace_arg(&[file.to_string_lossy().into_owned()], &dir),
            None
        );
        let _ = fs::remove_file(&file);
    }

    #[test]
    fn stamp_changes_when_the_file_changes() {
        let path = std::env::temp_dir().join("raelin-stamp-test.raelin");
        write_atomic(&path, "a").unwrap();
        let first = stamp(&path).unwrap();
        write_atomic(&path, "longer").unwrap();
        assert_ne!(stamp(&path).unwrap(), first);
        let _ = fs::remove_file(&path);
    }

    #[test]
    fn export_targets_are_single_use() {
        let allowed = Allowed::default();
        let path = std::env::temp_dir().join("raelin-test.md");
        let text = path.to_string_lossy().into_owned();
        assert!(allowed.take_file(&text).is_err());
        allowed.files.lock().unwrap().insert(path);
        assert!(allowed.take_file(&text).is_ok());
        assert!(allowed.take_file(&text).is_err());
    }

    #[test]
    fn atomic_write_replaces_content_and_leaves_no_temp() {
        let path = std::env::temp_dir().join("raelin-atomic-test.json");
        write_atomic(&path, "first").unwrap();
        write_atomic(&path, "second").unwrap();
        assert_eq!(fs::read_to_string(&path).unwrap(), "second");
        assert!(!path.with_file_name("raelin-atomic-test.json.tmp").exists());
        let _ = fs::remove_file(&path);
    }
}
