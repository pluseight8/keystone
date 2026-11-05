use base64::{engine::general_purpose::{STANDARD, URL_SAFE_NO_PAD}, Engine as _};
use ring::signature::Ed25519KeyPair;
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};
use std::fs::{self, OpenOptions};
use std::io::Write;
use std::path::PathBuf;
use std::process::{Command, Stdio};
use std::sync::{Arc, Mutex};
use std::thread::JoinHandle;
use std::time::Instant;
use tauri::{AppHandle, Manager, WebviewUrl, WebviewWindowBuilder};
use tauri::State;
use tauri::menu::{Menu, MenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri_plugin_global_shortcut::{Code, GlobalShortcutExt, Modifiers, Shortcut, ShortcutState};
use url::Url;
mod knowledge;
use knowledge::KnowledgeState;

fn window_toggle_shortcut() -> Shortcut {
    // Alt+Space is commonly owned by Linux compositors and desktop launchers
    // (including Omarchy defaults). Keep the app shortcut unambiguous and let
    // the desktop continue without it when another global owner wins.
    Shortcut::new(Some(Modifiers::CONTROL | Modifiers::ALT), Code::KeyK)
}

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

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct OpenKeystoneWindowRequest {
    window_id: String,
    tab_id: String,
    title: String,
    x: Option<f64>,
    y: Option<f64>,
    width: Option<f64>,
    height: Option<f64>,
    maximized: Option<bool>,
    fullscreen: Option<bool>,
}

fn validate_keystone_window_id(value: &str) -> Result<(), String> {
    if value.is_empty() || value.len() > 128 || !value.bytes().all(|byte| byte.is_ascii_alphanumeric() || b"._:-".contains(&byte)) {
        return Err("Invalid Keystone window id".into());
    }
    Ok(())
}

fn keystone_window_label(window_id: &str) -> Result<String, String> {
    validate_keystone_window_id(window_id)?;
    Ok(format!("keystone-{window_id}"))
}

#[tauri::command]
fn open_keystone_window(app: AppHandle, request: OpenKeystoneWindowRequest) -> Result<bool, String> {
    let label = keystone_window_label(&request.window_id)?;
    validate_keystone_window_id(&request.tab_id)?;
    let title = request.title.trim();
    if title.is_empty() || title.len() > 160 { return Err("Invalid Keystone window title".into()); }
    if let Some(existing) = app.get_webview_window(&label) {
        existing.show().map_err(|error| error.to_string())?;
        existing.set_focus().map_err(|error| error.to_string())?;
        return Ok(true);
    }
    let width = request.width.unwrap_or(1120.0);
    let height = request.height.unwrap_or(720.0);
    if !width.is_finite() || !height.is_finite() { return Err("Invalid Keystone window size".into()); }
    let width = width.clamp(900.0, 10000.0);
    let height = height.clamp(600.0, 10000.0);
    let encoded_window_id = request.window_id.clone();
    let encoded_tab_id = request.tab_id.clone();
    let url = format!("index.html?keystoneWindowId={encoded_window_id}&keystoneTabId={encoded_tab_id}");
    let mut builder = WebviewWindowBuilder::new(&app, &label, WebviewUrl::App(url.into()))
        .title(format!("{title} — Keystone"))
        .inner_size(width, height)
        .visible(true)
        .resizable(true)
        .maximizable(true)
        .minimizable(true)
        .closable(true)
        .maximized(request.maximized.unwrap_or(false))
        .fullscreen(request.fullscreen.unwrap_or(false))
        .prevent_overflow()
        .shadow(true);
    if let (Some(x), Some(y)) = (request.x, request.y) {
        if !x.is_finite() || !y.is_finite() { return Err("Invalid Keystone window position".into()); }
        builder = builder.position(x, y);
    } else {
        builder = builder.center();
    }
    let window = builder.build().map_err(|error| error.to_string())?;
    window.show().map_err(|error| error.to_string())?;
    window.set_focus().map_err(|error| error.to_string())?;
    Ok(true)
}

#[tauri::command]
fn focus_keystone_window(app: AppHandle, window_id: String) -> Result<(), String> {
    let label = keystone_window_label(&window_id)?;
    let window = app.get_webview_window(&label).ok_or("Keystone window is not open")?;
    window.show().map_err(|error| error.to_string())?;
    window.set_focus().map_err(|error| error.to_string())
}

#[tauri::command]
fn close_keystone_window(app: AppHandle, window_id: String) -> Result<(), String> {
    let label = keystone_window_label(&window_id)?;
    if label == "keystone-main" { return Err("The primary Keystone window cannot be closed by this command".into()); }
    if let Some(window) = app.get_webview_window(&label) { window.close().map_err(|error| error.to_string())?; }
    Ok(())
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct IdentityProvisionPayload { device_id: String, private_key: Vec<u8> }

#[derive(Debug, Serialize, Deserialize, Default)]
struct IdentityKeyStore { version: u8, keys: HashMap<String, String> }

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct IdentitySignPayload { device_id: String, message: String }

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct AudioDecodePayload { mime_type: String, bytes: Vec<u8> }

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct AudioDecodeResult { sample_rate: u32, channels: u8, duration_ms: u64, pcm_base64: String }

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct DesktopAudioStartPayload { session_id: String, sample_rate: u32, channels: u8, duration_ms: u64, pcm_base64: String, position_ms: u64, volume: f32 }

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct DesktopAudioSessionPayload { session_id: String }

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct DesktopAudioSeekPayload { session_id: String, position_ms: u64 }

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct DesktopAudioVolumePayload { session_id: String, volume: f32 }

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct DesktopAudioStatus { playing: bool, position_ms: u64, duration_ms: u64, volume: f32 }

#[derive(Default)]
struct DesktopAudioState { sessions: Mutex<HashMap<String, DesktopAudioSession>> }

impl DesktopAudioState {
    fn shutdown(&self) {
        let sessions = self.sessions.lock().map(|mut sessions| std::mem::take(&mut *sessions)).unwrap_or_default();
        for (_, mut session) in sessions { stop_audio_process(&mut session); }
    }
}

struct DesktopAudioSession {
    pcm: Arc<Vec<u8>>,
    sample_rate: u32,
    channels: u8,
    duration_ms: u64,
    position_ms: u64,
    volume: f32,
    started_at: Option<Instant>,
    paused: bool,
    child: Option<std::process::Child>,
    writer: Option<JoinHandle<()>>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct VideoProbePayload { mime_type: String, bytes: Vec<u8> }

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct VideoProbeResult { duration_ms: u64, width: u32, height: u32, video_codec: String, container: String }

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct DesktopVideoStartPayload { session_id: String, mime_type: String, bytes: Vec<u8>, duration_ms: u64, position_ms: u64, volume: f32 }

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct DesktopVideoSessionPayload { session_id: String }

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct DesktopVideoSeekPayload { session_id: String, position_ms: u64 }

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct DesktopVideoVolumePayload { session_id: String, volume: f32 }

#[derive(Default)]
struct DesktopVideoState { sessions: Mutex<HashMap<String, DesktopVideoSession>> }

impl DesktopVideoState {
    fn shutdown(&self) {
        let sessions = self.sessions.lock().map(|mut sessions| std::mem::take(&mut *sessions)).unwrap_or_default();
        for (_, mut session) in sessions {
            stop_video_process(&mut session);
            cleanup_video_path(&session);
        }
    }
}

struct DesktopVideoSession {
    path: PathBuf,
    duration_ms: u64,
    position_ms: u64,
    volume: f32,
    started_at: Option<Instant>,
    paused: bool,
    child: Option<std::process::Child>,
}

const MAX_DESKTOP_AUDIO_INPUT_BYTES: usize = 64 * 1024 * 1024;
const MAX_DESKTOP_AUDIO_DURATION_MS: u64 = 10 * 60 * 1000;
const MAX_DESKTOP_AUDIO_PCM_BYTES: u64 = 128 * 1024 * 1024;
const MAX_DESKTOP_VIDEO_INPUT_BYTES: usize = 512 * 1024 * 1024;
const MAX_DESKTOP_VIDEO_DURATION_MS: u64 = 24 * 60 * 60 * 1000;

fn validate_device_id(device_id: &str) -> Result<(), String> {
    if device_id.len() > 128 || !device_id.starts_with("device:") || !device_id.bytes().all(|byte| byte.is_ascii_alphanumeric() || b"._:-".contains(&byte)) { return Err("Invalid desktop device id".into()); }
    Ok(())
}

fn identity_store_path(app: &AppHandle) -> Result<PathBuf, String> {
    let directory = app.path().app_data_dir().map_err(|error| error.to_string())?;
    fs::create_dir_all(&directory).map_err(|error| error.to_string())?;
    Ok(directory.join("identity-keys.json"))
}

fn read_identity_store(app: &AppHandle) -> Result<IdentityKeyStore, String> {
    let path = identity_store_path(app)?;
    if !path.exists() { return Ok(IdentityKeyStore { version: 1, keys: HashMap::new() }); }
    let raw = fs::read(path).map_err(|error| error.to_string())?;
    let value = serde_json::from_slice::<IdentityKeyStore>(&raw).map_err(|_| "Desktop identity store is invalid".to_string())?;
    if value.version != 1 { return Err("Unsupported desktop identity store version".into()); }
    Ok(value)
}

fn write_identity_store(app: &AppHandle, value: &IdentityKeyStore) -> Result<(), String> {
    let path = identity_store_path(app)?;
    let temporary = path.with_extension("json.tmp");
    let bytes = serde_json::to_vec(value).map_err(|error| error.to_string())?;
    fs::write(&temporary, bytes).map_err(|error| error.to_string())?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(&temporary, fs::Permissions::from_mode(0o600)).map_err(|error| error.to_string())?;
    }
    fs::rename(temporary, path).map_err(|error| error.to_string())
}

fn key_pair_from_seed(seed: &[u8]) -> Result<Ed25519KeyPair, String> {
    if seed.len() != 32 { return Err("Desktop identity seed has an invalid size".into()); }
    Ed25519KeyPair::from_seed_unchecked(seed).map_err(|_| "Desktop identity seed is invalid".into())
}

#[tauri::command]
fn desktop_identity_provision(app: AppHandle, payload: IdentityProvisionPayload) -> Result<(), String> {
    validate_device_id(&payload.device_id)?;
    if payload.private_key.len() != 64 { return Err("Desktop identity private key has an invalid size".into()); }
    let _pair = key_pair_from_seed(&payload.private_key[..32])?;
    let mut store = read_identity_store(&app)?;
    // The private seed is placed in the app-data store only after the key pair
    // has been validated. It is never returned to the renderer.
    store.keys.insert(payload.device_id, STANDARD.encode(&payload.private_key[..32]));
    write_identity_store(&app, &store)
}

#[tauri::command]
fn desktop_identity_status(app: AppHandle, device_id: String) -> Result<bool, String> {
    validate_device_id(&device_id)?;
    Ok(read_identity_store(&app)?.keys.get(&device_id).map(|value| STANDARD.decode(value).ok().and_then(|seed| key_pair_from_seed(&seed).ok()).is_some()).unwrap_or(false))
}

#[tauri::command]
fn desktop_identity_remove(app: AppHandle, device_id: String) -> Result<(), String> {
    validate_device_id(&device_id)?;
    let mut store = read_identity_store(&app)?;
    store.keys.remove(&device_id);
    write_identity_store(&app, &store)
}

#[tauri::command]
fn desktop_identity_sign(app: AppHandle, payload: IdentitySignPayload) -> Result<String, String> {
    validate_device_id(&payload.device_id)?;
    if payload.message.len() > 4 * 1024 * 1024 { return Err("Signing payload is too large".into()); }
    let store = read_identity_store(&app)?;
    let encoded = store.keys.get(&payload.device_id).ok_or("Desktop identity key is unavailable")?;
    let seed = STANDARD.decode(encoded).map_err(|_| "Desktop identity key is invalid")?;
    let pair = key_pair_from_seed(&seed)?;
    // Core identity metadata uses URL-safe, unpadded base64 for public keys
    // and signatures. Keep the on-disk seed encoding private/internal, but
    // return the protocol-compatible representation at the typed boundary.
    Ok(URL_SAFE_NO_PAD.encode(pair.sign(payload.message.as_bytes()).as_ref()))
}

/// Probe user-selected video bytes with the host's installed ffprobe. This is
/// intentionally a byte-based command: renderer code never supplies a path or
/// shell expression, and the returned metadata is bounded before Core creates
/// the signed Video object.
#[tauri::command]
async fn probe_local_video(payload: VideoProbePayload) -> Result<VideoProbeResult, String> {
    tauri::async_runtime::spawn_blocking(move || probe_local_video_blocking(payload))
        .await
        .map_err(|error| error.to_string())?
}

fn probe_local_video_blocking(payload: VideoProbePayload) -> Result<VideoProbeResult, String> {
    if payload.bytes.is_empty() || payload.bytes.len() > MAX_DESKTOP_VIDEO_INPUT_BYTES {
        return Err("Selected video exceeds the 512 MiB probe input limit".into());
    }
    let mime_type = payload.mime_type.trim().to_ascii_lowercase();
    if !mime_type.starts_with("video/") && mime_type != "application/octet-stream" {
        return Err("The native video decoder accepts only video media".into());
    }
    let probe = run_piped_process(
        "ffprobe",
        &[
            "-v", "error", "-show_entries", "stream=codec_type,codec_name,width,height:format=duration,format_name",
            "-of", "json", "-i", "pipe:0",
        ],
        &payload.bytes,
    )?;
    if !probe.status.success() { return Err("The selected video format could not be probed by ffprobe".into()); }
    let document: serde_json::Value = serde_json::from_slice(&probe.stdout).map_err(|_| "ffprobe returned invalid video metadata")?;
    let video = document.get("streams").and_then(serde_json::Value::as_array).and_then(|streams| streams.iter().find(|stream| stream.get("codec_type").and_then(serde_json::Value::as_str) == Some("video"))).ok_or("The selected file has no video stream")?;
    let width = video.get("width").and_then(serde_json::Value::as_u64).ok_or("Video width is unavailable")?;
    let height = video.get("height").and_then(serde_json::Value::as_u64).ok_or("Video height is unavailable")?;
    let codec = video.get("codec_name").and_then(serde_json::Value::as_str).filter(|value| !value.is_empty()).ok_or("Video codec is unavailable")?;
    let duration = document.get("format").and_then(|format| format.get("duration")).and_then(serde_json::Value::as_str).and_then(|value| value.parse::<f64>().ok()).filter(|value| value.is_finite() && *value > 0.0).ok_or("Video duration is unavailable")?;
    let duration_ms = (duration * 1_000.0).round() as u64;
    if width == 0 || height == 0 || width > 16_384 || height > 16_384 || duration_ms == 0 || duration_ms > MAX_DESKTOP_VIDEO_DURATION_MS { return Err("Video metadata is outside the bounded playback range".into()); }
    let container = document.get("format").and_then(|format| format.get("format_name")).and_then(serde_json::Value::as_str).filter(|value| !value.is_empty()).unwrap_or("unknown");
    Ok(VideoProbeResult { duration_ms, width: width as u32, height: height as u32, video_codec: codec.chars().take(80).collect(), container: container.chars().take(40).collect() })
}

#[tauri::command]
fn desktop_video_start(state: State<'_, DesktopVideoState>, payload: DesktopVideoStartPayload) -> Result<(), String> {
    validate_video_session_id(&payload.session_id)?;
    let mime_type = payload.mime_type.trim().to_ascii_lowercase();
    if !mime_type.starts_with("video/") && mime_type != "application/octet-stream" { return Err("The native video player accepts only video media".into()); }
    if payload.bytes.is_empty() || payload.bytes.len() > MAX_DESKTOP_VIDEO_INPUT_BYTES { return Err("Selected video exceeds the 512 MiB playback input limit".into()); }
    if payload.duration_ms == 0 || payload.duration_ms > MAX_DESKTOP_VIDEO_DURATION_MS { return Err("Video duration is outside the bounded playback range".into()); }
    let volume = normalize_audio_volume(payload.volume)?;
    let path = write_video_temp_file(&payload.bytes)?;
    let mut sessions = state.sessions.lock().map_err(|_| "Desktop video state poisoned")?;
    if let Some(mut previous) = sessions.remove(&payload.session_id) { stop_video_process(&mut previous); cleanup_video_path(&previous); }
    let mut session = DesktopVideoSession { path, duration_ms: payload.duration_ms, position_ms: payload.position_ms.min(payload.duration_ms), volume, started_at: None, paused: false, child: None };
    let position = session.position_ms;
    if let Err(error) = start_video_process(&mut session, position) { stop_video_process(&mut session); cleanup_video_path(&session); return Err(error); }
    sessions.insert(payload.session_id, session);
    Ok(())
}

#[tauri::command]
fn desktop_video_pause(state: State<'_, DesktopVideoState>, payload: DesktopVideoSessionPayload) -> Result<(), String> {
    let mut sessions = state.sessions.lock().map_err(|_| "Desktop video state poisoned")?;
    let session = sessions.get_mut(&payload.session_id).ok_or("Desktop video session is unavailable")?;
    update_video_completion(session)?;
    if session.child.is_none() || session.paused { return Ok(()); }
    session.position_ms = video_position_ms(session);
    if let Some(child) = session.child.as_ref() { send_video_signal(child, libc::SIGSTOP)?; }
    session.started_at = None; session.paused = true;
    Ok(())
}

#[tauri::command]
fn desktop_video_resume(state: State<'_, DesktopVideoState>, payload: DesktopVideoSessionPayload) -> Result<(), String> {
    let mut sessions = state.sessions.lock().map_err(|_| "Desktop video state poisoned")?;
    let session = sessions.get_mut(&payload.session_id).ok_or("Desktop video session is unavailable")?;
    update_video_completion(session)?;
    if session.child.is_none() || !session.paused { return Ok(()); }
    if let Some(child) = session.child.as_ref() { send_video_signal(child, libc::SIGCONT)?; }
    session.started_at = Some(Instant::now()); session.paused = false;
    Ok(())
}

#[tauri::command]
fn desktop_video_seek(state: State<'_, DesktopVideoState>, payload: DesktopVideoSeekPayload) -> Result<(), String> {
    let mut sessions = state.sessions.lock().map_err(|_| "Desktop video state poisoned")?;
    let session = sessions.get_mut(&payload.session_id).ok_or("Desktop video session is unavailable")?;
    let was_paused = session.paused;
    let position = payload.position_ms.min(session.duration_ms);
    start_video_process(session, position)?;
    if was_paused {
        if let Some(child) = session.child.as_ref() { send_video_signal(child, libc::SIGSTOP)?; }
        session.started_at = None; session.paused = true;
    }
    Ok(())
}

#[tauri::command]
fn desktop_video_volume(state: State<'_, DesktopVideoState>, payload: DesktopVideoVolumePayload) -> Result<(), String> {
    let mut sessions = state.sessions.lock().map_err(|_| "Desktop video state poisoned")?;
    let session = sessions.get_mut(&payload.session_id).ok_or("Desktop video session is unavailable")?;
    let volume = normalize_audio_volume(payload.volume)?;
    let was_playing = session.child.is_some() && !session.paused;
    let was_paused = session.paused;
    let position = video_position_ms(session);
    session.volume = volume;
    if was_playing || was_paused {
        start_video_process(session, position)?;
        if was_paused {
            if let Some(child) = session.child.as_ref() { send_video_signal(child, libc::SIGSTOP)?; }
            session.started_at = None; session.paused = true;
        }
    }
    Ok(())
}

#[tauri::command]
fn desktop_video_status(state: State<'_, DesktopVideoState>, payload: DesktopVideoSessionPayload) -> Result<Option<serde_json::Value>, String> {
    let mut sessions = state.sessions.lock().map_err(|_| "Desktop video state poisoned")?;
    let Some(session) = sessions.get_mut(&payload.session_id) else { return Ok(None); };
    update_video_completion(session)?;
    Ok(Some(serde_json::json!({ "playing": session.child.is_some() && !session.paused, "positionMs": video_position_ms(session), "durationMs": session.duration_ms, "volume": session.volume })))
}

#[tauri::command]
fn desktop_video_stop(state: State<'_, DesktopVideoState>, payload: DesktopVideoSessionPayload) -> Result<(), String> {
    let mut sessions = state.sessions.lock().map_err(|_| "Desktop video state poisoned")?;
    if let Some(mut session) = sessions.remove(&payload.session_id) { stop_video_process(&mut session); cleanup_video_path(&session); }
    Ok(())
}

fn validate_video_session_id(session_id: &str) -> Result<(), String> {
    if session_id.is_empty() || session_id.len() > 128 || !session_id.bytes().all(|byte| byte.is_ascii_alphanumeric() || b"._:-".contains(&byte)) { return Err("Invalid desktop video session id".into()); }
    Ok(())
}

fn write_video_temp_file(bytes: &[u8]) -> Result<PathBuf, String> {
    let path = std::env::temp_dir().join(format!("keystone-video-{}-{}.media", std::process::id(), std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map_err(|_| "System clock is invalid")?.as_nanos()));
    let mut file = OpenOptions::new().write(true).create_new(true).open(&path).map_err(|error| format!("Cannot create protected video playback buffer: {error}"))?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(&path, fs::Permissions::from_mode(0o600)).map_err(|error| format!("Cannot protect video playback buffer: {error}"))?;
    }
    if let Err(error) = file.write_all(bytes).and_then(|_| file.sync_all()) { let _ = fs::remove_file(&path); return Err(format!("Cannot write video playback buffer: {error}")); }
    Ok(path)
}

fn start_video_process(session: &mut DesktopVideoSession, position_ms: u64) -> Result<(), String> {
    stop_video_process(session);
    let start = format!("{:.3}", position_ms as f64 / 1_000.0);
    let volume = format!("{:.3}", session.volume * 100.0);
    let mpv_result = Command::new("mpv").args(["--no-terminal", "--really-quiet", "--force-window=immediate", "--keep-open=no", "--title=Keystone Video", &format!("--start={start}"), &format!("--volume={volume}"), "--", session.path.to_string_lossy().as_ref()]).stdin(Stdio::null()).stdout(Stdio::null()).stderr(Stdio::null()).spawn();
    let child = match mpv_result {
        Ok(child) => child,
        Err(mpv_error) => Command::new("ffplay").args(["-hide_banner", "-loglevel", "error", "-autoexit", "-volume", &volume, "-ss", &start, session.path.to_string_lossy().as_ref()]).stdin(Stdio::null()).stdout(Stdio::null()).stderr(Stdio::null()).spawn().map_err(|ffplay_error| format!("Native video player is unavailable (mpv: {mpv_error}; ffplay: {ffplay_error})"))?,
    };
    session.child = Some(child); session.position_ms = position_ms.min(session.duration_ms); session.started_at = Some(Instant::now()); session.paused = false;
    Ok(())
}

fn stop_video_process(session: &mut DesktopVideoSession) {
    if let Some(mut child) = session.child.take() { let _ = child.kill(); let _ = child.wait(); }
    session.started_at = None;
}

fn cleanup_video_path(session: &DesktopVideoSession) {
    let _ = fs::remove_file(&session.path);
}

fn update_video_completion(session: &mut DesktopVideoSession) -> Result<(), String> {
    let ended = if let Some(child) = session.child.as_mut() { child.try_wait().map_err(|error| error.to_string())?.is_some() } else { false };
    if ended { session.child = None; session.position_ms = session.duration_ms; session.started_at = None; session.paused = false; }
    Ok(())
}

fn video_position_ms(session: &DesktopVideoSession) -> u64 {
    let elapsed = session.started_at.map(|started| started.elapsed().as_millis() as u64).unwrap_or(0);
    session.position_ms.saturating_add(elapsed).min(session.duration_ms)
}

#[cfg(unix)]
fn send_video_signal(child: &std::process::Child, signal: i32) -> Result<(), String> {
    if unsafe { libc::kill(child.id() as i32, signal) } == 0 { Ok(()) } else { Err("The native video player rejected the control request".into()) }
}

#[cfg(not(unix))]
fn send_video_signal(_child: &std::process::Child, _signal: i32) -> Result<(), String> { Err("Video pause/resume is unavailable on this host".into()) }

/// Decode user-selected audio through the host's already-installed ffmpeg
/// toolchain. WebKitGTK on some Linux distributions has no GStreamer audio
/// codec plugins, while Core still needs a real local playback path. The
/// renderer supplies bytes returned by the native picker; no filesystem path,
/// shell expression or network URL crosses this boundary.
#[tauri::command]
async fn decode_local_audio(payload: AudioDecodePayload) -> Result<AudioDecodeResult, String> {
    tauri::async_runtime::spawn_blocking(move || decode_local_audio_blocking(payload))
        .await
        .map_err(|error| error.to_string())?
}

fn decode_local_audio_blocking(payload: AudioDecodePayload) -> Result<AudioDecodeResult, String> {
    if payload.bytes.is_empty() || payload.bytes.len() > MAX_DESKTOP_AUDIO_INPUT_BYTES {
        return Err("Selected audio exceeds the 64 MiB decoder input limit".into());
    }
    let mime_type = payload.mime_type.trim().to_ascii_lowercase();
    if !mime_type.starts_with("audio/") && mime_type != "video/webm" {
        return Err("The native audio decoder accepts only audio media".into());
    }

    let probe = run_piped_process(
        "ffprobe",
        &[
            "-v", "error", "-show_entries", "format=duration:stream=duration",
            "-of", "default=noprint_wrappers=1:nokey=1", "-i", "pipe:0",
        ],
        &payload.bytes,
    )?;
    if !probe.status.success() {
        return Err("The selected audio format could not be probed by ffprobe".into());
    }
    let probed_duration = String::from_utf8_lossy(&probe.stdout).lines()
        .filter_map(|line| line.trim().parse::<f64>().ok())
        .find(|value| value.is_finite() && *value > 0.0)
        .unwrap_or(0.0);
    if probed_duration > MAX_DESKTOP_AUDIO_DURATION_MS as f64 / 1000.0 {
        return Err("Audio longer than 10 minutes is not decoded into renderer playback memory".into());
    }

    let temporary_path = std::env::temp_dir().join(format!(
        "keystone-audio-{}-{}.pcm", std::process::id(),
        std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH)
            .map_err(|_| "System clock is invalid")?.as_nanos()
    ));
    let output_file = OpenOptions::new().write(true).create_new(true).open(&temporary_path)
        .map_err(|error| format!("Cannot create bounded audio decode buffer: {error}"))?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(&temporary_path, fs::Permissions::from_mode(0o600))
            .map_err(|error| format!("Cannot protect audio decode buffer: {error}"))?;
    }

    let decode_result = (|| {
        let mut child = Command::new("ffmpeg")
            .args([
                "-v", "error", "-nostdin", "-i", "pipe:0", "-map", "0:a:0",
                "-vn", "-t", "600", "-ac", "2", "-ar", "48000", "-f", "s16le", "pipe:1",
            ])
            .stdin(Stdio::piped())
            .stdout(Stdio::from(output_file))
            .stderr(Stdio::null())
            .spawn()
            .map_err(|error| format!("The local ffmpeg decoder is unavailable: {error}"))?;
        let mut input = child.stdin.take().ok_or("The local decoder input pipe is unavailable")?;
        if let Err(error) = input.write_all(&payload.bytes) {
            let _ = child.kill();
            let _ = child.wait();
            return Err(format!("Could not send audio to the local decoder: {error}"));
        }
        drop(input);
        let status = child.wait().map_err(|error| format!("The local decoder did not finish: {error}"))?;
        if !status.success() { return Err("The selected audio could not be decoded by ffmpeg".into()); }

        let metadata = fs::metadata(&temporary_path).map_err(|error| error.to_string())?;
        if metadata.len() == 0 || metadata.len() > MAX_DESKTOP_AUDIO_PCM_BYTES {
            return Err("Decoded audio exceeds the bounded playback buffer".into());
        }
        let pcm = fs::read(&temporary_path).map_err(|error| error.to_string())?;
        let frame_bytes = 2_u64 * 2_u64;
        let duration_ms = ((pcm.len() as f64 / frame_bytes as f64) / 48_000.0 * 1000.0).round() as u64;
        if duration_ms == 0 || duration_ms > MAX_DESKTOP_AUDIO_DURATION_MS {
            return Err("Decoded audio has an invalid bounded duration".into());
        }
        Ok(AudioDecodeResult { sample_rate: 48_000, channels: 2, duration_ms, pcm_base64: STANDARD.encode(pcm) })
    })();
    let _ = fs::remove_file(&temporary_path);
    decode_result
}

