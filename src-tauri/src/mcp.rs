//! Named-pipe host for AI clients. `raelin-mcp` (started by Claude Code, Claude Desktop,
//! Codex...) connects here; after a token handshake every line is relayed unchanged to
//! the UI, where the MCP server and the command layer live. Rust never interprets tools.
//!
//! Defences, outermost first: the pipe rejects remote clients and its ACL grants access
//! only to the current user (and SYSTEM); `first_pipe_instance` refuses to start if
//! another process already owns the name; the bridge must present the per-launch token.

use raelin_pipe::{Handshake, PROTOCOL_VERSION, pipe_name, same_secret, token_path};
use serde_json::{Value, json};
use std::collections::HashMap;
use std::fs::{self, OpenOptions};
use std::io::Write as _;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Emitter, Manager, State};
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::net::windows::named_pipe::{NamedPipeServer, ServerOptions};
use tokio::sync::mpsc;

const MAX_LINE_BYTES: usize = 8 * 1024 * 1024;
const HANDSHAKE_TIMEOUT: Duration = Duration::from_secs(5);

pub struct McpHost {
    token: String,
    started: AtomicBool,
    next_session: AtomicU64,
    sessions: Mutex<HashMap<u64, mpsc::UnboundedSender<String>>>,
    usage: Mutex<UsageLog>,
}

impl McpHost {
    /// Creates a fresh token and writes it where the bridge looks for it.
    pub fn new(app: &AppHandle) -> Result<Self, String> {
        let mut bytes = [0u8; 32];
        getrandom::fill(&mut bytes).map_err(|e| e.to_string())?;
        let token: String = bytes.iter().map(|b| format!("{b:02x}")).collect();
        let path = token_path().ok_or("APPDATA bulunamadı")?;
        if let Some(dir) = path.parent() {
            fs::create_dir_all(dir).map_err(|e| e.to_string())?;
        }
        fs::write(&path, &token).map_err(|e| format!("{}: {e}", path.display()))?;
        let log = app
            .path()
            .app_log_dir()
            .ok()
            .map(|d| d.join("mcp-usage.jsonl"));
        Ok(Self {
            token,
            started: AtomicBool::new(false),
            next_session: AtomicU64::new(0),
            sessions: Mutex::new(HashMap::new()),
            usage: Mutex::new(UsageLog::new(log)),
        })
    }
}

/// Request/response sizes per MCP call, for the token budget. Only sizes and method
/// names are written, never message content.
struct UsageLog {
    file: Option<PathBuf>,
    pending: HashMap<(u64, String), PendingCall>,
}

struct PendingCall {
    method: String,
    tool: Option<String>,
    request_chars: usize,
    started: Instant,
}

impl UsageLog {
    fn new(file: Option<PathBuf>) -> Self {
        Self {
            file,
            pending: HashMap::new(),
        }
    }

    fn incoming(&mut self, session: u64, line: &str) {
        let Ok(msg) = serde_json::from_str::<Value>(line) else {
            return;
        };
        let (Some(method), Some(id)) = (msg.get("method").and_then(Value::as_str), msg.get("id"))
        else {
            return;
        };
        let tool = (method == "tools/call")
            .then(|| msg.pointer("/params/name").and_then(Value::as_str))
            .flatten()
            .map(str::to_owned);
        self.pending.insert(
            (session, id.to_string()),
            PendingCall {
                method: method.to_owned(),
                tool,
                request_chars: line.len(),
                started: Instant::now(),
            },
        );
    }

    fn outgoing(&mut self, session: u64, line: &str) {
        let Ok(msg) = serde_json::from_str::<Value>(line) else {
            return;
        };
        let Some(id) = msg.get("id") else { return };
        let Some(PendingCall {
            method,
            tool,
            request_chars: req,
            started,
        }) = self.pending.remove(&(session, id.to_string()))
        else {
            return;
        };
        let Some(file) = &self.file else { return };
        let ts = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|d| d.as_millis())
            .unwrap_or(0);
        let entry = json!({
            "ts": ts,
            "session": session,
            "method": method,
            "tool": tool,
            "reqChars": req,
            "resChars": line.len(),
            "approxTokens": (req + line.len()).div_ceil(4),
            "ms": started.elapsed().as_millis(),
            "error": msg.get("error").is_some() || msg.pointer("/result/isError") == Some(&Value::Bool(true)),
        });
        if let Some(dir) = file.parent() {
            let _ = fs::create_dir_all(dir);
        }
        if let Ok(mut f) = OpenOptions::new().create(true).append(true).open(file) {
            let _ = writeln!(f, "{entry}");
        }
    }
}

