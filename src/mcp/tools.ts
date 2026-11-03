import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { applyOps, CommandError, isDestructive } from "../commands/apply";
import { describeBoard, describeOverview, maxLimit, searchWorkspace } from "../commands/describe";
import { layoutBoard } from "../commands/layout";
import { opSchema } from "../commands/schema";
import { boardToMarkdown } from "../model/markdown";
import type { BoardDoc } from "../model/types";
import { confirmAction } from "../platform/storage";
import { useBoardStore } from "../state/boardStore";

const instructions = [
  "Raelin is a canvas of boards holding flow steps (flowNode), notes, regions and edges.",
  "Start with get_overview; read only what you need (read_board with regionId/ids/kinds, or search).",
  "Write with ONE apply_changes call per intent: pass the board revision you read as expectedRevision,",
  "give new nodes a ref and use refs in later ops of the same batch. Place nodes with",
  "place.after (below a node) or place.in (inside a region) instead of coordinates; then call layout",
  "to tidy a region. On STALE_REVISION re-read and retry. Deletes ask the user for confirmation.",
].join(" ");

type ToolText = { content: { type: "text"; text: string }[]; isError?: boolean };

function ok(value: unknown): ToolText {
  return { content: [{ type: "text", text: JSON.stringify(value) }] };
}

function fail(error: unknown, extra: Record<string, unknown> = {}): ToolText {
  const body =
    error instanceof CommandError
      ? {
          error: error.code,
          message: error.message,
          ...(error.index !== undefined ? { index: error.index } : {}),
        }
      : { error: "INTERNAL", message: error instanceof Error ? error.message : String(error) };
  return {
    content: [{ type: "text", text: JSON.stringify({ ...body, ...extra }) }],
    isError: true,
  };
}

/** Results of recent batches by opId, so a retried request is answered, not re-applied. */
const opCache = new Map<string, { at: number; result: ToolText }>();
const opCacheTtl = 10 * 60 * 1000;

function cached(key: string | null): ToolText | undefined {
  if (!key) return undefined;
  const hit = opCache.get(key);
  if (hit && Date.now() - hit.at < opCacheTtl) return hit.result;
  opCache.delete(key);
  return undefined;
}

function remember(key: string | null, result: ToolText) {
  if (!key) return;
  opCache.set(key, { at: Date.now(), result });
  if (opCache.size > 300) opCache.delete(opCache.keys().next().value as string);
}

const knownClients: Record<string, string> = {
  "claude-code": "Claude Code",
  "claude-ai": "Claude Desktop",
  "codex-mcp-client": "Codex",
};

export function clientLabel(name: string | undefined): string {
  if (!name) return "AI";
  return knownClients[name] ?? name;
}

function boardOrFail(boardId: string | undefined): {
  id: string;
  board: BoardDoc;
  revision: number;
} {
  const s = useBoardStore.getState();
  const id = boardId ?? s.activeBoardId;
  const board = s.workspace.boards[id];
  if (!board) throw new CommandError("NO_BOARD", `Pano bulunamadı: ${id}`);
  return { id, board, revision: s.revisions[id] ?? 0 };
}

function checkRevision(id: string, expected: number) {
  const current = useBoardStore.getState().revisions[id] ?? 0;
  if (current !== expected) {
    throw Object.assign(new CommandError("STALE_REVISION", "Pano bu arada değişti; yeniden oku."), {
      currentRevision: current,
    });
  }
}

/**
 * Commits an AI change as one labelled undo step and offers an undo button that only
 * acts while nothing else has touched the board since.
 */
function commitFromClient(id: string, next: BoardDoc, client: string, summary: string): number {
  const store = useBoardStore.getState();
  const revision = store.commitTo(id, next, `${client}: ${summary}`);
  store.showToast(`${client} ${summary}`, "ok", {
    label: "Geri al",
    run: () => {
      const s = useBoardStore.getState();
      if (s.revisions[id] === revision) s.undoBoard(id);
      else s.showToast("Geri alınamadı: bu arada panoda başka değişiklik oldu.", "error");
    },
  });
  return revision;
}

