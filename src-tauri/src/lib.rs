mod companion;
mod http;
mod log;
mod poller;
mod steam;
#[cfg(windows)]
mod win_focus;

use std::sync::Arc;
use tauri::menu::{Menu, MenuItem, PredefinedMenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Emitter, LogicalPosition, LogicalSize, Manager, PhysicalPosition, PhysicalSize, State, WebviewWindow};
use tauri_plugin_global_shortcut::{Code, GlobalShortcutExt, Modifiers, Shortcut, ShortcutState};
use tokio::sync::Mutex;

use crate::poller::Poller;

const FULL_W: f64 = 520.0;
const FULL_H: f64 = 900.0;
const TOP_OFFSET: f64 = 110.0;
const RIGHT_OFFSET: f64 = 20.0;

// Single full overlay view. Compact/minimize mode was removed — in-game
// simplification is handled by per-card auto-collapse instead.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
enum Mode {
    Full,
}

struct AppState {
    poller: Arc<Poller>,
    log_path: std::path::PathBuf,
    mode: Mutex<Mode>,
    last_match_active: Mutex<bool>,
    last_focus_key: Mutex<Option<String>>,
    click_through: Mutex<bool>,
}

#[tauri::command]
fn app_version(app: AppHandle) -> String {
    app.package_info().version.to_string()
}

// Total ranked players per RM ladder, so the UI can show a rank percentile.
// Ranks shown are always RM 1v1 (id 3) / RM Team (id 4).
#[tauri::command]
async fn leaderboard_totals() -> Result<serde_json::Value, String> {
    let (a, b) = futures::future::join(
        companion::fetch_leaderboard_total("rm_1v1"),
        companion::fetch_leaderboard_total("rm_team"),
    )
    .await;
    Ok(serde_json::json!({
        "rm_1v1": a.ok(),
        "rm_team": b.ok(),
    }))
}

#[tauri::command]
fn steam_id() -> Result<String, String> {
    steam::current_steam_id64().map_err(|e| e.to_string())
}

#[tauri::command]
async fn fetch_match(
    state: State<'_, Arc<AppState>>,
    app: AppHandle,
    steam_id: String,
) -> Result<serde_json::Value, String> {
    let snap = state
        .poller
        .resolve_match_snapshot(&steam_id)
        .await
        .map_err(|e| e.to_string())?;
    let active = snap.in_match;
    on_match_state_change(app, state.inner().clone(), active).await;
    Ok(serde_json::to_value(&snap).map_err(|e| e.to_string())?)
}

#[tauri::command]
fn open_external(app: AppHandle, url: String) -> Result<(), String> {
    if !url.starts_with("http://") && !url.starts_with("https://") {
        return Err("refusing non-http scheme".into());
    }
    use tauri_plugin_opener::OpenerExt;
    app.opener()
        .open_url(url, None::<&str>)
        .map_err(|e| e.to_string())
}

#[tauri::command]
fn open_log_folder(app: AppHandle, state: State<'_, Arc<AppState>>) -> Result<(), String> {
    let p = state.log_path.parent().unwrap_or(&state.log_path);
    use tauri_plugin_opener::OpenerExt;
    app.opener()
        .open_path(p.to_string_lossy().to_string(), None::<&str>)
        .map_err(|e| e.to_string())
}

#[tauri::command]
async fn refresh_caches(state: State<'_, Arc<AppState>>) -> Result<(), String> {
    state.poller.clear_match_cache().await;
    state.poller.clear_self_cache().await;
    Ok(())
}

#[tauri::command]
async fn toggle_click_through(
    state: State<'_, Arc<AppState>>,
    app: AppHandle,
) -> Result<bool, String> {
    let mut ct = state.click_through.lock().await;
    *ct = !*ct;
    let val = *ct;
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.set_ignore_cursor_events(val);
    }
    let _ = app.emit("click-through", val);
    Ok(val)
}

#[tauri::command]
async fn quit_app(app: AppHandle) {
    app.exit(0);
}

#[tauri::command]
fn log_msg(level: String, target: Option<String>, message: String) {
    let target = target.unwrap_or_else(|| "frontend".to_string());
    match level.as_str() {
        "error" => tracing::error!(target: "frontend", "[{}] {}", target, message),
        "warn" => tracing::warn!(target: "frontend", "[{}] {}", target, message),
        "info" => tracing::info!(target: "frontend", "[{}] {}", target, message),
        _ => tracing::debug!(target: "frontend", "[{}] {}", target, message),
    }
}

