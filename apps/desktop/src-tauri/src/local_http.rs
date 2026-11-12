//! Loopback-only HTTP for local model servers (Ollama, LM Studio, llama.cpp).
//!
//! The WebView cannot read their responses: they send no CORS headers by
//! default. This command performs the request natively instead, and is
//! deliberately narrow: plain HTTP to a loopback address, the model-API paths
//! only, GET/POST with a JSON body, bounded size and time, no redirects.
use serde::{Deserialize, Serialize};
use std::io::{Read, Write};
use std::net::{IpAddr, Ipv4Addr, Ipv6Addr, SocketAddr, TcpStream};
use std::time::Duration;
use url::Url;

const MAX_REQUEST_BYTES: usize = 4 * 1024 * 1024;
const MAX_RESPONSE_BYTES: usize = 16 * 1024 * 1024;
const ALLOWED_PATH_ENDINGS: [&str; 4] = ["/models", "/chat/completions", "/api/tags", "/api/chat"];

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalHttpRequest { method: String, url: String, body: Option<String> }

#[derive(Serialize, Debug, PartialEq)]
pub struct LocalHttpResponse { status: u16, body: String }

fn loopback_target(raw: &str) -> Result<(SocketAddr, String, String), String> {
    let url = Url::parse(raw).map_err(|_| "Invalid local model URL".to_string())?;
    if url.scheme() != "http" || !url.username().is_empty() || url.password().is_some() { return Err("Local model requests must use plain http without credentials".into()); }
    let ip = match url.host_str() {
        Some("localhost") | Some("127.0.0.1") => IpAddr::V4(Ipv4Addr::LOCALHOST),
        Some("[::1]") => IpAddr::V6(Ipv6Addr::LOCALHOST),
        _ => return Err("Local model requests are limited to this device".into()),
    };
    if !ALLOWED_PATH_ENDINGS.iter().any(|ending| url.path().ends_with(ending)) { return Err("This local path is not a model API".into()); }
    let port = url.port().unwrap_or(80);
    let target = match url.query() { Some(query) => format!("{}?{}", url.path(), query), None => url.path().to_string() };
    Ok((SocketAddr::new(ip, port), format!("{}:{}", url.host_str().unwrap_or("127.0.0.1"), port), target))
}

fn parse_response(raw: &[u8]) -> Result<LocalHttpResponse, String> {
    let split = raw.windows(4).position(|window| window == b"\r\n\r\n").ok_or("Local model server sent an incomplete response")?;
    let head = String::from_utf8_lossy(&raw[..split]);
    let mut lines = head.split("\r\n");
    let status = lines.next().and_then(|line| line.split(' ').nth(1)).and_then(|code| code.parse::<u16>().ok()).ok_or("Local model server sent an invalid status line")?;
    let chunked = lines.any(|line| { let lower = line.to_ascii_lowercase(); lower.starts_with("transfer-encoding:") && lower.contains("chunked") });
    let payload = &raw[split + 4..];
    let body = if chunked { dechunk(payload)? } else { payload.to_vec() };
    Ok(LocalHttpResponse { status, body: String::from_utf8_lossy(&body).into_owned() })
}

fn dechunk(mut data: &[u8]) -> Result<Vec<u8>, String> {
    let mut body = Vec::new();
    loop {
        let line_end = data.windows(2).position(|window| window == b"\r\n").ok_or("Local model server sent a truncated chunk")?;
        let size_text = String::from_utf8_lossy(&data[..line_end]);
        let size = usize::from_str_radix(size_text.split(';').next().unwrap_or("").trim(), 16).map_err(|_| "Local model server sent an invalid chunk size")?;
        data = &data[line_end + 2..];
        if size == 0 { return Ok(body); }
        if data.len() < size + 2 { return Err("Local model server sent a truncated chunk".into()); }
        body.extend_from_slice(&data[..size]);
        data = &data[size + 2..];
    }
}

