//! `raelin-mcp`: what an AI client starts as its MCP server. It reads the running app's
//! token, connects to the app's named pipe and then copies MCP lines between stdin/stdout
//! and the pipe. Errors go to stderr, which clients log.
//!
//! The bridge outlives the app: while Raelin is closed it answers the client itself
//! (an empty tool list, errors for calls) and keeps trying to connect. When the app comes
//! (back) up it replays the client's `initialize` to it and tells the client that the
//! tool list changed, so nobody has to restart the MCP server by hand.

use raelin_pipe::{Handshake, PROTOCOL_VERSION, pipe_name, token_path};
use serde_json::{Value, json};
use std::collections::HashMap;
use std::process::ExitCode;
use std::time::Duration;
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader, Lines, ReadHalf, WriteHalf};

const OFFLINE: &str =
    "Raelin açık değil. Raelin masaüstü uygulamasını aç; bağlantı kendiliğinden kurulur.";
const CLOSED: &str = "Raelin bu istek sürerken kapandı. Uygulama yeniden açılınca tekrar dene.";

/// Id of the replayed `initialize`; its answer is for the bridge, not the client.
const REPLAY_ID: &str = "raelin-mcp:replay";

const RETRY_EVERY: Duration = Duration::from_secs(2);

#[cfg(windows)]
type Pipe = tokio::net::windows::named_pipe::NamedPipeClient;
#[cfg(not(windows))]
type Pipe = tokio::io::DuplexStream;

struct Link {
    write: WriteHalf<Pipe>,
    lines: Lines<BufReader<ReadHalf<Pipe>>>,
}

#[tokio::main(flavor = "current_thread")]
async fn main() -> ExitCode {
    match run().await {
        Ok(()) => ExitCode::SUCCESS,
        Err(message) => {
            eprintln!("raelin-mcp: {message}");
            ExitCode::FAILURE
        }
    }
}

async fn write_line(w: &mut (impl AsyncWriteExt + Unpin), text: &str) -> std::io::Result<()> {
    w.write_all(text.as_bytes()).await?;
    w.write_all(b"\n").await?;
    w.flush().await
}

#[cfg(windows)]
async fn open_pipe() -> Result<Pipe, String> {
    use std::time::Instant;
    use tokio::net::windows::named_pipe::ClientOptions;
    const ERROR_PIPE_BUSY: i32 = 231;
    let name = pipe_name();
    let deadline = Instant::now() + Duration::from_secs(3);
    loop {
        match ClientOptions::new().open(&name) {
            Ok(client) => {
                use std::os::windows::io::AsRawHandle;
                // The name is predictable: make sure our own user serves it before the
                // token or any MCP line goes out.
                // SAFETY: `client` is a connected pipe client and outlives the call.
                if !unsafe {
                    raelin_pipe::identity::pipe_server_is_current_user(client.as_raw_handle())
                } {
                    return Err("Raelin kanalını başka bir kullanıcı açmış; bağlanılmadı.".into());
                }
                return Ok(client);
            }
            Err(e) if e.raw_os_error() == Some(ERROR_PIPE_BUSY) && Instant::now() < deadline => {
                tokio::time::sleep(Duration::from_millis(50)).await;
            }
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Err(OFFLINE.into()),
            Err(e) => return Err(format!("Raelin'e bağlanılamadı: {e}")),
        }
    }
}

#[cfg(not(windows))]
async fn open_pipe() -> Result<Pipe, String> {
    Err("raelin-mcp şimdilik yalnız Windows'ta çalışıyor.".into())
}

/// Opens the pipe and completes the token handshake with the running app.
async fn connect() -> Result<Link, String> {
    let path = token_path().ok_or("APPDATA bulunamadı.")?;
    let token = std::fs::read_to_string(&path).map_err(|_| OFFLINE.to_string())?;
    let (read, mut write) = tokio::io::split(open_pipe().await?);
    let mut lines = BufReader::new(read).lines();

    let hello = Handshake::Hello {
        token: token.trim().to_owned(),
        protocol: PROTOCOL_VERSION,
        client: format!("raelin-mcp/{}", env!("CARGO_PKG_VERSION")),
    };
    let hello = serde_json::to_string(&hello).map_err(|e| e.to_string())?;
    write_line(&mut write, &hello)
        .await
        .map_err(|e| e.to_string())?;
    let reply = tokio::time::timeout(Duration::from_secs(5), lines.next_line())
        .await
        .map_err(|_| "Raelin yanıt vermedi.".to_string())?
        .map_err(|e| e.to_string())?
        .ok_or_else(|| OFFLINE.to_string())?;
    match serde_json::from_str::<Handshake>(&reply) {
        Ok(Handshake::Welcome { .. }) => Ok(Link { write, lines }),
        Ok(Handshake::Error { message }) => Err(message),
        _ => Err("Beklenmeyen el sıkışma yanıtı.".into()),
    }
}