#[tauri::command]
fn desktop_audio_start(state: State<'_, DesktopAudioState>, payload: DesktopAudioStartPayload) -> Result<(), String> {
    let pcm = decode_desktop_pcm(&payload.session_id, payload.sample_rate, payload.channels, payload.duration_ms, &payload.pcm_base64)?;
    let mut sessions = state.sessions.lock().map_err(|_| "Desktop audio state poisoned")?;
    if let Some(mut previous) = sessions.remove(&payload.session_id) { stop_audio_process(&mut previous); }
    let mut session = DesktopAudioSession { pcm: Arc::new(pcm), sample_rate: payload.sample_rate, channels: payload.channels, duration_ms: payload.duration_ms, position_ms: payload.position_ms.min(payload.duration_ms), volume: normalize_audio_volume(payload.volume)?, started_at: None, paused: false, child: None, writer: None };
    let initial_position = session.position_ms;
    start_audio_process(&mut session, initial_position)?;
    sessions.insert(payload.session_id, session);
    Ok(())
}

#[tauri::command]
fn desktop_audio_pause(state: State<'_, DesktopAudioState>, payload: DesktopAudioSessionPayload) -> Result<(), String> {
    let mut sessions = state.sessions.lock().map_err(|_| "Desktop audio state poisoned")?;
    let session = sessions.get_mut(&payload.session_id).ok_or("Desktop audio session is unavailable")?;
    update_audio_completion(session)?;
    if session.child.is_none() || session.paused { return Ok(()); }
    session.position_ms = audio_position_ms(session);
    if let Some(child) = session.child.as_ref() { send_audio_signal(child, libc::SIGSTOP)?; }
    session.started_at = None; session.paused = true;
    Ok(())
}

