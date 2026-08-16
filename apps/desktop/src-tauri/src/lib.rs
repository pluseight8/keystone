use serde::Deserialize;
use std::collections::{HashMap, HashSet};
use std::sync::Mutex;
use tauri::{AppHandle, Manager, WebviewUrl, WebviewWindowBuilder, WindowEvent};
use tauri::menu::{Menu, MenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri_plugin_global_shortcut::{Code, GlobalShortcutExt, Modifiers, Shortcut, ShortcutState};
use url::Url;
mod knowledge;
use knowledge::KnowledgeState;

/// The Rust side accepts only a short-lived, already double-confirmed payload.
/// Signature verification of the two approvals belongs in `packages/core`; this
/// command is deliberately not exposed as a generic `eval` primitive.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DataInjectionPayload {
    pub origin: String,
    pub fields: HashMap<String, String>,
    pub confirmation_token: String,
    pub expires_at: String,
}

#[derive(Default)]
struct InjectionState { consumed_tokens: Mutex<HashSet<String>> }

#[tauri::command]
async fn inject_confirmed_data(
    app: AppHandle,
    state: tauri::State<'_, InjectionState>,
    payload: DataInjectionPayload,
) -> Result<(), String> {
    let origin = Url::parse(&payload.origin).map_err(|_| "Invalid origin URL")?;
    if !matches!(origin.scheme(), "https" | "http") || origin.host_str().is_none() {
        return Err("Only an explicit HTTP(S) origin is allowed".into());
    }
    let expires = chrono_like_timestamp(&payload.expires_at)?;
    if expires <= std::time::SystemTime::now() { return Err("Confirmation expired".into()); }
    if payload.confirmation_token.len() < 32 { return Err("Confirmation token is too short".into()); }
    let webview = app.get_webview_window("browser-automation").ok_or("Automation webview is not open")?;
    let current = webview.url().map_err(|error| error.to_string())?;
    if current.origin() != origin.origin() { return Err("Payload origin does not match the active page".into()); }
    {
        let mut consumed = state.consumed_tokens.lock().map_err(|_| "Injection state poisoned")?;
        if !consumed.insert(payload.confirmation_token.clone()) { return Err("Confirmation token was already consumed".into()); }
    }
    let json = serde_json::to_string(&payload.fields).map_err(|_| "Cannot serialize fields")?;
    // Values are JSON encoded, selectors are fixed by the application (never
    // supplied by the peer), and input/change events notify the target site.
    let script = format!(r#"(() => {{
      const values = {json};
      const selectors = {{ address: '[name="address"],#address', city: '[name="city"],#city', postalCode: '[name="postalCode"],#postalCode' }};
      for (const [field, value] of Object.entries(values)) {{
        const selector = selectors[field]; if (!selector) continue;
        const element = document.querySelector(selector); if (!element) continue;
        const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
        if (setter) setter.call(element, value); else element.value = value;
        element.dispatchEvent(new Event('input', {{ bubbles: true }})); element.dispatchEvent(new Event('change', {{ bubbles: true }}));
      }}
    }})();"#);
    webview.eval(&script).map_err(|error| error.to_string())
}

#[tauri::command]
async fn open_automation_browser(app: AppHandle, url: String) -> Result<(), String> {
    let parsed = Url::parse(&url).map_err(|_| "Invalid URL")?;
    if parsed.scheme() != "https" { return Err("Automation requires HTTPS".into()); }
    if let Some(existing) = app.get_webview_window("browser-automation") { existing.navigate(parsed).map_err(|e| e.to_string())?; return Ok(()); }
    WebviewWindowBuilder::new(&app, "browser-automation", WebviewUrl::External(parsed))
        .title("Keystone secure automation").visible(false).build().map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
async fn close_automation_browser(app: AppHandle) -> Result<(), String> {
    if let Some(window) = app.get_webview_window("browser-automation") { window.close().map_err(|e| e.to_string())?; }
    Ok(())
}

#[tauri::command]
fn get_system_locale() -> String {
    std::env::var("LC_ALL").or_else(|_| std::env::var("LANG")).unwrap_or_else(|_| "en".into())
}

#[tauri::command]
fn accessibility_status() -> serde_json::Value {
    serde_json::json!({"platform": std::env::consts::OS, "inputBackend": serde_json::Value::Null, "requiresUserGrant": true, "supported": false, "reason": "Native accessibility adapters are not installed"})
}

#[tauri::command]
fn scan_windows() -> Result<serde_json::Value, String> {
    // Native accessibility tree adapters are platform-specific and should be
    // supplied by the host build (UIAutomation/AXUIElement/AT-SPI). Returning
    // an explicit empty result is safer than pretending that coordinates are
    // trustworthy when the permission has not been granted.
    Ok(serde_json::json!({"windows": [], "permissionRequired": true}))
}

/// Single entry point used by the tray and keyboard accelerator. Re-centering
/// also handles a monitor change between invocations.
fn toggle_overlay(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        if window.is_visible().unwrap_or(false) { let _ = window.hide(); }
        else { let _ = window.center(); let _ = window.show(); let _ = window.set_focus(); }
    }
}

// Parse the protocol's RFC3339 timestamp into the platform clock.
fn chrono_like_timestamp(value: &str) -> Result<std::time::SystemTime, String> {
    let parsed = time::OffsetDateTime::parse(value, &time::format_description::well_known::Rfc3339).map_err(|_| "Invalid expiry timestamp")?;
    let seconds = parsed.unix_timestamp();
    if seconds < 0 { return Err("Invalid expiry timestamp".into()); }
    Ok(std::time::UNIX_EPOCH + std::time::Duration::from_secs(seconds as u64))
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_global_shortcut::Builder::new().with_handler(|app, shortcut, event| {
            if shortcut == &Shortcut::new(Some(Modifiers::ALT), Code::Space)
                && event.state() == ShortcutState::Pressed { toggle_overlay(app); }
        }).build())
        .setup(|app| {
            #[cfg(all(desktop, feature = "updater"))]
            app.handle().plugin(tauri_plugin_updater::Builder::new().build())?;
            let show = MenuItem::with_id(app, "show", "Show Keystone", true, None::<&str>)?;
            let quit = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&show, &quit])?;
            let mut tray = TrayIconBuilder::new().tooltip("Keystone").menu(&menu)
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "show" => toggle_overlay(app), "quit" => app.exit(0), _ => {}
                })
                .on_tray_icon_event(|tray, event| {
                    if matches!(event, TrayIconEvent::Click { button: MouseButton::Left, button_state: MouseButtonState::Up, .. }) {
                        toggle_overlay(tray.app_handle());
                    }
                });
            if let Some(icon) = app.default_window_icon() { tray = tray.icon(icon.clone()); }
            tray.build(app)?;
            app.global_shortcut().register(Shortcut::new(Some(Modifiers::ALT), Code::Space))?;
            if let Some(window) = app.get_webview_window("main") {
                window.on_window_event({ let window = window.clone(); move |event| {
                    if matches!(event, WindowEvent::Focused(false)) { let _ = window.hide(); }
                }});
            }
            Ok(())
        })
        .manage(InjectionState::default())
        .manage(KnowledgeState::default())
        .invoke_handler(tauri::generate_handler![open_automation_browser, close_automation_browser, inject_confirmed_data, accessibility_status, scan_windows, get_system_locale, knowledge::pick_local_folder, knowledge::scan_local_folder, knowledge::read_local_document, knowledge::extract_pdf_text, knowledge::watch_local_folder, knowledge::unwatch_local_folder])
        .run(tauri::generate_context!())
        .expect("error while running Keystone desktop application");
}
