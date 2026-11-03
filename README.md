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
npm run desktop
```

This starts **Raelin Dev**: a debug build with its own identity (`app.raelin.dev`), settings,
recovery copy and MCP pipe, marked with a DEV badge. It runs next to the installed Raelin
without touching it; a debug build started with the release config refuses to start.
For AI clients, register the dev bridge separately, e.g.
`claude mcp add raelin-dev -- C:\path\to\raelin\target\debug\raelin-mcp.exe`.

The UI also runs in a plain browser with `npm run dev` (file save/open needs the desktop shell).

## Workspace file

A workspace is one `.rli` file: JSON with sorted keys, the boards in tab order (items
sorted by id) and pasted pictures as base64 under `assets`. Saving the same workspace twice
writes the same text. Unsaved edits are mirrored to a local recovery copy (without
pictures) until the next save.

## Connect an AI client (MCP)

AI changes appear live and undo with Ctrl+Z. The bridge may start before Raelin does and
survives app restarts: it reconnects on its own and tells the client the tool list changed.

The installer puts the bridge next to the app, at `%LOCALAPPDATA%\Raelin\raelin-mcp.exe`.
Point your client at that full path:

- Claude Code: `claude mcp add --scope user raelin -- "%LOCALAPPDATA%\Raelin\raelin-mcp.exe"`
  (expand the variable if your shell does not)
- Claude Desktop (`claude_desktop_config.json`):
  `{ "mcpServers": { "raelin": { "command": "C:\\Users\\you\\AppData\\Local\\Raelin\\raelin-mcp.exe" } } }`
- Codex (`~/.codex/config.toml`):
  `[mcp_servers.raelin]` and `command = 'C:\Users\you\AppData\Local\Raelin\raelin-mcp.exe'`

Use the installed copy even while developing: `npm run tauri dev` rebuilds and replaces
`target\debug\raelin-mcp.exe`, which fails while a client is running that file. Close AI
clients before reinstalling for the same reason.

The bridge talks to the app over a per-user named pipe with a per-launch token. Tool call
sizes (never content) are logged to `%LOCALAPPDATA%\app.raelin.desktop\logs\mcp-usage.jsonl`.

## License

MIT