/// The parts of a JSON-RPC line the bridge cares about.
struct Envelope {
    method: Option<String>,
    id: Option<Value>,
}

fn envelope(line: &str) -> Option<(Value, Envelope)> {
    let value: Value = serde_json::from_str(line).ok()?;
    let method = value
        .get("method")
        .and_then(Value::as_str)
        .map(str::to_owned);
    let id = value.get("id").filter(|id| !id.is_null()).cloned();
    Some((value, Envelope { method, id }))
}

/// Tells the client to fetch the tool list again (after (re)connecting to the app).
fn list_changed() -> String {
    json!({ "jsonrpc": "2.0", "method": "notifications/tools/list_changed" }).to_string()
}

fn error_reply(id: &Value, message: &str) -> String {
    json!({ "jsonrpc": "2.0", "id": id, "error": { "code": -32000, "message": message } })
        .to_string()
}

/// What the bridge answers by itself while the app is closed.
fn offline_reply(request: &Value, method: &str, id: &Value) -> String {
    let result = match method {
        "initialize" => json!({
            "protocolVersion": request["params"]["protocolVersion"],
            "capabilities": { "tools": { "listChanged": true } },
            "serverInfo": { "name": "raelin", "version": env!("CARGO_PKG_VERSION") },
            "instructions": OFFLINE,
        }),
        "tools/list" => json!({ "tools": [] }),
        "ping" => json!({}),
        _ => return error_reply(id, OFFLINE),
    };
    json!({ "jsonrpc": "2.0", "id": id, "result": result }).to_string()
}

#[derive(Default)]
struct Bridge {
    link: Option<Link>,
    /// The client's `initialize` request, replayed to every new app connection.
    initialize: Option<Value>,
    initialized: bool,
    /// Requests sent to the app and not yet answered, by their id's JSON text.
    pending: HashMap<String, Value>,
}

impl Bridge {
    /// Connects and, for a client that already initialized, brings the app's new MCP
    /// session to the same state before anything else is sent.
    async fn try_connect(&mut self, replay: bool) -> bool {
        let mut link = match connect().await {
            Ok(link) => link,
            Err(_) => return false,
        };
        if replay && let Some(init) = &self.initialize {
            let mut init = init.clone();
            init["id"] = json!(REPLAY_ID);
            if write_line(&mut link.write, &init.to_string())
                .await
                .is_err()
            {
                return false;
            }
            if self.initialized {
                let note = json!({ "jsonrpc": "2.0", "method": "notifications/initialized" });
                if write_line(&mut link.write, &note.to_string())
                    .await
                    .is_err()
                {
                    return false;
                }
            }
        }
        eprintln!("raelin-mcp: Raelin'e bağlandı.");
        self.link = Some(link);
        true
    }

    /// Drops the app connection and fails whatever was still waiting on it.
    async fn lose_link(&mut self, out: &mut (impl AsyncWriteExt + Unpin)) -> std::io::Result<()> {
        if self.link.take().is_some() {
            eprintln!("raelin-mcp: Raelin kapandı; yeniden açılınca bağlanacak.");
        }
        for id in std::mem::take(&mut self.pending).into_values() {
            write_line(out, &error_reply(&id, CLOSED)).await?;
        }
        Ok(())
    }

