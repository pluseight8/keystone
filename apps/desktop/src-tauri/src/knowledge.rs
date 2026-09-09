use notify::{Event, RecommendedWatcher, RecursiveMode, Watcher};
use pdf_extract::extract_text_from_mem;
use serde::Serialize;
use std::{collections::{HashMap, HashSet}, fs, path::{Path, PathBuf}, sync::Mutex};
use tauri::{AppHandle, Emitter, State};

const MAX_DOCUMENT_BYTES: u64 = 64 * 1024 * 1024;
const MAX_PICKED_FILE_BYTES: u64 = 512 * 1024 * 1024;
const SUPPORTED: [&str; 4] = ["md", "txt", "csv", "pdf"];

#[derive(Default)]
pub struct KnowledgeState { watchers: Mutex<HashMap<String, RecommendedWatcher>>, allowed_roots: Mutex<HashSet<PathBuf>> }

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalFileEntry { path: String, size: u64, modified_at: Option<u64> }

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PickedFile { pub name: String, pub mime_type: String, pub size: u64, pub bytes: Vec<u8> }

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct FileChange { root: String, paths: Vec<String>, kind: String }

#[tauri::command]
pub async fn pick_local_folder(state: State<'_, KnowledgeState>) -> Result<Option<String>, String> {
    let selected = tauri::async_runtime::spawn_blocking(|| rfd::FileDialog::new().pick_folder()).await.map_err(|error| error.to_string())?;
    let Some(path) = selected else { return Ok(None); }; let path = canonical_directory(path.to_string_lossy().as_ref())?;
    state.allowed_roots.lock().map_err(|_| "Knowledge root state poisoned")?.insert(path.clone()); Ok(Some(path.to_string_lossy().to_string()))
}

/// Returns bytes only for a file explicitly selected in the native dialog.
/// Absolute paths never cross the WebView boundary and the read is bounded.
#[tauri::command]
pub async fn pick_local_file(kind: String) -> Result<Option<PickedFile>, String> {
    let kind = kind.trim().to_ascii_lowercase();
    if !matches!(kind.as_str(), "audio" | "video" | "file" | "document") { return Err("Unsupported native picker kind".into()); }
    tauri::async_runtime::spawn_blocking(move || {
        let mut dialog = rfd::FileDialog::new();
        match kind.as_str() {
            "audio" => { dialog = dialog.add_filter("Audio", &["mp3", "wav", "ogg", "oga", "flac", "m4a", "aac", "opus", "webm"]); }
            "video" => { dialog = dialog.add_filter("Video", &["mp4", "webm", "mkv", "mov", "avi", "m4v", "ogv"]); }
            "document" => { dialog = dialog.add_filter("Documents", &["md", "markdown", "txt", "csv", "pdf", "epub"]); }
            _ => { dialog = dialog.add_filter("Supported files", &["md", "markdown", "txt", "csv", "pdf", "epub", "json", "png", "jpg", "jpeg", "gif", "mp3", "wav", "ogg", "flac", "m4a", "mp4", "webm", "mkv", "mov"]); }
        }
        let Some(path) = dialog.pick_file() else { return Ok(None); };
        let metadata = fs::metadata(&path).map_err(|error| error.to_string())?;
        if !metadata.is_file() || metadata.len() > MAX_PICKED_FILE_BYTES { return Err("Selected file exceeds the 512 MiB desktop import limit".into()); }
        let bytes = fs::read(&path).map_err(|error| error.to_string())?;
        let name = path.file_name().and_then(|value| value.to_str()).ok_or("Selected file has no valid name")?.to_string();
        Ok(Some(PickedFile { name: name.clone(), mime_type: mime_from_path(&path), size: bytes.len() as u64, bytes }))
    }).await.map_err(|error| error.to_string())?
}

#[tauri::command]
pub fn scan_local_folder(state: State<'_, KnowledgeState>, root: String) -> Result<Vec<LocalFileEntry>, String> {
    let root = allowed_directory(&state, &root)?; let mut output = Vec::new(); visit(&root, &mut output)?; Ok(output)
}

#[tauri::command]
pub fn read_local_document(state: State<'_, KnowledgeState>, path: String) -> Result<Vec<u8>, String> {
    let path = fs::canonicalize(path).map_err(|error| error.to_string())?;
    let permitted = state.allowed_roots.lock().map_err(|_| "Knowledge root state poisoned")?.iter().any(|root| path.starts_with(root));
    if !permitted { return Err("File is outside the user-selected folders".into()); }
    let metadata = fs::metadata(&path).map_err(|error| error.to_string())?;
    if !metadata.is_file() || metadata.len() > MAX_DOCUMENT_BYTES || !supported(&path) { return Err("Document is not an allowed local file".into()); }
    fs::read(path).map_err(|error| error.to_string())
}

