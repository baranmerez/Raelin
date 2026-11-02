//! Workspace folder I/O. Layout: `raelin.json` manifest plus `boards/<id>.json`.
//! Board ids are restricted to [a-z0-9-] so they can never escape the folder.

use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};

const MANIFEST: &str = "raelin.json";
const BOARDS_DIR: &str = "boards";
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

fn is_safe_id(id: &str) -> bool {
    !id.is_empty()
        && id.len() <= 64
        && id
            .chars()
            .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-')
}

fn workspace_dir(dir: &str) -> Result<PathBuf, String> {
    let path = PathBuf::from(dir);
    if !path.is_absolute() {
        return Err("Çalışma alanı yolu tam yol olmalı.".into());
    }
    Ok(path)
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
/// leaves a half-written board behind.
fn write_atomic(path: &Path, content: &str) -> Result<(), String> {
    let tmp = path.with_extension("json.tmp");
    fs::write(&tmp, content).map_err(|e| format!("{}: {e}", tmp.display()))?;
    fs::rename(&tmp, path).map_err(|e| format!("{}: {e}", path.display()))
}

#[tauri::command]
pub fn read_workspace(dir: String) -> Result<WorkspaceFiles, String> {
    let root = workspace_dir(&dir)?;
    let manifest = read_limited(&root.join(MANIFEST))?;
    let listed: ManifestBoards =
        serde_json::from_str(&manifest).map_err(|e| format!("raelin.json okunamadı: {e}"))?;
    let mut boards = Vec::with_capacity(listed.boards.len());
    for board in listed.boards {
        let content = read_limited(&board_path(&root, &board.id)?)?;
        boards.push(BoardFile {
            id: board.id,
            content,
        });
    }
    Ok(WorkspaceFiles { manifest, boards })
}

/// Like `read_workspace`, but a folder without `raelin.json` is `None` instead of an
/// error, so the UI can tell "empty folder" from "another workspace is here".
#[tauri::command]
pub fn probe_workspace(dir: String) -> Result<Option<WorkspaceFiles>, String> {
    let root = workspace_dir(&dir)?;
    if !root.join(MANIFEST).exists() {
        return Ok(None);
    }
    read_workspace(dir).map(Some)
}

/// Writes the manifest and the listed boards. Board files that are no longer
/// listed are left on disk on purpose; nothing is deleted implicitly.
#[tauri::command]
pub fn write_workspace(dir: String, manifest: String, boards: Vec<BoardFile>) -> Result<(), String> {
    let root = workspace_dir(&dir)?;
    let paths = boards
        .iter()
        .map(|b| board_path(&root, &b.id))
        .collect::<Result<Vec<_>, _>>()?;
    fs::create_dir_all(root.join(BOARDS_DIR)).map_err(|e| e.to_string())?;
    for (board, path) in boards.iter().zip(paths) {
        write_atomic(&path, &board.content)?;
    }
    write_atomic(&root.join(MANIFEST), &manifest)
}

#[tauri::command]
pub fn write_markdown(path: String, content: String) -> Result<(), String> {
    let target = PathBuf::from(&path);
    let is_md = target
        .extension()
        .is_some_and(|ext| ext.eq_ignore_ascii_case("md"));
    if !target.is_absolute() || !is_md {
        return Err("Yalnız tam yollu .md dosyasına yazılabilir.".into());
    }
    fs::write(&target, content).map_err(|e| format!("{}: {e}", target.display()))
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
}