function failWithRevision(error: unknown): ToolText {
  const currentRevision = (error as { currentRevision?: number }).currentRevision;
  return fail(error, currentRevision !== undefined ? { currentRevision } : {});
}

export function createRaelinServer(): McpServer {
  const server = new McpServer({ name: "raelin", version: "0.1.0" }, { instructions });
  const client = () => clientLabel(server.server.getClientVersion()?.name);

  server.registerTool(
    "get_overview",
    {
      description: "Boards with ids, revisions, item counts and region titles. Cheap; call first.",
      inputSchema: {},
      annotations: { readOnlyHint: true },
    },
    async () => {
      const s = useBoardStore.getState();
      return ok(describeOverview(s.workspace, s.revisions, s.activeBoardId, s.selectedIds.length));
    },
  );

  server.registerTool(
    "get_selection",
    {
      description: "What the user has selected on the active board, in the read_board format.",
      inputSchema: { textLimit: z.number().int().min(20).max(5000).optional() },
      annotations: { readOnlyHint: true },
    },
    async ({ textLimit }) => {
      const s = useBoardStore.getState();
      const board = s.workspace.boards[s.activeBoardId];
      if (!board) return fail(new CommandError("NO_BOARD", "Açık pano yok."));
      if (s.selectedIds.length === 0)
        return ok({ board: board.id, revision: s.revisions[board.id] ?? 0, items: [] });
      return ok(
        describeBoard(board, s.revisions[board.id] ?? 0, { ids: s.selectedIds, textLimit }),
      );
    },
  );

  server.registerTool(
    "read_board",
    {
      description:
        "Compact items and edges of one board, top to bottom. Narrow with regionId, ids or kinds. Long text is clipped; page with cursor.",
      inputSchema: {
        boardId: z.string().optional().describe("Defaults to the active board."),
        regionId: z.string().optional(),
        ids: z.array(z.string()).max(maxLimit).optional(),
        kinds: z.array(z.enum(["flowNode", "note", "region", "stroke"])).optional(),
        limit: z.number().int().min(1).max(maxLimit).optional(),
        cursor: z.number().int().min(0).optional(),
        textLimit: z.number().int().min(20).max(5000).optional(),
        withGeometry: z.boolean().optional().describe("Add geo:[x,y,w,h]; rarely needed."),
      },
      annotations: { readOnlyHint: true },
    },
    async ({ boardId, ...options }) => {
      try {
        const { board, revision } = boardOrFail(boardId);
        return ok(describeBoard(board, revision, options));
      } catch (error) {
        return fail(error);
      }
    },
  );

  server.registerTool(
    "search",
    {
      description:
        "Case-insensitive text search in step labels, note titles/bodies and region titles.",
      inputSchema: {
        query: z.string().min(1).max(200),
        boardId: z.string().optional(),
        limit: z.number().int().min(1).max(200).optional(),
      },
      annotations: { readOnlyHint: true },
    },
    async ({ query, boardId, limit }) =>
      ok(searchWorkspace(useBoardStore.getState().workspace, query, { boardId, limit })),
  );

  server.registerTool(
    "export_markdown",
    {
      description:
        "Readable Markdown summary of a board (or of given ids): regions, ordered flow steps with decision labels, notes, references.",
      inputSchema: {
        boardId: z.string().optional(),
        ids: z.array(z.string()).max(maxLimit).optional(),
      },
      annotations: { readOnlyHint: true },
    },
    async ({ boardId, ids }) => {
      try {
        const { board } = boardOrFail(boardId);
        return {
          content: [{ type: "text", text: boardToMarkdown(board, ids ? new Set(ids) : undefined) }],
        };
      } catch (error) {
        return fail(error);
      }
    },
  );

  server.registerTool(
    "apply_changes",
    {
      description:
        "Atomic batch on one board: add, update, connect, update_edge, move, delete, style. All ops apply or none. Returns new revision, refs → ids and changed ids only.",
      inputSchema: {
        boardId: z.string().optional().describe("Defaults to the active board."),
        expectedRevision: z.number().int().describe("Revision from your last read of this board."),
        opId: z
          .string()
          .max(80)
          .optional()
          .describe("Idempotency key; a retry with the same opId is not applied twice."),
        ops: z.array(opSchema).min(1),
      },
      annotations: { destructiveHint: true },
    },
    async ({ boardId, expectedRevision, opId, ops }) => {
      try {
        const { id, board } = boardOrFail(boardId);
        const key = opId ? `${id}:${opId}` : null;
        const hit = cached(key);
        if (hit) return hit;
        checkRevision(id, expectedRevision);
        const result = applyOps(board, ops);
        if (isDestructive(ops)) {
          const what =
            result.removed.length > 0
              ? `${result.removed.length} öğeyi silmek`
              : `${result.changed.length} öğeyi taşımak`;
          const approved = await confirmAction(
            `${client()} "${board.title}" panosunda ${what} istiyor. Onaylıyor musun?`,
          );
          if (!approved)
            return fail(new CommandError("REJECTED", "Kullanıcı bu değişikliği onaylamadı."));
          checkRevision(id, expectedRevision);
        }
        const total = result.created.length + result.changed.length + result.removed.length;
        const revision = commitFromClient(id, result.board, client(), `${total} değişiklik yaptı`);
        const response = ok({
          revision,
          refs: result.refs,
          created: result.created,
          changed: result.changed,
          removed: result.removed,
          ...(result.warnings.length > 0 ? { warnings: result.warnings } : {}),
        });
        remember(key, response);
        return response;
      } catch (error) {
        return failWithRevision(error);
      }
    },
  );

  server.registerTool(
    "layout",
    {
      description:
        "Deterministic auto layout of flow steps and notes along flow edges: inside a region (grows to fit), for given ids, or for everything outside regions.",
      inputSchema: {
        boardId: z.string().optional(),
        expectedRevision: z.number().int(),
        regionId: z.string().optional(),
        ids: z.array(z.string()).max(maxLimit).optional(),
        direction: z
          .enum(["TB", "LR"])
          .optional()
          .describe("TB top-down (default) or LR left-right."),
        opId: z.string().max(80).optional(),
      },
    },
    async ({ boardId, expectedRevision, regionId, ids, direction, opId }) => {
      try {
        const { id, board } = boardOrFail(boardId);
        const key = opId ? `${id}:layout:${opId}` : null;
        const hit = cached(key);
        if (hit) return hit;
        checkRevision(id, expectedRevision);
        const result = layoutBoard(board, { regionId, ids, direction });
        if (result.moved.length === 0) {
          return ok({ revision: expectedRevision, moved: [] });
        }
        if (result.moved.length > 30) {
          const approved = await confirmAction(
            `${client()} "${board.title}" panosunda ${result.moved.length} öğeyi yeniden yerleştirmek istiyor. Onaylıyor musun?`,
          );
          if (!approved)
            return fail(new CommandError("REJECTED", "Kullanıcı yeniden yerleşimi onaylamadı."));
          checkRevision(id, expectedRevision);
        }
        const revision = commitFromClient(
          id,
          result.board,
          client(),
          `${result.moved.length} öğeyi yerleştirdi`,
        );
        const response = ok({ revision, moved: result.moved });
        remember(key, response);
        return response;
      } catch (error) {
        return failWithRevision(error);
      }
    },
  );

  server.registerTool(
    "create_board",
    {
      description:
        "Create an empty board (does not switch the user's view). Returns id and revision.",
      inputSchema: { title: z.string().min(1).max(120) },
    },
    async ({ title }) => {
      const store = useBoardStore.getState();
      const id = store.createBoard(title);
      store.showToast(`${client()} "${title}" panosunu oluşturdu.`);
      return ok({ id, revision: useBoardStore.getState().revisions[id] ?? 0 });
    },
  );

  return server;
}
