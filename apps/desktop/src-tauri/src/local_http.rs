//! Loopback-only HTTP for local model servers (Ollama, LM Studio, llama.cpp).
//!
//! The WebView cannot read their responses: they send no CORS headers by
//! default. This command performs the request natively instead, and is
//! deliberately narrow: plain HTTP to a loopback address, the model-API paths
//! only, GET/POST with a JSON body, no redirects, no proxy, bounded size, time
//! and concurrency. The body is streamed to the renderer as it arrives, and a
//! cancelled request drops its connection so the model server stops generating.
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::net::{IpAddr, Ipv4Addr, Ipv6Addr, SocketAddr};
use std::sync::Mutex;
use std::time::Duration;
use tauri::ipc::Channel;
use tokio::sync::oneshot;
use url::Url;

const MAX_REQUEST_BYTES: usize = 4 * 1024 * 1024;
const MAX_RESPONSE_BYTES: usize = 16 * 1024 * 1024;
const MAX_CONCURRENT_REQUESTS: usize = 4;
const ALLOWED_PATH_ENDINGS: [&str; 4] = ["/models", "/chat/completions", "/api/tags", "/api/chat"];
const CONNECT_TIMEOUT: Duration = Duration::from_secs(5);
/// A cold model may need minutes before its first byte.
const FIRST_BYTE_TIMEOUT: Duration = Duration::from_secs(600);
/// Once tokens flow, a silent connection is a stalled one.
const IDLE_TIMEOUT: Duration = Duration::from_secs(120);
const TOTAL_TIMEOUT: Duration = Duration::from_secs(30 * 60);

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalHttpRequest { request_id: String, method: String, url: String, body: Option<String> }

#[derive(Serialize, Clone, Debug, PartialEq)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum LocalHttpEvent { Head { status: u16 }, Chunk { text: String }, End, Error { message: String } }

/// Cancel handles of the requests in flight; dropping or firing one aborts its request.
#[derive(Default)]
pub struct LocalModelRequests { active: Mutex<HashMap<String, oneshot::Sender<()>>> }

impl LocalModelRequests {
    fn register(&self, id: &str) -> Result<oneshot::Receiver<()>, String> {
        if id.is_empty() || id.len() > 64 || !id.bytes().all(|byte| byte.is_ascii_alphanumeric() || byte == b'-') { return Err("Invalid local model request id".into()); }
        let mut active = self.active.lock().map_err(|_| "Local model request state is unavailable")?;
        if active.contains_key(id) { return Err("This local model request is already running".into()); }
        if active.len() >= MAX_CONCURRENT_REQUESTS { return Err("Too many local model requests are running; wait for one to finish".into()); }
        let (sender, receiver) = oneshot::channel();
        active.insert(id.to_string(), sender);
        Ok(receiver)
    }
    fn finish(&self, id: &str) { if let Ok(mut active) = self.active.lock() { active.remove(id); } }
    fn cancel(&self, id: &str) { if let Ok(mut active) = self.active.lock() { if let Some(sender) = active.remove(id) { let _ = sender.send(()); } } }
    /// Aborts everything in flight; used when the application exits.
    pub fn cancel_all(&self) { if let Ok(mut active) = self.active.lock() { for (_, sender) in active.drain() { let _ = sender.send(()); } } }
}

/// Validates the target and rewrites it to a literal loopback address, so name resolution cannot redirect it.
fn loopback_target(raw: &str) -> Result<String, String> {
    let url = Url::parse(raw).map_err(|_| "Invalid local model URL".to_string())?;
    if url.scheme() != "http" || !url.username().is_empty() || url.password().is_some() { return Err("Local model requests must use plain http without credentials".into()); }
    let ip = match url.host_str() {
        Some("localhost") | Some("127.0.0.1") => IpAddr::V4(Ipv4Addr::LOCALHOST),
        Some("[::1]") => IpAddr::V6(Ipv6Addr::LOCALHOST),
        _ => return Err("Local model requests are limited to this device".into()),
    };
    if !ALLOWED_PATH_ENDINGS.iter().any(|ending| url.path().ends_with(ending)) { return Err("This local path is not a model API".into()); }
    let address = SocketAddr::new(ip, url.port().unwrap_or(80));
    Ok(match url.query() { Some(query) => format!("http://{address}{}?{query}", url.path()), None => format!("http://{address}{}", url.path()) })
}

/// Splits off the longest valid UTF-8 prefix; an incomplete trailing character stays in `pending` for the next chunk.
fn take_utf8(pending: &mut Vec<u8>) -> String {
    let valid = match std::str::from_utf8(pending) {
        Ok(_) => pending.len(),
        Err(error) if error.error_len().is_none() => error.valid_up_to(),
        Err(_) => { let text = String::from_utf8_lossy(pending).into_owned(); pending.clear(); return text; }
    };
    let text = String::from_utf8_lossy(&pending[..valid]).into_owned();
    pending.drain(..valid);
    text
}