    async fn on_client_line(
        &mut self,
        line: &str,
        out: &mut (impl AsyncWriteExt + Unpin),
    ) -> std::io::Result<()> {
        let Some((value, env)) = envelope(line) else {
            // Not ours to judge: pass it on if we can, otherwise drop it.
            if let Some(link) = &mut self.link
                && write_line(&mut link.write, line).await.is_err()
            {
                self.lose_link(out).await?;
            }
            return Ok(());
        };
        let method = env.method.as_deref();
        if method == Some("initialize") {
            self.initialize = Some(value.clone());
        }
        if method == Some("notifications/initialized") {
            self.initialized = true;
        }
        if self.link.is_none() {
            let replay = method != Some("initialize");
            // A client that initialized while the app was closed holds an empty tool list.
            if self.try_connect(replay).await && replay && self.initialized {
                write_line(out, &list_changed()).await?;
            }
        }
        if let Some(link) = &mut self.link {
            if write_line(&mut link.write, line).await.is_ok() {
                if let (Some(_), Some(id)) = (method, &env.id) {
                    self.pending.insert(id.to_string(), id.clone());
                }
                return Ok(());
            }
            self.lose_link(out).await?;
        }
        if let (Some(method), Some(id)) = (method, &env.id) {
            write_line(out, &offline_reply(&value, method, id)).await?;
        }
        Ok(())
    }

    async fn on_app_line(
        &mut self,
        line: &str,
        out: &mut (impl AsyncWriteExt + Unpin),
    ) -> std::io::Result<()> {
        if let Some((_, env)) = envelope(line)
            && env.method.is_none()
            && let Some(id) = &env.id
        {
            if id.as_str() == Some(REPLAY_ID) {
                return Ok(());
            }
            self.pending.remove(&id.to_string());
        }
        write_line(out, line).await
    }
}

async fn next_app_line(link: &mut Option<Link>) -> std::io::Result<Option<String>> {
    match link {
        Some(link) => link.lines.next_line().await,
        None => std::future::pending().await,
    }
}

async fn run() -> Result<(), String> {
    let mut bridge = Bridge::default();
    let mut from_client = BufReader::new(tokio::io::stdin()).lines();
    let mut to_client = tokio::io::stdout();
    let mut retry = tokio::time::interval(RETRY_EVERY);
    retry.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Delay);

    // Only stdin closing (the client shutting us down) or a dead stdout ends the bridge.
    let io = |e: std::io::Error| e.to_string();
    loop {
        tokio::select! {
            line = from_client.next_line() => match line {
                Ok(Some(line)) => bridge.on_client_line(&line, &mut to_client).await.map_err(io)?,
                _ => return Ok(()),
            },
            line = next_app_line(&mut bridge.link) => match line {
                Ok(Some(line)) => bridge.on_app_line(&line, &mut to_client).await.map_err(io)?,
                _ => bridge.lose_link(&mut to_client).await.map_err(io)?,
            },
            _ = retry.tick(), if bridge.link.is_none() && bridge.initialize.is_some() => {
                if bridge.try_connect(true).await {
                    write_line(&mut to_client, &list_changed()).await.map_err(io)?;
                }
            },
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn envelope_reads_method_and_id() {
        let (_, env) = envelope(r#"{"jsonrpc":"2.0","id":7,"method":"tools/list"}"#).unwrap();
        assert_eq!(env.method.as_deref(), Some("tools/list"));
        assert_eq!(env.id, Some(json!(7)));
        let (_, env) =
            envelope(r#"{"jsonrpc":"2.0","method":"notifications/initialized"}"#).unwrap();
        assert!(env.id.is_none());
        assert!(envelope("not json").is_none());
    }

    #[test]
    fn offline_initialize_echoes_the_client_protocol() {
        let request = json!({ "id": 1, "method": "initialize", "params": { "protocolVersion": "2025-06-18" } });
        let reply: Value =
            serde_json::from_str(&offline_reply(&request, "initialize", &json!(1))).unwrap();
        assert_eq!(reply["result"]["protocolVersion"], "2025-06-18");
        assert_eq!(
            reply["result"]["capabilities"]["tools"]["listChanged"],
            true
        );
    }

    #[test]
    fn offline_calls_fail_but_listing_is_empty() {
        let request = json!({});
        let list: Value =
            serde_json::from_str(&offline_reply(&request, "tools/list", &json!("a"))).unwrap();
        assert_eq!(list["result"]["tools"], json!([]));
        let call: Value =
            serde_json::from_str(&offline_reply(&request, "tools/call", &json!("b"))).unwrap();
        assert_eq!(call["error"]["code"], -32000);
        assert_eq!(call["id"], "b");
    }
}