#[tauri::command]
fn desktop_audio_resume(state: State<'_, DesktopAudioState>, payload: DesktopAudioSessionPayload) -> Result<(), String> {
    let mut sessions = state.sessions.lock().map_err(|_| "Desktop audio state poisoned")?;
    let session = sessions.get_mut(&payload.session_id).ok_or("Desktop audio session is unavailable")?;
    update_audio_completion(session)?;
    if session.child.is_none() || !session.paused { return Ok(()); }
    if let Some(child) = session.child.as_ref() { send_audio_signal(child, libc::SIGCONT)?; }
    session.started_at = Some(Instant::now()); session.paused = false;
    Ok(())
}

#[tauri::command]
fn desktop_audio_seek(state: State<'_, DesktopAudioState>, payload: DesktopAudioSeekPayload) -> Result<(), String> {
    let mut sessions = state.sessions.lock().map_err(|_| "Desktop audio state poisoned")?;
    let session = sessions.get_mut(&payload.session_id).ok_or("Desktop audio session is unavailable")?;
    let was_paused = session.paused;
    let position = payload.position_ms.min(session.duration_ms);
    start_audio_process(session, position)?;
    if was_paused {
        if let Some(child) = session.child.as_ref() { send_audio_signal(child, libc::SIGSTOP)?; }
        session.started_at = None; session.paused = true;
    }
    Ok(())
}

