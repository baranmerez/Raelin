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

## License

MIT
