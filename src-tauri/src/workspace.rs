//! Workspace folder I/O. Layout: `raelin.json` manifest, `boards/<id>.json` and pictures
//! in `assets/<id>.<ext>`. Board ids and asset names are restricted to [a-z0-9-] (plus a
//! known image extension) so they can never escape the folder.
//!
//! The WebView never hands us a path we trust: folders and Markdown files are picked
//! in native dialogs opened from Rust, and only those picks (plus the last workspace
//! folder, remembered by Rust itself) end up in the `Allowed` list the commands check.

use serde::{Deserialize, Serialize};
use std::collections::HashSet;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use tauri::{AppHandle, Manager, State};
use tauri_plugin_dialog::DialogExt;

const MANIFEST: &str = "raelin.json";
const BOARDS_DIR: &str = "boards";
const ASSETS_DIR: &str = "assets";
const ASSET_EXTENSIONS: [&str; 4] = ["png", "jpg", "webp", "gif"];
const MAX_ASSET_BYTES: u64 = 10 * 1024 * 1024;
const LAST_DIR_FILE: &str = "last-workspace.txt";
const MAX_FILE_BYTES: u64 = 32 * 1024 * 1024;

#[derive(Serialize, Deserialize)]
pub struct BoardFile {
    id: String,
    content: String,
}

#[derive(Serialize)]
pub struct WorkspaceFiles {
    manifest: String,
    boards: Vec<BoardFile>,
}

#[derive(Deserialize)]
struct ManifestBoards {
    boards: Vec<ManifestBoard>,
}

#[derive(Deserialize)]
struct ManifestBoard {
    id: String,
}

/// Paths the user approved in a native dialog during this run.
#[derive(Default)]
pub struct Allowed {
    /// Canonical workspace folders.
    dirs: Mutex<HashSet<PathBuf>>,
    /// Markdown targets; each one is consumed by a single write.
    files: Mutex<HashSet<PathBuf>>,
}

impl Allowed {
    fn allow_dir(&self, dir: &Path) -> Result<(), String> {
        let canon = canonical(dir)?;
        lock(&self.dirs)?.insert(canon);
        Ok(())
    }