async fn stream_response(request: &LocalHttpRequest, emit: &mut (dyn FnMut(LocalHttpEvent) + Send)) -> Result<(), String> {
    let method = match request.method.as_str() { "GET" => reqwest::Method::GET, "POST" => reqwest::Method::POST, _ => return Err("Only GET and POST are supported for local models".into()) };
    let target = loopback_target(&request.url)?;
    let body = request.body.clone().unwrap_or_default();
    if body.len() > MAX_REQUEST_BYTES { return Err("Local model request is too large".into()); }
    let client = reqwest::Client::builder().no_proxy().redirect(reqwest::redirect::Policy::none()).connect_timeout(CONNECT_TIMEOUT).build().map_err(|_| "Local model client could not start".to_string())?;
    let sending = client.request(method, target).header("accept", "application/json, text/event-stream").header("content-type", "application/json").body(body).send();
    let mut response = match tokio::time::timeout(FIRST_BYTE_TIMEOUT, sending).await {
        Err(_) => return Err("Local model server did not answer in time".into()),
        Ok(Err(error)) if error.is_connect() => return Err("Local model server is not reachable".into()),
        Ok(Err(_)) => return Err("Local model request failed".into()),
        Ok(Ok(response)) => response,
    };
    if response.content_length().is_some_and(|length| length > MAX_RESPONSE_BYTES as u64) { return Err("Local model response is too large".into()); }
    emit(LocalHttpEvent::Head { status: response.status().as_u16() });
    let (mut received, mut pending) = (0usize, Vec::new());
    loop {
        match tokio::time::timeout(IDLE_TIMEOUT, response.chunk()).await {
            Err(_) => return Err("Local model server stopped responding".into()),
            Ok(Err(_)) => return Err("Local model response was interrupted".into()),
            Ok(Ok(None)) => break,
            Ok(Ok(Some(bytes))) => {
                received += bytes.len();
                if received > MAX_RESPONSE_BYTES { return Err("Local model response is too large".into()); }
                pending.extend_from_slice(&bytes);
                let text = take_utf8(&mut pending);
                if !text.is_empty() { emit(LocalHttpEvent::Chunk { text }); }
            }
        }
    }
    if !pending.is_empty() { emit(LocalHttpEvent::Chunk { text: String::from_utf8_lossy(&pending).into_owned() }); }
    Ok(())
}

/// Runs one request until it ends, fails, exceeds the total time, or is cancelled. Dropping the future closes the connection.
async fn run(request: LocalHttpRequest, cancelled: oneshot::Receiver<()>, mut emit: impl FnMut(LocalHttpEvent) + Send) {
    let outcome = tokio::select! {
        _ = cancelled => Err("Local model request was cancelled".to_string()),
        _ = tokio::time::sleep(TOTAL_TIMEOUT) => Err("Local model request took too long".to_string()),
        result = stream_response(&request, &mut emit) => result,
    };
    emit(match outcome { Ok(()) => LocalHttpEvent::End, Err(message) => LocalHttpEvent::Error { message } });
}

#[tauri::command]
pub async fn desktop_local_model_http(state: tauri::State<'_, LocalModelRequests>, request: LocalHttpRequest, on_event: Channel<LocalHttpEvent>) -> Result<(), String> {
    let id = request.request_id.clone();
    let cancelled = state.register(&id)?;
    run(request, cancelled, move |event| { let _ = on_event.send(event); }).await;
    state.finish(&id);
    Ok(())
}