#[tauri::command]
pub fn extract_pdf_text(bytes: Vec<u8>) -> Result<String, String> {
    if bytes.len() as u64 > MAX_DOCUMENT_BYTES { return Err("PDF exceeds the extraction limit".into()); }
    extract_text_from_mem(&bytes).map_err(|error| format!("Cannot extract PDF text: {error}"))
}

#[tauri::command]
pub fn watch_local_folder(app: AppHandle, state: State<'_, KnowledgeState>, root: String) -> Result<(), String> {
    let directory = allowed_directory(&state, &root)?; let key = directory.to_string_lossy().to_string();
    let event_root = key.clone(); let event_app = app.clone();
    let mut watcher = notify::recommended_watcher(move |result: notify::Result<Event>| {
        if let Ok(event) = result { let paths = event.paths.iter().filter(|path| supported(path)).map(|path| path.to_string_lossy().to_string()).collect::<Vec<_>>();
            if !paths.is_empty() { let _ = event_app.emit("knowledge://file-change", FileChange { root: event_root.clone(), paths, kind: format!("{:?}", event.kind) }); } }
    }).map_err(|error| error.to_string())?;
    watcher.watch(&directory, RecursiveMode::Recursive).map_err(|error| error.to_string())?;
    state.watchers.lock().map_err(|_| "Knowledge watcher state poisoned")?.insert(key, watcher); Ok(())
}

#[tauri::command]
pub fn unwatch_local_folder(state: State<'_, KnowledgeState>, root: String) -> Result<(), String> {
    let directory = allowed_directory(&state, &root)?; let key = directory.to_string_lossy().to_string();
    state.watchers.lock().map_err(|_| "Knowledge watcher state poisoned")?.remove(&key);
    state.allowed_roots.lock().map_err(|_| "Knowledge root state poisoned")?.remove(&directory); Ok(())
}

fn visit(directory: &Path, output: &mut Vec<LocalFileEntry>) -> Result<(), String> {
    for child in fs::read_dir(directory).map_err(|error| error.to_string())? { let child = child.map_err(|error| error.to_string())?; let path = child.path(); let metadata = child.metadata().map_err(|error| error.to_string())?;
        if metadata.is_symlink() { continue; } if metadata.is_dir() { visit(&path, output)?; }
        else if supported(&path) && metadata.len() <= MAX_DOCUMENT_BYTES { let modified_at = metadata.modified().ok().and_then(|time| time.duration_since(std::time::UNIX_EPOCH).ok()).map(|value| value.as_millis() as u64); output.push(LocalFileEntry { path: path.to_string_lossy().to_string(), size: metadata.len(), modified_at }); }
    } Ok(())
}
fn canonical_directory(value: &str) -> Result<PathBuf, String> { let path = fs::canonicalize(value).map_err(|error| error.to_string())?; if !path.is_dir() { return Err("Selected path is not a directory".into()); } Ok(path) }
fn allowed_directory(state: &State<'_, KnowledgeState>, value: &str) -> Result<PathBuf, String> { let path = canonical_directory(value)?; if !state.allowed_roots.lock().map_err(|_| "Knowledge root state poisoned")?.contains(&path) { return Err("Folder was not selected in the native dialog".into()); } Ok(path) }
fn supported(path: &Path) -> bool { path.extension().and_then(|value| value.to_str()).map(|value| SUPPORTED.contains(&value.to_ascii_lowercase().as_str())).unwrap_or(false) }

fn mime_from_path(path: &Path) -> String {
    match path.extension().and_then(|value| value.to_str()).unwrap_or_default().to_ascii_lowercase().as_str() {
        "md" | "markdown" => "text/markdown",
        "txt" => "text/plain",
        "csv" => "text/csv",
        "json" => "application/json",
        "pdf" => "application/pdf",
        "epub" => "application/epub+zip",
        "mp3" => "audio/mpeg",
        "wav" => "audio/wav",
        "ogg" | "oga" => "audio/ogg",
        "flac" => "audio/flac",
        "m4a" => "audio/mp4",
        "aac" => "audio/aac",
        "opus" => "audio/opus",
        "mp4" | "m4v" => "video/mp4",
        "webm" => "video/webm",
        "mkv" => "video/x-matroska",
        "mov" => "video/quicktime",
        "ogv" => "video/ogg",
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "gif" => "image/gif",
        _ => "application/octet-stream",
    }.to_string()
}