#[tauri::command]
fn desktop_audio_volume(state: State<'_, DesktopAudioState>, payload: DesktopAudioVolumePayload) -> Result<(), String> {
    let mut sessions = state.sessions.lock().map_err(|_| "Desktop audio state poisoned")?;
    let session = sessions.get_mut(&payload.session_id).ok_or("Desktop audio session is unavailable")?;
    let volume = normalize_audio_volume(payload.volume)?;
    let was_playing = session.child.is_some() && !session.paused;
    let was_paused = session.paused;
    let position = audio_position_ms(session);
    session.volume = volume;
    if was_playing || was_paused {
        start_audio_process(session, position)?;
        if was_paused {
            if let Some(child) = session.child.as_ref() { send_audio_signal(child, libc::SIGSTOP)?; }
            session.started_at = None; session.paused = true;
        }
    }
    Ok(())
}

#[tauri::command]
fn desktop_audio_status(state: State<'_, DesktopAudioState>, payload: DesktopAudioSessionPayload) -> Result<Option<DesktopAudioStatus>, String> {
    let mut sessions = state.sessions.lock().map_err(|_| "Desktop audio state poisoned")?;
    let Some(session) = sessions.get_mut(&payload.session_id) else { return Ok(None); };
    update_audio_completion(session)?;
    Ok(Some(DesktopAudioStatus { playing: session.child.is_some() && !session.paused, position_ms: audio_position_ms(session), duration_ms: session.duration_ms, volume: session.volume }))
}

