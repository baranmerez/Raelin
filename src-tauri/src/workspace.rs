//! Workspace folder I/O. Layout: `raelin.json` manifest plus `boards/<id>.json`.
//! Board ids are restricted to [a-z0-9-] so they can never escape the folder.
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
fn write_atomic(path: &Path, content: &str) -> Result<(), String> {
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

/// Native save dialog for a Markdown export; the returned path may be written once.
#[tauri::command]
pub async fn pick_markdown_file(
    app: AppHandle,
    state: State<'_, Allowed>,
    default_name: String,
) -> Result<Option<String>, String> {
    let Some(picked) = app
        .dialog()
        .file()
        .add_filter("Markdown", &["md"])
        .set_file_name(default_name)
        .blocking_save_file()
    else {
        return Ok(None);
    };
    let path = picked.into_path().map_err(|e| e.to_string())?;
    let is_md = path
        .extension()
        .is_some_and(|ext| ext.eq_ignore_ascii_case("md"));
    if !is_md {
        return Err("Yalnız .md dosyasına kaydedilebilir.".into());
    }
    lock(&state.files)?.insert(path.clone());
    Ok(Some(path.to_string_lossy().into_owned()))
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
