# Development

## Layout

| Path | What lives there |
|---|---|
| `src/model` | Board types, ids, the `.rli` file format (`serialize.ts`), Markdown export |
| `src/state` | The zustand store: workspace, per-board history and runtime revisions |
| `src/canvas` | React Flow canvas, node views, tools, clipboard, pictures |
| `src/app` | Top bar, tabs, panels, save/open actions, PNG/SVG export |
| `src/commands` | The typed command layer shared by AI clients: schema, `applyOps`, layout, describe |
| `src/mcp` | The MCP server that runs in the page, one per bridge connection |
| `src/platform` | File access through Rust, pictures, the recovery copy |
| `src-tauri` | Rust host: file commands with a path allowlist, the named pipe host, single instance |
| `crates/raelin-pipe` | What the app and the bridge share: pipe name, token path, handshake, user check |
| `crates/raelin-mcp` | The stdio bridge AI clients start |

## Raelin and Raelin Dev

`npm run desktop` starts **Raelin Dev**: a debug build with its own identity (`app.raelin.dev`), settings, recovery copy, MCP pipe and token, marked with a DEV badge. It runs next to the installed Raelin without touching it. The identity follows the build profile (`cfg!(debug_assertions)` in `crates/raelin-pipe`), and a debug build started with the release config (`npm run tauri dev`) refuses to start.

To let an AI client work on Raelin Dev, register the debug bridge under a second name:

```bash
claude mcp add raelin-dev -- C:\path\to\raelin\target\debug\raelin-mcp.exe
```

Keep everyday clients on the installed bridge: a dev rebuild replaces `target\debug\raelin-mcp.exe`, which fails while a client is running that file. Close AI clients before reinstalling for the same reason.

The UI also runs in a plain browser with `npm run dev`; saving and opening files need the desktop shell.

## The MCP bridge

- The app serves `\\.\pipe\raelin-mcp-<user>` (`raelin-mcp-dev-<user>` for Raelin Dev). The pipe's ACL admits only the current user and SYSTEM, remote clients are rejected, and the first-instance flag stops a second server from sharing the name.
- On every launch the app writes a random token to `%APPDATA%\<identifier>\mcp-token`. The bridge sends it in a one-line handshake, after checking that the process serving the pipe runs as the same user.
- After the handshake both sides exchange newline-delimited JSON-RPC unchanged; Rust relays it to the page, where `src/mcp/tools.ts` serves the tools over `src/commands`.
- While the app is closed the bridge answers `initialize` and `tools/list` itself, fails other calls, and retries every two seconds. On reconnect it replays the client's `initialize` and sends `notifications/tools/list_changed`.

## Packaging

`npm run tauri build` runs `scripts/prepare-bridge.mjs`, which builds `raelin-mcp` and copies it to `src-tauri/binaries/` for Tauri's `externalBin`. The NSIS installer installs per user, registers `.rli` files, and `src-tauri/windows/hooks.nsh` adds Raelin to Explorer's *Open with* list.

> [!NOTE]
> Run the installer from Explorer. Started from inside a packaged (MSIX) app, Windows redirects its `AppData` and registry writes into that package, and the install is invisible to everything else.

The app icon is generated from `src-tauri/icons/source.svg`:

```bash
npx tauri icon src-tauri/icons/source.svg
```

## Checks

```bash
npm run typecheck
npm run lint
npm test
cargo clippy --workspace --all-targets -- -D warnings
cargo test --workspace
```

The README pictures in `docs/assets` are hand-written SVGs animated with CSS; each one also renders as a still picture when motion is reduced.
