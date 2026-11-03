mod mcp;
mod workspace;

use std::sync::Arc;
use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        // Must be first: a second launch just focuses the existing window, so AI clients
        // always talk to exactly one Raelin.
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.unminimize();
                let _ = window.set_focus();
            }
        }))
        .plugin(tauri_plugin_dialog::init())
        .manage(workspace::Allowed::default())
        .setup(|app| {
            let host = mcp::McpHost::new(app.handle())?;
            app.manage(Arc::new(host));
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            workspace::pick_workspace_dir,
            workspace::pick_markdown_file,
            workspace::last_workspace_dir,
            workspace::is_dir_allowed,
            workspace::read_workspace,
            workspace::probe_workspace,
            workspace::write_workspace,
            workspace::write_markdown,
            workspace::pick_image_file,
            workspace::write_image_file,
            workspace::read_asset,
            workspace::write_asset,
            workspace::copy_assets,
            mcp::mcp_ready,
            mcp::mcp_send
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
