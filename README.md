# Raelin

A free-form desktop canvas for working through ideas: notes, sketches, flowcharts and
database sketches on one board, with an AI that can read and edit the same board over MCP.

Status: early spike. Nothing here is stable yet.

## Stack

- Tauri 2 desktop shell (Windows first), Rust host for file access
- React 19, TypeScript 7, Vite 8
- React Flow for nodes and edges, Tiptap for rich text, perfect-freehand for pen strokes

## Develop

```bash
npm install
npm run tauri dev
```

The UI also runs in a plain browser with `npm run dev` (file save/open needs the desktop shell).

## Connect an AI client (MCP)

Raelin must be running; AI changes appear live and undo with Ctrl+Z. Build the bridge once:

```bash
cargo build -p raelin-mcp
```

Then point your client at `target\debug\raelin-mcp.exe` (use the full path):

- Claude Code: `claude mcp add raelin -- C:\path\to\raelin\target\debug\raelin-mcp.exe`
- Claude Desktop (`claude_desktop_config.json`):
  `{ "mcpServers": { "raelin": { "command": "C:\\path\\to\\raelin\\target\\debug\\raelin-mcp.exe" } } }`
- Codex (`~/.codex/config.toml`):
  `[mcp_servers.raelin]` and `command = 'C:\path\to\raelin\target\debug\raelin-mcp.exe'`

The bridge talks to the app over a per-user named pipe with a per-launch token. Tool call
sizes (never content) are logged to `%APPDATA%\app.raelin.desktop\logs\mcp-usage.jsonl`.

## License

MIT
