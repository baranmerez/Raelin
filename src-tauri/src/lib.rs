mod mcp;
mod workspace;

use std::sync::Arc;
use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        // Must be first: a second launch just focuses the existing window (and hands over
        // a double-clicked file), so AI clients always talk to exactly one Raelin.
        .plugin(tauri_plugin_single_instance::init(|app, args, cwd| {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.unminimize();
                let _ = window.set_focus();
            }
            workspace::open_from_second_launch(app, &args, &cwd);
        }))
        .plugin(tauri_plugin_dialog::init())
        .manage(workspace::Allowed::default())
        .manage(workspace::LaunchFile::new(workspace::workspace_arg(
            &std::env::args().collect::<Vec<_>>(),
            &std::env::current_dir().unwrap_or_default(),
        )))
        .setup(|app| {
            // The pipe crate picks the dev or release identity by build profile; a debug
            // build started with the release config would fight the installed app.
            let identifier = &app.config().identifier;
            if identifier != raelin_pipe::APP_IDENTIFIER {
                return Err(format!(
                    "Kimlik uyuşmuyor: yapılandırma {identifier}, derleme {}. \
                     Geliştirme sürümünü `npm run desktop` ile başlat.",
                    raelin_pipe::APP_IDENTIFIER
                )
                .into());
            }
            let host = mcp::McpHost::new(app.handle())?;
            app.manage(Arc::new(host));
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            workspace::pick_workspace_open,
            workspace::pick_workspace_save,
            workspace::last_workspace_file,
            workspace::recent_workspaces,
            workspace::rename_workspace_file,
            workspace::launch_file,
            workspace::is_workspace_allowed,
            workspace::probe_workspace_file,
            workspace::read_workspace_file,
            workspace::write_workspace_file,
            workspace::pick_markdown_file,
            workspace::write_markdown,
            workspace::pick_image_file,
            workspace::write_image_file,
            mcp::mcp_ready,
            mcp::mcp_send
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