/// Called by the UI once its listeners are in place; only then do we accept bridges.
#[tauri::command]
pub fn mcp_ready(app: AppHandle, host: State<'_, Arc<McpHost>>) {
    if host.started.swap(true, Ordering::SeqCst) {
        return;
    }
    let host = Arc::clone(&host);
    tauri::async_runtime::spawn(serve(app, host));
}

#[tauri::command]
pub fn mcp_send(
    host: State<'_, Arc<McpHost>>,
    session: u64,
    message: String,
) -> Result<(), String> {
    if let Ok(mut usage) = host.usage.lock() {
        usage.outgoing(session, &message);
    }
    let sessions = host.sessions.lock().map_err(|_| "kilit")?;
    let tx = sessions.get(&session).ok_or("MCP oturumu kapalı")?;
    tx.send(message)
        .map_err(|_| "MCP oturumu kapalı".to_string())
}

async fn serve(app: AppHandle, host: Arc<McpHost>) {
    let name = pipe_name();
    let mut first = true;
    loop {
        let server = match create_pipe(&name, first) {
            Ok(server) => server,
            Err(error) => {
                if first {
                    // Someone else holds our pipe name: do not share it with them.
                    let _ = app.emit("mcp:error", format!("MCP pipe açılamadı: {error}"));
                    return;
                }
                tokio::time::sleep(Duration::from_secs(1)).await;
                continue;
            }
        };
        first = false;
        if server.connect().await.is_err() {
            continue;
        }
        tauri::async_runtime::spawn(handle(app.clone(), Arc::clone(&host), server));
    }
}

async fn write_line(w: &mut (impl AsyncWriteExt + Unpin), text: &str) -> std::io::Result<()> {
    w.write_all(text.as_bytes()).await?;
    w.write_all(b"\n").await?;
    w.flush().await
}

async fn handle(app: AppHandle, host: Arc<McpHost>, pipe: NamedPipeServer) {
    let (read, mut write) = tokio::io::split(pipe);
    let mut lines = BufReader::new(read).lines();

    let hello = tokio::time::timeout(HANDSHAKE_TIMEOUT, lines.next_line()).await;
    let accepted = match hello {
        Ok(Ok(Some(line))) => match serde_json::from_str::<Handshake>(&line) {
            Ok(Handshake::Hello { protocol, .. }) if protocol != PROTOCOL_VERSION => Err(format!(
                "Protokol uyuşmuyor: köprü {protocol}, uygulama {PROTOCOL_VERSION}. Raelin'i güncelle."
            )),
            Ok(Handshake::Hello { token, .. }) if same_secret(&token, &host.token) => Ok(()),
            _ => Err("Kimlik doğrulanamadı.".to_string()),
        },
        _ => Err("El sıkışma zaman aşımı.".to_string()),
    };
    if let Err(message) = accepted {
        if let Ok(text) = serde_json::to_string(&Handshake::Error { message }) {
            let _ = write_line(&mut write, &text).await;
        }
        return;
    }

    let session = host.next_session.fetch_add(1, Ordering::SeqCst) + 1;
    let welcome = Handshake::Welcome {
        session,
        protocol: PROTOCOL_VERSION,
    };
    match serde_json::to_string(&welcome) {
        Ok(text) if write_line(&mut write, &text).await.is_ok() => {}
        _ => return,
    }

    let (tx, mut rx) = mpsc::unbounded_channel::<String>();
    if let Ok(mut sessions) = host.sessions.lock() {
        sessions.insert(session, tx);
    }
    let _ = app.emit("mcp:open", json!({ "session": session }));

    let writer = tauri::async_runtime::spawn(async move {
        while let Some(message) = rx.recv().await {
            if write_line(&mut write, &message).await.is_err() {
                break;
            }
        }
    });

    while let Ok(Some(line)) = lines.next_line().await {
        if line.len() > MAX_LINE_BYTES {
            break;
        }
        if line.trim().is_empty() {
            continue;
        }
        if let Ok(mut usage) = host.usage.lock() {
            usage.incoming(session, &line);
        }
        let _ = app.emit(
            "mcp:message",
            json!({ "session": session, "message": line }),
        );
    }

    if let Ok(mut sessions) = host.sessions.lock() {
        sessions.remove(&session);
    }
    writer.abort();
    let _ = app.emit("mcp:close", json!({ "session": session }));
}

