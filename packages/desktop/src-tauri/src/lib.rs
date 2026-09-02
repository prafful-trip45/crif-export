//! CRIF Export desktop shell.
//!
//! Registers the OS dialog + filesystem plugins the webview uses to pick input
//! workbooks, save generated bureau files, and reveal a saved file in Finder/Explorer. All conversion is done in the
//! webview by the shared `core` engine — this Rust layer carries no business
//! logic.

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