    fn check_dir(&self, dir: &str) -> Result<PathBuf, String> {
        let path = PathBuf::from(dir);
        if !path.is_absolute() {
            return Err("Çalışma alanı yolu tam yol olmalı.".into());
        }
        let canon = canonical(&path)?;
        if lock(&self.dirs)?.contains(&canon) {
            Ok(path)
        } else {
            Err("Bu klasöre erişim izni yok; klasörü yeniden seç.".into())
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

fn lock<T>(m: &Mutex<T>) -> Result<std::sync::MutexGuard<'_, T>, String> {
    m.lock().map_err(|_| "İç durum kilitlenemedi.".to_string())
}

fn canonical(path: &Path) -> Result<PathBuf, String> {
    fs::canonicalize(path).map_err(|e| format!("{}: {e}", path.display()))
}

fn is_safe_id(id: &str) -> bool {
    !id.is_empty()
        && id.len() <= 64
        && id
            .chars()
            .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-')
}

fn is_asset_name(name: &str) -> bool {
    name.split_once('.')
        .is_some_and(|(id, ext)| is_safe_id(id) && ASSET_EXTENSIONS.contains(&ext))
}

fn asset_path(root: &Path, name: &str) -> Result<PathBuf, String> {
    if !is_asset_name(name) {
        return Err(format!("Geçersiz resim adı: {name}"));
    }
    Ok(root.join(ASSETS_DIR).join(name))
}

/// Decodes `encodeURIComponent` output; header values must be ASCII, folder paths are not.
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

fn board_path(root: &Path, id: &str) -> Result<PathBuf, String> {
    if !is_safe_id(id) {
        return Err(format!("Geçersiz pano kimliği: {id}"));
    }
    Ok(root.join(BOARDS_DIR).join(format!("{id}.json")))
}

fn read_limited(path: &Path) -> Result<String, String> {
    let meta = fs::metadata(path).map_err(|e| format!("{}: {e}", path.display()))?;
    if meta.len() > MAX_FILE_BYTES {
        return Err(format!("Dosya çok büyük: {}", path.display()));
    }
    fs::read_to_string(path).map_err(|e| format!("{}: {e}", path.display()))
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

fn last_dir_store(app: &AppHandle) -> Option<PathBuf> {
    app.path()
        .app_config_dir()
        .ok()
        .map(|d| d.join(LAST_DIR_FILE))
}

/// Best effort: a missing config folder only means the next start shows the example.
fn remember_last_dir(app: &AppHandle, dir: &Path) {
    if let Some(store) = last_dir_store(app) {
        if let Some(parent) = store.parent() {
            let _ = fs::create_dir_all(parent);
        }
        let _ = fs::write(store, dir.to_string_lossy().as_bytes());
    }
}

fn read_files(root: &Path) -> Result<WorkspaceFiles, String> {
    let manifest = read_limited(&root.join(MANIFEST))?;
    let listed: ManifestBoards =
        serde_json::from_str(&manifest).map_err(|e| format!("raelin.json okunamadı: {e}"))?;
    let mut boards = Vec::with_capacity(listed.boards.len());
    for board in listed.boards {
        let content = read_limited(&board_path(root, &board.id)?)?;
        boards.push(BoardFile {
            id: board.id,
            content,
        });
    }
    Ok(WorkspaceFiles { manifest, boards })
}

/// Raw bytes of one picture in an approved workspace folder.
#[tauri::command]
pub fn read_asset(
    state: State<'_, Allowed>,
    dir: String,
    name: String,
) -> Result<tauri::ipc::Response, String> {
    let path = asset_path(&state.check_dir(&dir)?, &name)?;
    let meta = fs::metadata(&path).map_err(|e| format!("{name}: {e}"))?;
    if meta.len() > MAX_ASSET_BYTES {
        return Err(format!("Resim çok büyük: {name}"));
    }
    let bytes = fs::read(&path).map_err(|e| format!("{name}: {e}"))?;
    Ok(tauri::ipc::Response::new(bytes))
}

/// Stores one picture. The bytes come as the raw request body (no JSON round trip); the
/// folder and name come in percent-encoded `x-dir` / `x-name` headers.
#[tauri::command]
pub fn write_asset(
    state: State<'_, Allowed>,
    request: tauri::ipc::Request<'_>,
) -> Result<(), String> {
    let tauri::ipc::InvokeBody::Raw(bytes) = request.body() else {
        return Err("Resim baytları bekleniyordu.".into());
    };
    if bytes.len() as u64 > MAX_ASSET_BYTES {
        return Err("Resim 10 MB'tan büyük olamaz.".into());
    }
    let header = |key: &str| -> Result<String, String> {
        let value = request
            .headers()
            .get(key)
            .and_then(|v| v.to_str().ok())
            .ok_or_else(|| format!("{key} başlığı eksik."))?;
        percent_decode(value)
    };
    let root = state.check_dir(&header("x-dir")?)?;
    let path = asset_path(&root, &header("x-name")?)?;
    fs::create_dir_all(root.join(ASSETS_DIR)).map_err(|e| e.to_string())?;
    write_atomic(&path, bytes)
}

/// Copies pictures between two approved folders ("save to another folder"). Pictures
/// already present in the target are left alone; missing sources are reported back.
#[tauri::command]
pub fn copy_assets(
    state: State<'_, Allowed>,
    from: String,
    to: String,
    names: Vec<String>,
) -> Result<Vec<String>, String> {
    let source = state.check_dir(&from)?;
    let target = state.check_dir(&to)?;
    fs::create_dir_all(target.join(ASSETS_DIR)).map_err(|e| e.to_string())?;
    let mut missing = Vec::new();
    for name in names {
        let src = asset_path(&source, &name)?;
        let dest = asset_path(&target, &name)?;
        if dest.is_file() {
            continue;
        }
        if !src.is_file() {
            missing.push(name);
            continue;
        }
        let bytes = fs::read(&src).map_err(|e| format!("{name}: {e}"))?;
        write_atomic(&dest, bytes)?;
    }
    Ok(missing)
}

/// Native folder picker. Blocking dialogs must not run on the main thread, hence async.
#[tauri::command]
pub async fn pick_workspace_dir(
    app: AppHandle,
    state: State<'_, Allowed>,
    title: String,
) -> Result<Option<String>, String> {
    let Some(picked) = app.dialog().file().set_title(title).blocking_pick_folder() else {
        return Ok(None);
    };
    let dir = picked.into_path().map_err(|e| e.to_string())?;
    state.allow_dir(&dir)?;
    Ok(Some(dir.to_string_lossy().into_owned()))
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

/// Writes an exported picture to a path picked with `pick_image_file`. Raw body like
/// `write_asset`; the path comes percent-encoded in `x-path`.
#[tauri::command]
pub fn write_image_file(
    state: State<'_, Allowed>,
    request: tauri::ipc::Request<'_>,
) -> Result<(), String> {
    let tauri::ipc::InvokeBody::Raw(bytes) = request.body() else {
        return Err("Resim baytları bekleniyordu.".into());
    };
    let path = request
        .headers()
        .get("x-path")
        .and_then(|v| v.to_str().ok())
        .ok_or("x-path başlığı eksik.")?;
    let target = state.take_file(&percent_decode(path)?)?;
    write_atomic(&target, bytes)
}

/// The last folder Raelin itself read or wrote, re-approved for this run.
#[tauri::command]
pub fn last_workspace_dir(app: AppHandle, state: State<'_, Allowed>) -> Option<String> {
    let text = fs::read_to_string(last_dir_store(&app)?).ok()?;
    let dir = PathBuf::from(text.trim());
    if !dir.join(MANIFEST).is_file() || state.allow_dir(&dir).is_err() {
        return None;
    }
    Some(dir.to_string_lossy().into_owned())
}

#[tauri::command]
pub fn is_dir_allowed(state: State<'_, Allowed>, dir: String) -> bool {
    state.check_dir(&dir).is_ok()
}

#[tauri::command]
pub fn read_workspace(
    app: AppHandle,
    state: State<'_, Allowed>,
    dir: String,
) -> Result<WorkspaceFiles, String> {
    let root = state.check_dir(&dir)?;
    let files = read_files(&root)?;
    remember_last_dir(&app, &root);
    Ok(files)
}

/// Like `read_workspace`, but a folder without `raelin.json` is `None` instead of an
/// error, so the UI can tell "empty folder" from "another workspace is here".
#[tauri::command]
pub fn probe_workspace(
    state: State<'_, Allowed>,
    dir: String,
) -> Result<Option<WorkspaceFiles>, String> {
    let root = state.check_dir(&dir)?;
    if !root.join(MANIFEST).exists() {
        return Ok(None);
    }
    read_files(&root).map(Some)
}

/// Writes the manifest and the listed boards. Board files that are no longer
/// listed are left on disk on purpose; nothing is deleted implicitly.
#[tauri::command]
pub fn write_workspace(
    app: AppHandle,
    state: State<'_, Allowed>,
    dir: String,
    manifest: String,
    boards: Vec<BoardFile>,
) -> Result<(), String> {
    let root = state.check_dir(&dir)?;
    let paths = boards
        .iter()
        .map(|b| board_path(&root, &b.id))
        .collect::<Result<Vec<_>, _>>()?;
    fs::create_dir_all(root.join(BOARDS_DIR)).map_err(|e| e.to_string())?;
    for (board, path) in boards.iter().zip(paths) {
        write_atomic(&path, &board.content)?;
    }
    write_atomic(&root.join(MANIFEST), &manifest)?;
    remember_last_dir(&app, &root);
    Ok(())
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
    fn asset_names_stay_inside_assets() {
        assert!(is_asset_name("img-1a2b.png"));
        assert!(is_asset_name("img-1a2b.jpg"));
        assert!(!is_asset_name("img-1a2b.exe"));
        assert!(!is_asset_name("../img.png"));
        assert!(!is_asset_name("img.png.png"));
        assert!(!is_asset_name("IMG.png"));
        assert!(!is_asset_name(".png"));
    }

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
    fn rejects_ids_that_could_escape_the_folder() {
        assert!(is_safe_id("board-1a2b"));
        assert!(!is_safe_id("../evil"));
        assert!(!is_safe_id("Board"));
        assert!(!is_safe_id(""));
        assert!(!is_safe_id("a\\b"));
    }

    #[test]
    fn only_approved_folders_pass() {
        let allowed = Allowed::default();
        let dir = std::env::temp_dir();
        let text = dir.to_string_lossy().into_owned();
        assert!(allowed.check_dir(&text).is_err());
        allowed.allow_dir(&dir).unwrap();
        assert!(allowed.check_dir(&text).is_ok());
        // A different spelling of a child path is still a different folder.
        let child = dir.join("raelin-not-approved");
        fs::create_dir_all(&child).unwrap();
        assert!(allowed.check_dir(&child.to_string_lossy()).is_err());
        let _ = fs::remove_dir(&child);
        assert!(allowed.check_dir("relative\\path").is_err());
    }

    #[test]
    fn markdown_targets_are_single_use() {
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