// Desktop-window mode: opaque, resizable, decorated, not always-on-top — for
// running on a dedicated/second monitor. Off restores the overlay (frameless,
// always-on-top, fixed-size) and re-applies the current mode geometry.
#[tauri::command]
async fn desktop_window(on: bool, state: State<'_, Arc<AppState>>, app: AppHandle) -> Result<(), String> {
    if let Some(w) = app.get_webview_window("main") {
        if on {
            let _ = w.set_always_on_top(false);
            let _ = w.set_resizable(true);
            let _ = w.set_decorations(true);
            let _ = w.show();
        } else {
            let _ = w.set_decorations(false);
            let _ = w.set_resizable(false);
            let _ = w.set_always_on_top(true);
            let m = *state.mode.lock().await;
            apply_mode(&app, state.inner().clone(), m).await;
        }
    }
    Ok(())
}

fn top_right_bounds(w: &WebviewWindow, width: f64, height: f64) -> (LogicalPosition<f64>, LogicalSize<f64>) {
    let monitor = w.current_monitor().ok().flatten();
    let (mx, my, mw) = match monitor {
        Some(m) => {
            let pos = m.position();
            let size = m.size();
            let sf = m.scale_factor();
            (
                pos.x as f64 / sf,
                pos.y as f64 / sf,
                size.width as f64 / sf,
            )
        }
        None => (0.0, 0.0, 1920.0),
    };
    let x = mx + mw - width - RIGHT_OFFSET;
    let y = my + TOP_OFFSET;
    (LogicalPosition::new(x, y), LogicalSize::new(width, height))
}

async fn apply_mode(app: &AppHandle, state: Arc<AppState>, m: Mode) {
    let Some(w) = app.get_webview_window("main") else { return };
    let (pos, size) = top_right_bounds(&w, FULL_W, FULL_H);
    let _ = w.set_size(size);
    let _ = w.set_position(pos);
    let _ = w.show();
    *state.mode.lock().await = m;
    let _ = app.emit("mode", "full");
    tracing::info!("[LOCAL] mode → full ({}×{})", FULL_W, FULL_H);
}

async fn on_match_state_change(app: AppHandle, state: Arc<AppState>, active: bool) {
    let was = {
        let mut last = state.last_match_active.lock().await;
        let prev = *last;
        *last = active;
        prev
    };
    // Fresh match → raise the overlay so it's visible. No resize: the single
    // full view stays put; in-game simplification is per-card auto-collapse.
    if active && !was {
        tracing::info!("[LOCAL] match transition · none → active · raise window");
        if let Some(w) = app.get_webview_window("main") {
            let _ = w.set_focus();
        }
    }
}