#[tauri::command]
fn desktop_audio_stop(state: State<'_, DesktopAudioState>, payload: DesktopAudioSessionPayload) -> Result<(), String> {
    let mut sessions = state.sessions.lock().map_err(|_| "Desktop audio state poisoned")?;
    if let Some(mut session) = sessions.remove(&payload.session_id) { stop_audio_process(&mut session); }
    Ok(())
}

fn decode_desktop_pcm(session_id: &str, sample_rate: u32, channels: u8, duration_ms: u64, encoded: &str) -> Result<Vec<u8>, String> {
    if session_id.is_empty() || session_id.len() > 128 || !session_id.bytes().all(|byte| byte.is_ascii_alphanumeric() || b"._:-".contains(&byte)) { return Err("Invalid desktop audio session id".into()); }
    if !(8_000..=192_000).contains(&sample_rate) || !(1..=8).contains(&channels) || duration_ms == 0 || duration_ms > MAX_DESKTOP_AUDIO_DURATION_MS { return Err("Desktop audio metadata is outside the bounded playback range".into()); }
    let pcm = STANDARD.decode(encoded).map_err(|_| "Desktop audio PCM is not valid base64")?;
    let frame_bytes = channels as usize * 2;
    if pcm.is_empty() || pcm.len() % frame_bytes != 0 || pcm.len() as u64 > MAX_DESKTOP_AUDIO_PCM_BYTES { return Err("Desktop audio PCM has an invalid bounded size".into()); }
    Ok(pcm)
}