#[tauri::command]
pub fn desktop_local_model_cancel(state: tauri::State<'_, LocalModelRequests>, request_id: String) { state.cancel(&request_id); }

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::{Read, Write};
    use std::net::TcpListener;
    use std::sync::{Arc, Mutex as StdMutex};

    fn request(port: u16, method: &str, path: &str, body: Option<&str>) -> LocalHttpRequest {
        LocalHttpRequest { request_id: "test-1".into(), method: method.into(), url: format!("http://127.0.0.1:{port}{path}"), body: body.map(str::to_string) }
    }
    fn collect(request: LocalHttpRequest, cancelled: oneshot::Receiver<()>) -> Vec<LocalHttpEvent> {
        let events = Arc::new(StdMutex::new(Vec::new()));
        let sink = events.clone();
        tauri::async_runtime::block_on(run(request, cancelled, move |event| sink.lock().unwrap().push(event)));
        let result = events.lock().unwrap().clone();
        result
    }
    fn read_request(socket: &mut std::net::TcpStream, until: &str) -> String {
        let mut seen = Vec::new(); let mut buffer = [0u8; 2048];
        while !String::from_utf8_lossy(&seen).contains(until) { let read = socket.read(&mut buffer).unwrap(); if read == 0 { break; } seen.extend_from_slice(&buffer[..read]); }
        String::from_utf8_lossy(&seen).into_owned()
    }

    #[test]
    fn accepts_only_loopback_model_api_urls() {
        assert_eq!(loopback_target("http://localhost:11434/api/chat").unwrap(), "http://127.0.0.1:11434/api/chat");
        assert_eq!(loopback_target("http://[::1]:8080/v1/chat/completions").unwrap(), "http://[::1]:8080/v1/chat/completions");
        assert!(loopback_target("http://127.0.0.1:1234/v1/models").is_ok());
        for rejected in ["https://127.0.0.1:1234/v1/models", "http://example.org/v1/models", "http://127.0.0.1.example.org/v1/models", "http://192.168.1.10:1234/v1/models", "http://user:pw@127.0.0.1:1234/v1/models", "http://127.0.0.1:1234/admin", "http://127.0.0.1:1234/v1/models/../../secret", "file:///etc/passwd", "http://0.0.0.0:1234/v1/models"] {
            assert!(loopback_target(rejected).is_err(), "{rejected} must be rejected");
        }
    }

    #[test]
    fn keeps_a_split_multibyte_character_for_the_next_chunk() {
        let bytes = "Париж".as_bytes();
        let mut pending = bytes[..3].to_vec();
        assert_eq!(take_utf8(&mut pending), "П");
        pending.extend_from_slice(&bytes[3..]);
        assert_eq!(take_utf8(&mut pending), "ариж");
        assert!(pending.is_empty());
    }

    #[test]
    fn streams_a_chunked_response_piece_by_piece() {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let port = listener.local_addr().unwrap().port();
        let server = std::thread::spawn(move || {
            let (mut socket, _) = listener.accept().unwrap();
            let seen = read_request(&mut socket, "{\"model\":\"m\"}");
            socket.write_all(b"HTTP/1.1 200 OK\r\nTransfer-Encoding: chunked\r\n\r\n").unwrap();
            for piece in ["data: one\n\n", "data: two\n\n"] { socket.write_all(format!("{:x}\r\n{piece}\r\n", piece.len()).as_bytes()).unwrap(); socket.flush().unwrap(); std::thread::sleep(Duration::from_millis(60)); }
            socket.write_all(b"0\r\n\r\n").unwrap();
            seen
        });
        let (_keep, cancelled) = oneshot::channel();
        let events = collect(request(port, "POST", "/v1/chat/completions", Some("{\"model\":\"m\"}")), cancelled);
        assert!(server.join().unwrap().starts_with("POST /v1/chat/completions HTTP/1.1\r\n"));
        assert_eq!(events.first(), Some(&LocalHttpEvent::Head { status: 200 }));
        assert_eq!(events.last(), Some(&LocalHttpEvent::End));
        let chunks: Vec<_> = events.iter().filter_map(|event| if let LocalHttpEvent::Chunk { text } = event { Some(text.as_str()) } else { None }).collect();
        assert!(chunks.len() >= 2, "the two pieces must arrive separately, got {chunks:?}");
        assert_eq!(chunks.concat(), "data: one\n\ndata: two\n\n");
    }

    #[test]
    fn cancelling_closes_the_connection_so_the_server_stops() {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let port = listener.local_addr().unwrap().port();
        let server = std::thread::spawn(move || {
            let (mut socket, _) = listener.accept().unwrap();
            read_request(&mut socket, "\r\n\r\n");
            socket.write_all(b"HTTP/1.1 200 OK\r\nTransfer-Encoding: chunked\r\n\r\n5\r\nhello\r\n").unwrap();
            // A generating server keeps the connection open; it learns about the cancel when the peer closes.
            socket.set_read_timeout(Some(Duration::from_secs(5))).unwrap();
            let mut buffer = [0u8; 16];
            matches!(socket.read(&mut buffer), Ok(0))
        });
        let (cancel, cancelled) = oneshot::channel();
        std::thread::spawn(move || { std::thread::sleep(Duration::from_millis(300)); let _ = cancel.send(()); });
        let started = std::time::Instant::now();
        let events = collect(request(port, "GET", "/v1/models", None), cancelled);
        assert!(started.elapsed() < Duration::from_secs(3));
        assert_eq!(events.last(), Some(&LocalHttpEvent::Error { message: "Local model request was cancelled".into() }));
        assert!(server.join().unwrap(), "the server must see the connection close");
    }

    #[test]
    fn reports_an_unreachable_server_and_rejects_other_methods() {
        let port = { TcpListener::bind("127.0.0.1:0").unwrap().local_addr().unwrap().port() };
        let (_keep, cancelled) = oneshot::channel();
        assert_eq!(collect(request(port, "GET", "/v1/models", None), cancelled), vec![LocalHttpEvent::Error { message: "Local model server is not reachable".into() }]);
        let (_keep, cancelled) = oneshot::channel();
        assert_eq!(collect(request(port, "DELETE", "/v1/models", None), cancelled), vec![LocalHttpEvent::Error { message: "Only GET and POST are supported for local models".into() }]);
    }

    #[test]
    fn limits_concurrent_requests_and_rejects_bad_ids() {
        let requests = LocalModelRequests::default();
        let held: Vec<_> = (0..MAX_CONCURRENT_REQUESTS).map(|index| requests.register(&format!("r-{index}")).unwrap()).collect();
        assert!(requests.register("r-extra").is_err());
        assert!(requests.register("r-0").is_err());
        requests.finish("r-0");
        assert!(requests.register("r-extra").is_ok());
        assert!(requests.register("../x").is_err());
        drop(held);
    }
}
