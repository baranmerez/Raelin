//! What the desktop app and the `raelin-mcp` bridge must agree on: where the pipe and
//! the session token live, and the one-line handshake before MCP messages flow.
//!
//! After the handshake both sides exchange newline-delimited JSON-RPC (the MCP stdio
//! framing) unchanged; the app forwards it to the UI, where the MCP server runs.

#[cfg(windows)]
pub mod identity;

use serde::{Deserialize, Serialize};
use std::path::PathBuf;

/// Bumped on any change to the handshake or framing.
pub const PROTOCOL_VERSION: u32 = 1;

/// Must match `identifier` in `src-tauri/tauri.conf.json` (release) and
/// `src-tauri/tauri.dev.conf.json` (debug); Tauri's app config dir is
/// `%APPDATA%\<identifier>` on Windows. Debug builds are "Raelin Dev": their own
/// identity, pipe and token, so they run next to the installed app and AI clients never
/// mix the two up.
pub const APP_IDENTIFIER: &str = if cfg!(debug_assertions) {
    "app.raelin.dev"
} else {
    "app.raelin.desktop"
};

const PIPE_PREFIX: &str = if cfg!(debug_assertions) {
    "raelin-mcp-dev-"
} else {
    "raelin-mcp-"
};

const TOKEN_FILE: &str = "mcp-token";

/// Per-user pipe name. The pipe's ACL is what keeps other users out; the name only
/// keeps two signed-in users from colliding.
pub fn pipe_name() -> String {
    let user: String = std::env::var("USERNAME")
        .unwrap_or_default()
        .chars()
        .filter(|c| c.is_ascii_alphanumeric() || *c == '-' || *c == '_')
        .collect();
    format!(
        r"\\.\pipe\{PIPE_PREFIX}{}",
        if user.is_empty() { "user" } else { &user }
    )
}

/// File holding the token of the running app; rewritten on every app start.
pub fn token_path() -> Option<PathBuf> {
    let appdata = std::env::var_os("APPDATA")?;
    Some(PathBuf::from(appdata).join(APP_IDENTIFIER).join(TOKEN_FILE))
}

#[derive(Debug, Serialize, Deserialize, PartialEq)]
#[serde(tag = "type", rename_all = "lowercase")]
pub enum Handshake {
    Hello {
        token: String,
        protocol: u32,
        client: String,
    },
    Welcome {
        session: u64,
        protocol: u32,
    },
    Error {
        message: String,
    },
}

/// Compares secrets without stopping at the first differing byte.
pub fn same_secret(a: &str, b: &str) -> bool {
    let (a, b) = (a.as_bytes(), b.as_bytes());
    if a.len() != b.len() {
        return false;
    }
    a.iter().zip(b).fold(0u8, |acc, (x, y)| acc | (x ^ y)) == 0
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn handshake_round_trips_as_tagged_json() {
        let hello = Handshake::Hello {
            token: "t".into(),
            protocol: PROTOCOL_VERSION,
            client: "raelin-mcp".into(),
        };
        let text = serde_json::to_string(&hello).unwrap();
        assert!(text.starts_with(r#"{"type":"hello""#));
        assert_eq!(serde_json::from_str::<Handshake>(&text).unwrap(), hello);
    }

    #[test]
    fn pipe_name_is_local_and_sanitized() {
        assert!(pipe_name().starts_with(r"\\.\pipe\raelin-mcp-"));
        assert!(!pipe_name()[9..].contains('\\'));
    }

    #[test]
    fn secrets_compare_exactly() {
        assert!(same_secret("abc", "abc"));
        assert!(!same_secret("abc", "abd"));
        assert!(!same_secret("abc", "abcd"));
    }
}