fn normalize_audio_volume(value: f32) -> Result<f32, String> {
    if !value.is_finite() { return Err("Desktop audio volume is invalid".into()); }
    Ok(value.clamp(0.0, 1.0))
}

fn start_audio_process(session: &mut DesktopAudioSession, position_ms: u64) -> Result<(), String> {
    stop_audio_process(session);
    let frame_bytes = session.channels as usize * 2;
    let total_frames = session.pcm.len() / frame_bytes;
    let offset_frames = ((position_ms as u128 * session.sample_rate as u128) / 1000).min(total_frames as u128) as usize;
    let offset = offset_frames * frame_bytes;
    let mut child = Command::new("pw-play")
        .args(["--raw", "--rate", &session.sample_rate.to_string(), "--channels", &session.channels.to_string(), "--format", "s16", "--volume", &format!("{:.3}", session.volume), "-"])
        .stdin(Stdio::piped()).stdout(Stdio::null()).stderr(Stdio::null()).spawn()
        .map_err(|error| format!("The local PipeWire playback host is unavailable: {error}"))?;
    let mut input = child.stdin.take().ok_or("The local audio playback input is unavailable")?;
    let pcm = Arc::clone(&session.pcm);
    let writer = std::thread::spawn(move || { let _ = input.write_all(&pcm[offset..]); });
    session.child = Some(child);
    session.writer = Some(writer);
    session.position_ms = ((offset_frames as u128 * 1000) / session.sample_rate as u128) as u64;
    session.started_at = Some(Instant::now());
    session.paused = false;
    Ok(())
}