// Focus-driven mode switching was removed with compact mode. Kept as a no-op so
// the focus-watcher wiring stays intact.
async fn apply_focus_rule(_app: AppHandle, _state: Arc<AppState>, _focus_key: String) {}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_store::Builder::new().build())
        .plugin(
            tauri_plugin_global_shortcut::Builder::new()
                .with_handler(|app, shortcut, event| {
                    if event.state() != ShortcutState::Pressed {
                        return;
                    }
                    let app = app.clone();
                    let s = shortcut.clone();
                    tauri::async_runtime::spawn(async move {
                        handle_shortcut(app, s).await;
                    });
                })
                .build(),
        )
        .setup(|app| {
            let app_data = app.path().app_data_dir().expect("app_data_dir");
            let log_state = log::init(app_data).expect("log init");
            let log_path = log_state.file_path.clone();
            // keep guard alive for app lifetime
            app.manage(log_state);

            let app_handle = app.handle().clone();
            let emit_handle = app_handle.clone();
            let emitter: Arc<dyn Fn(serde_json::Value) + Send + Sync> =
                Arc::new(move |v| {
                    let _ = emit_handle.emit("match-partial", v);
                });
            let poller = Arc::new(Poller::new(emitter));

            let state = Arc::new(AppState {
                poller,
                log_path,
                mode: Mutex::new(Mode::Full),
                last_match_active: Mutex::new(false),
                last_focus_key: Mutex::new(None),
                click_through: Mutex::new(false),
            });
            app.manage(state.clone());

            // Pin main window to top-right + always-on-top screen-saver level (best effort)
            if let Some(w) = app.get_webview_window("main") {
                let _ = w.set_always_on_top(true);
                let (pos, size) = top_right_bounds(&w, FULL_W, FULL_H);
                let _ = w.set_size(size);
                let _ = w.set_position(pos);
            }

            // Global shortcuts
            let gs = app.global_shortcut();
            let sc_r = Shortcut::new(Some(Modifiers::CONTROL | Modifiers::SHIFT), Code::KeyR);
            let sc_c = Shortcut::new(Some(Modifiers::CONTROL | Modifiers::SHIFT), Code::KeyC);
            if let Err(e) = gs.register(sc_r) { tracing::warn!("[LOCAL] global shortcut Ctrl+Shift+R failed: {}", e); }
            if let Err(e) = gs.register(sc_c) { tracing::warn!("[LOCAL] global shortcut Ctrl+Shift+C failed: {}", e); }

            // Tray
            let show_i = MenuItem::with_id(app, "show", "Show overlay", true, None::<&str>)?;
            let hide_i = MenuItem::with_id(app, "hide", "Hide overlay", true, None::<&str>)?;
            let log_i = MenuItem::with_id(app, "open_log", "Open log folder", true, None::<&str>)?;
            let ver_label = format!("v{}", app.package_info().version);
            let ver_i = MenuItem::with_id(app, "ver", ver_label, false, None::<&str>)?;
            let quit_i = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
            let sep1 = PredefinedMenuItem::separator(app)?;
            let sep2 = PredefinedMenuItem::separator(app)?;
            let menu = Menu::with_items(
                app,
                &[&show_i, &hide_i, &sep1, &log_i, &ver_i, &sep2, &quit_i],
            )?;
            let icon = app.default_window_icon().cloned().expect("default window icon");
            let _tray = TrayIconBuilder::with_id("main-tray")
                .icon(icon)
                .tooltip("AoE2 Opponent Stats Overlay")
                .menu(&menu)
                .show_menu_on_left_click(false)
                .on_menu_event(move |app, event| match event.id.as_ref() {
                    "show" => {
                        if let Some(w) = app.get_webview_window("main") {
                            let _ = w.show();
                            let _ = w.set_focus();
                        }
                    }
                    "hide" => {
                        if let Some(w) = app.get_webview_window("main") {
                            let _ = w.hide();
                        }
                    }
                    "open_log" => {
                        if let Some(state) = app.try_state::<Arc<AppState>>() {
                            let p = state.log_path.parent().unwrap_or(&state.log_path).to_path_buf();
                            use tauri_plugin_opener::OpenerExt;
                            let _ = app.opener().open_path(p.to_string_lossy().to_string(), None::<&str>);
                        }
                    }
                    "quit" => app.exit(0),
                    _ => {}
                })
                .on_tray_icon_event(|tray, event| {
                    if let TrayIconEvent::Click {
                        button: MouseButton::Left,
                        button_state: MouseButtonState::Up,
                        ..
                    } = event
                    {
                        let app = tray.app_handle();
                        if let Some(w) = app.get_webview_window("main") {
                            if w.is_visible().unwrap_or(false) {
                                let _ = w.hide();
                            } else {
                                let _ = w.show();
                                let _ = w.set_focus();
                            }
                        }
                    }
                })
                .build(app)?;

            // Focus watcher (Windows only)
            #[cfg(windows)]
            {
                let app_c = app_handle.clone();
                let state_c = state.clone();
                tauri::async_runtime::spawn(async move {
                    loop {
                        tokio::time::sleep(std::time::Duration::from_millis(1500)).await;
                        let info = win_focus::active_window_info();
                        let proc_name = info.process_name.unwrap_or_default();
                        let title = info.title.unwrap_or_default();
                        let is_game = win_focus::is_game(&proc_name, &title);
                        let self_pid = std::process::id();
                        let is_self = info.pid == self_pid;
                        let key = if is_game { "game" } else if is_self { "self" } else { "other" }.to_string();
                        let mut last = state_c.last_focus_key.lock().await;
                        if last.as_deref() != Some(&key) {
                            tracing::info!("[LOCAL] focus · proc={} → {}", proc_name, key);
                            *last = Some(key.clone());
                            drop(last);
                            apply_focus_rule(app_c.clone(), state_c.clone(), key).await;
                        }
                    }
                });
            }

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            app_version,
            steam_id,
            fetch_match,
            open_external,
            open_log_folder,
            refresh_caches,
            toggle_click_through,
            quit_app,
            log_msg,
            desktop_window,
            leaderboard_totals,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

async fn handle_shortcut(app: AppHandle, shortcut: Shortcut) {
    let Some(state) = app.try_state::<Arc<AppState>>().map(|s| s.inner().clone()) else { return };
    let is_r = shortcut.matches(Modifiers::CONTROL | Modifiers::SHIFT, Code::KeyR);
    let is_c = shortcut.matches(Modifiers::CONTROL | Modifiers::SHIFT, Code::KeyC);
    if is_r {
        state.poller.clear_match_cache().await;
        state.poller.clear_self_cache().await;
        let _ = app.emit("refresh", ());
    } else if is_c {
        let mut ct = state.click_through.lock().await;
        *ct = !*ct;
        let val = *ct;
        if let Some(w) = app.get_webview_window("main") {
            let _ = w.set_ignore_cursor_events(val);
        }
        let _ = app.emit("click-through", val);
    }
    // suppress unused imports for non-window builds
    let _ = (PhysicalPosition::<i32>::new(0, 0), PhysicalSize::<u32>::new(0, 0));
}