#[cfg(windows)]
fn create_pipe(name: &str, first: bool) -> std::io::Result<NamedPipeServer> {
    use std::ffi::c_void;
    use windows_sys::Win32::Foundation::LocalFree;
    use windows_sys::Win32::Security::Authorization::{
        ConvertStringSecurityDescriptorToSecurityDescriptorW, SDDL_REVISION_1,
    };
    use windows_sys::Win32::Security::{PSECURITY_DESCRIPTOR, SECURITY_ATTRIBUTES};

    let sid = raelin_pipe::identity::current_user_sid()?;
    // Protected DACL: full access for this user and SYSTEM, nobody else.
    let sddl: Vec<u16> = format!("D:P(A;;GA;;;{sid})(A;;GA;;;SY)\0")
        .encode_utf16()
        .collect();
    let mut descriptor: PSECURITY_DESCRIPTOR = std::ptr::null_mut();
    // SAFETY: `sddl` is NUL-terminated UTF-16; on success the descriptor is a LocalAlloc
    // block we free below after the pipe has copied it.
    let converted = unsafe {
        ConvertStringSecurityDescriptorToSecurityDescriptorW(
            sddl.as_ptr(),
            SDDL_REVISION_1,
            &mut descriptor,
            std::ptr::null_mut(),
        )
    };
    if converted == 0 {
        return Err(std::io::Error::last_os_error());
    }
    let mut attributes = SECURITY_ATTRIBUTES {
        nLength: std::mem::size_of::<SECURITY_ATTRIBUTES>() as u32,
        lpSecurityDescriptor: descriptor,
        bInheritHandle: 0,
    };
    let mut options = ServerOptions::new();
    options
        .first_pipe_instance(first)
        .reject_remote_clients(true);
    // SAFETY: `attributes` and the descriptor it points to outlive this call.
    let result = unsafe {
        options.create_with_security_attributes_raw(
            name,
            &mut attributes as *mut SECURITY_ATTRIBUTES as *mut c_void,
        )
    };
    // SAFETY: allocated by ConvertStringSecurityDescriptorToSecurityDescriptorW.
    unsafe { LocalFree(descriptor as _) };
    result
}

/// SID string ("S-1-5-21-...") of the user running the app.
#[cfg(not(windows))]
fn create_pipe(_name: &str, _first: bool) -> std::io::Result<NamedPipeServer> {
    Err(std::io::Error::other(
        "MCP pipe yalnız Windows'ta destekleniyor",
    ))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn usage_pairs_requests_with_responses_without_storing_content() {
        let dir = std::env::temp_dir().join("raelin-usage-test");
        let file = dir.join("mcp-usage.jsonl");
        let _ = fs::remove_file(&file);
        let mut log = UsageLog::new(Some(file.clone()));
        log.incoming(
            1,
            r#"{"jsonrpc":"2.0","id":7,"method":"tools/call","params":{"name":"read_board","arguments":{"secret":"x"}}}"#,
        );
        log.outgoing(1, r#"{"jsonrpc":"2.0","id":7,"result":{"content":[]}}"#);
        let text = fs::read_to_string(&file).unwrap();
        assert!(text.contains(r#""tool":"read_board""#));
        assert!(!text.contains("secret"));
        let _ = fs::remove_file(&file);
    }
}