fn stop_audio_process(session: &mut DesktopAudioSession) {
    if let Some(mut child) = session.child.take() { let _ = child.kill(); let _ = child.wait(); }
    if let Some(writer) = session.writer.take() { let _ = writer.join(); }
    session.started_at = None;
}

fn update_audio_completion(session: &mut DesktopAudioSession) -> Result<(), String> {
    let ended = if let Some(child) = session.child.as_mut() { child.try_wait().map_err(|error| error.to_string())?.is_some() } else { false };
    if ended {
        session.child = None;
        if let Some(writer) = session.writer.take() { let _ = writer.join(); }
        session.position_ms = session.duration_ms;
        session.started_at = None;
        session.paused = false;
    }
    Ok(())
}

fn audio_position_ms(session: &DesktopAudioSession) -> u64 {
    let elapsed = session.started_at.map(|started| started.elapsed().as_millis() as u64).unwrap_or(0);
    session.position_ms.saturating_add(elapsed).min(session.duration_ms)
}

#[cfg(unix)]
fn send_audio_signal(child: &std::process::Child, signal: i32) -> Result<(), String> {
    if unsafe { libc::kill(child.id() as i32, signal) } == 0 { Ok(()) } else { Err("The local audio playback process rejected the control request".into()) }
}

#[cfg(not(unix))]
fn send_audio_signal(_child: &std::process::Child, _signal: i32) -> Result<(), String> { Err("Audio pause/resume is unavailable on this host".into()) }