fn perform(request: LocalHttpRequest) -> Result<LocalHttpResponse, String> {
    let method = match request.method.as_str() { "GET" => "GET", "POST" => "POST", _ => return Err("Only GET and POST are supported for local models".into()) };
    let (address, host, target) = loopback_target(&request.url)?;
    let body = request.body.unwrap_or_default();
    if body.len() > MAX_REQUEST_BYTES { return Err("Local model request is too large".into()); }
    let mut stream = TcpStream::connect_timeout(&address, Duration::from_secs(5)).map_err(|_| "Local model server is not reachable".to_string())?;
    // Generation on a cold model can take minutes; discovery returns at once.
    stream.set_read_timeout(Some(Duration::from_secs(600))).map_err(|error| error.to_string())?;
    stream.set_write_timeout(Some(Duration::from_secs(30))).map_err(|error| error.to_string())?;
    let head = format!("{method} {target} HTTP/1.1\r\nHost: {host}\r\nAccept: application/json\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n", body.len());
    stream.write_all(head.as_bytes()).and_then(|_| stream.write_all(body.as_bytes())).map_err(|_| "Local model request could not be sent".to_string())?;
    let mut raw = Vec::new();
    stream.take(MAX_RESPONSE_BYTES as u64 + 1).read_to_end(&mut raw).map_err(|_| "Local model server did not answer in time".to_string())?;
    if raw.len() > MAX_RESPONSE_BYTES { return Err("Local model response is too large".into()); }
    parse_response(&raw)
}

#[tauri::command]
pub async fn desktop_local_model_http(request: LocalHttpRequest) -> Result<LocalHttpResponse, String> {
    tauri::async_runtime::spawn_blocking(move || perform(request)).await.map_err(|error| error.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::net::TcpListener;

    #[test]
    fn accepts_only_loopback_model_api_urls() {
        assert!(loopback_target("http://127.0.0.1:1234/v1/models").is_ok());
        assert!(loopback_target("http://localhost:11434/api/chat").is_ok());
        assert!(loopback_target("http://[::1]:8080/v1/chat/completions").is_ok());
        for rejected in ["https://127.0.0.1:1234/v1/models", "http://example.org/v1/models", "http://127.0.0.1.example.org/v1/models", "http://192.168.1.10:1234/v1/models", "http://user:pw@127.0.0.1:1234/v1/models", "http://127.0.0.1:1234/admin", "http://127.0.0.1:1234/v1/models/../../secret", "file:///etc/passwd", "http://0.0.0.0:1234/v1/models"] {
            assert!(loopback_target(rejected).is_err(), "{rejected} must be rejected");
        }
    }

    #[test]
    fn parses_plain_and_chunked_responses() {
        assert_eq!(parse_response(b"HTTP/1.1 200 OK\r\nContent-Length: 2\r\n\r\n{}").unwrap(), LocalHttpResponse { status: 200, body: "{}".into() });
        assert_eq!(parse_response(b"HTTP/1.1 404 Not Found\r\nTransfer-Encoding: chunked\r\n\r\n3\r\n{\"a\r\n4\r\n\":1}\r\n0\r\n\r\n").unwrap(), LocalHttpResponse { status: 404, body: "{\"a\":1}".into() });
        assert!(parse_response(b"HTTP/1.1 200 OK\r\nTransfer-Encoding: chunked\r\n\r\n9\r\nshort").is_err());
        assert!(parse_response(b"garbage").is_err());
    }

    #[test]
    fn performs_a_request_against_a_loopback_server_and_rejects_other_methods() {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let port = listener.local_addr().unwrap().port();
        let server = std::thread::spawn(move || {
            let (mut socket, _) = listener.accept().unwrap();
            let mut seen = Vec::new(); let mut buffer = [0u8; 1024];
            while !String::from_utf8_lossy(&seen).contains("{\"model\":\"m\"}") { let read = socket.read(&mut buffer).unwrap(); if read == 0 { break; } seen.extend_from_slice(&buffer[..read]); }
            socket.write_all(b"HTTP/1.1 200 OK\r\nContent-Length: 11\r\n\r\n{\"ok\":true}").unwrap();
            String::from_utf8_lossy(&seen).into_owned()
        });
        let response = perform(LocalHttpRequest { method: "POST".into(), url: format!("http://127.0.0.1:{port}/v1/chat/completions"), body: Some("{\"model\":\"m\"}".into()) }).unwrap();
        assert_eq!(response, LocalHttpResponse { status: 200, body: "{\"ok\":true}".into() });
        let seen = server.join().unwrap();
        assert!(seen.starts_with("POST /v1/chat/completions HTTP/1.1\r\n"));
        assert!(perform(LocalHttpRequest { method: "DELETE".into(), url: format!("http://127.0.0.1:{port}/v1/models"), body: None }).is_err());
    }
}
