use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::Duration;

use tauri::{Emitter, Manager};
use tauri_plugin_dialog::{DialogExt, MessageDialogButtons, MessageDialogKind};

/// Milliseconds the shell waits for the webview to signal readiness before it
/// assumes launch has stalled (Req 1.6 — render within 5 seconds).
const LAUNCH_WATCHDOG_MS: u64 = 5_000;

/// Shared flag set once the React root signals it has painted its first
/// meaningful frame. The launch watchdog reads it to decide whether launch
/// stalled.
#[derive(Default)]
struct LaunchState {
    ui_ready: Arc<AtomicBool>,
}

/// Invoked by the React root (`AppBootstrap`) once it has mounted and painted
/// its first meaningful frame. Clears the launch watchdog so no error dialog is
/// shown (Req 1.6).
#[tauri::command]
fn ui_ready(state: tauri::State<'_, LaunchState>) {
    state.ui_ready.store(true, Ordering::SeqCst);
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_os::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_store::Builder::new().build())
        .plugin(tauri_plugin_notification::init())
        .manage(LaunchState::default())
        .invoke_handler(tauri::generate_handler![ui_ready])
        .setup(|app| {
            // Start the launch watchdog the moment the window is created. If the
            // webview never signals ready within the timeout, show a native
            // error dialog so the user is never left staring at a blank window
            // (Req 1.7).
            let handle = app.handle().clone();
            let ui_ready = app.state::<LaunchState>().ui_ready.clone();
            std::thread::spawn(move || {
                std::thread::sleep(Duration::from_millis(LAUNCH_WATCHDOG_MS));
                if ui_ready.load(Ordering::SeqCst) {
                    return;
                }

                // Nudge the webview to render its in-app retry fallback, then
                // surface a native dialog as the backstop (Req 1.7).
                let _ = handle.emit("launch-stalled", ());

                handle
                    .dialog()
                    .message(
                        "Reading Sync could not finish loading. Please relaunch the app, \
                         and check that your backend is reachable if the problem continues.",
                    )
                    .title("Reading Sync failed to start")
                    .kind(MessageDialogKind::Error)
                    .buttons(MessageDialogButtons::Ok)
                    .blocking_show();
            });
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