fn run_piped_process(command: &str, args: &[&str], input: &[u8]) -> Result<std::process::Output, String> {
    let mut child = Command::new(command).args(args).stdin(Stdio::piped()).stdout(Stdio::piped()).stderr(Stdio::null())
        .spawn().map_err(|error| format!("The local {command} tool is unavailable: {error}"))?;
    let mut stdin = child.stdin.take().ok_or_else(|| format!("The local {command} input pipe is unavailable"))?;
    if let Err(error) = stdin.write_all(input) {
        let _ = child.kill();
        let _ = child.wait();
        return Err(format!("Could not send bytes to {command}: {error}"));
    }
    drop(stdin);
    child.wait_with_output().map_err(|error| format!("The local {command} did not finish: {error}"))
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
/// also handles a monitor change between invocations without changing the
/// normal window's focus/close/resize semantics.
fn toggle_main_window(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        if window.is_visible().unwrap_or(false) { let _ = window.hide(); }
        else { let _ = window.center(); let _ = window.show(); let _ = window.set_focus(); }
    }
}

fn request_quit(app: &AppHandle) {
    app.exit(0);
}

#[tauri::command]
fn quit_keystone(app: AppHandle) -> Result<(), String> {
    request_quit(&app);
    Ok(())
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
    // Omarchy exports GDK_BACKEND=wayland while this Tauri/WebKitGTK bundle
    // uses the GDK X11 backend through XWayland. Select that backend only when
    // XWayland is actually available, and only inside Keystone's process, so a
    // launcher does not need a shell-level override. A pure Wayland host with
    // no DISPLAY keeps its native backend choice.
    #[cfg(target_os = "linux")]
    {
        std::env::set_var("WEBKIT_DISABLE_DMABUF_RENDERER", "1");
        if std::env::var_os("DISPLAY").is_some() {
            let backend = std::env::var("GDK_BACKEND").unwrap_or_default();
            if backend.is_empty() || backend.eq_ignore_ascii_case("wayland") {
                std::env::set_var("GDK_BACKEND", "x11");
            }
        }
    }

    let app = tauri::Builder::default()
        .on_window_event(|window, event| {
            if window.label() == "main" && matches!(event, tauri::WindowEvent::CloseRequested { .. }) {
                request_quit(window.app_handle());
            }
        })
        .plugin(tauri_plugin_single_instance::init(|app, _argv, _cwd| {
            // A second launcher invocation must reuse the already running
            // process instead of constructing another main window.  The
            // callback intentionally only reveals/focuses the canonical
            // window; tab/session ownership remains in the shared registry.
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.show();
                let _ = window.set_focus();
            }
        }))
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_global_shortcut::Builder::new().with_handler(|app, shortcut, event| {
            if shortcut == &window_toggle_shortcut()
                && event.state() == ShortcutState::Pressed { toggle_main_window(app); }
        }).build())
        .setup(|app| {
            #[cfg(all(desktop, feature = "updater"))]
            app.handle().plugin(tauri_plugin_updater::Builder::new().build())?;
            let show = MenuItem::with_id(app, "show", "Show Keystone", true, None::<&str>)?;
            let quit = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&show, &quit])?;
            let mut tray = TrayIconBuilder::new().tooltip("Keystone").menu(&menu)
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "show" => toggle_main_window(app), "quit" => request_quit(app), _ => {}
                })
                .on_tray_icon_event(|tray, event| {
                    if matches!(event, TrayIconEvent::Click { button: MouseButton::Left, button_state: MouseButtonState::Up, .. }) {
                        toggle_main_window(tray.app_handle());
                    }
                });
            if let Some(icon) = app.default_window_icon() { tray = tray.icon(icon.clone()); }
            tray.build(app)?;
            if let Err(error) = app.global_shortcut().register(window_toggle_shortcut()) {
                eprintln!("Keystone global shortcut Ctrl+Alt+K is unavailable; continuing without it: {error}");
            }
            Ok(())
        })
        .manage(InjectionState::default())
        .manage(KnowledgeState::default())
        .manage(DesktopAudioState::default())
        .manage(DesktopVideoState::default())
        .invoke_handler(tauri::generate_handler![open_automation_browser, close_automation_browser, open_keystone_window, focus_keystone_window, close_keystone_window, quit_keystone, inject_confirmed_data, accessibility_status, scan_windows, get_system_locale, desktop_identity_provision, desktop_identity_status, desktop_identity_remove, desktop_identity_sign, decode_local_audio, desktop_audio_start, desktop_audio_pause, desktop_audio_resume, desktop_audio_seek, desktop_audio_volume, desktop_audio_status, desktop_audio_stop, probe_local_video, desktop_video_start, desktop_video_pause, desktop_video_resume, desktop_video_seek, desktop_video_volume, desktop_video_status, desktop_video_stop, knowledge::pick_local_folder, knowledge::pick_local_file, knowledge::scan_local_folder, knowledge::read_local_document, knowledge::extract_pdf_text, knowledge::watch_local_folder, knowledge::unwatch_local_folder])
        .build(tauri::generate_context!())
        .expect("error while building Keystone desktop application");
    app.run(|app, event| {
        if matches!(event, tauri::RunEvent::Exit) {
            let _ = app.global_shortcut().unregister(window_toggle_shortcut());
            app.state::<DesktopAudioState>().shutdown();
            app.state::<DesktopVideoState>().shutdown();
        }
    });
}
