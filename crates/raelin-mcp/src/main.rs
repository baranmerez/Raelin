//! `raelin-mcp`: what an AI client starts as its MCP server. It reads the running app's
//! token, connects to the app's named pipe and then copies MCP lines between stdin/stdout
//! and the pipe without looking inside them. Errors go to stderr, which clients log.

use raelin_pipe::{Handshake, PROTOCOL_VERSION, pipe_name, token_path};
use std::process::ExitCode;
use std::time::{Duration, Instant};
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};

const NOT_RUNNING: &str =
    "Raelin açık değil. Önce Raelin masaüstü uygulamasını aç, sonra MCP sunucusunu yeniden başlat.";

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
async fn connect() -> Result<tokio::net::windows::named_pipe::NamedPipeClient, String> {
    use tokio::net::windows::named_pipe::ClientOptions;
    const ERROR_PIPE_BUSY: i32 = 231;
    let name = pipe_name();
    let deadline = Instant::now() + Duration::from_secs(3);
    loop {
        match ClientOptions::new().open(&name) {
            Ok(client) => return Ok(client),
            Err(e) if e.raw_os_error() == Some(ERROR_PIPE_BUSY) && Instant::now() < deadline => {
                tokio::time::sleep(Duration::from_millis(50)).await;
            }
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Err(NOT_RUNNING.into()),
            Err(e) => return Err(format!("Raelin'e bağlanılamadı: {e}")),
        }
    }
}

#[cfg(not(windows))]
async fn connect() -> Result<tokio::io::DuplexStream, String> {
    Err("raelin-mcp şimdilik yalnız Windows'ta çalışıyor.".into())
}

async fn run() -> Result<(), String> {
    let path = token_path().ok_or("APPDATA bulunamadı.")?;
    let token = std::fs::read_to_string(&path).map_err(|_| NOT_RUNNING.to_string())?;
    let pipe = connect().await?;
    let (read, mut write) = tokio::io::split(pipe);
    let mut from_app = BufReader::new(read).lines();

    let hello = Handshake::Hello {
        token: token.trim().to_owned(),
        protocol: PROTOCOL_VERSION,
        client: format!("raelin-mcp/{}", env!("CARGO_PKG_VERSION")),
    };
    let hello = serde_json::to_string(&hello).map_err(|e| e.to_string())?;
    write_line(&mut write, &hello)
        .await
        .map_err(|e| e.to_string())?;
    let reply = tokio::time::timeout(Duration::from_secs(5), from_app.next_line())
        .await
        .map_err(|_| "Raelin yanıt vermedi.".to_string())?
        .map_err(|e| e.to_string())?
        .ok_or_else(|| NOT_RUNNING.to_string())?;
    match serde_json::from_str::<Handshake>(&reply) {
        Ok(Handshake::Welcome { .. }) => {}
        Ok(Handshake::Error { message }) => return Err(message),
        _ => return Err("Beklenmeyen el sıkışma yanıtı.".into()),
    }

    let mut from_client = BufReader::new(tokio::io::stdin()).lines();
    let mut to_client = tokio::io::stdout();
    loop {
        tokio::select! {
            line = from_client.next_line() => match line {
                Ok(Some(line)) => {
                    if write_line(&mut write, &line).await.is_err() {
                        return Err("Raelin bağlantısı kapandı.".into());
                    }
                }
                // Client closed stdin: normal shutdown.
                _ => return Ok(()),
            },
            line = from_app.next_line() => match line {
                Ok(Some(line)) => {
                    if write_line(&mut to_client, &line).await.is_err() {
                        return Ok(());
                    }
                }
                _ => return Err("Raelin kapandı; MCP sunucusunu yeniden başlat.".into()),
            },
        }
    }
}
