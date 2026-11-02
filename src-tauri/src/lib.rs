mod workspace;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .manage(workspace::Allowed::default())
        .invoke_handler(tauri::generate_handler![
            workspace::pick_workspace_dir,
            workspace::pick_markdown_file,
            workspace::last_workspace_dir,
            workspace::is_dir_allowed,
            workspace::read_workspace,
            workspace::probe_workspace,
            workspace::write_workspace,
            workspace::write_markdown
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
