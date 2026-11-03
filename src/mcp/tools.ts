import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { viewController } from "../canvas/viewController";
import { applyOps, CommandError, isDestructive } from "../commands/apply";
import { copyItems, itemsWithContents } from "../commands/copy";
import { describeBoard, describeOverview, maxLimit, searchWorkspace } from "../commands/describe";
import { findReplace } from "../commands/findReplace";
import { recentChanges } from "../commands/history";
import { layoutBoard } from "../commands/layout";
import { opSchema } from "../commands/schema";
import { placeTemplate } from "../commands/template";
import { newId } from "../model/ids";
import { boardToMarkdown } from "../model/markdown";
import type { BoardDoc } from "../model/types";
import { isNodeItem } from "../model/types";
import { confirmAction } from "../platform/storage";
import { removeItems, useBoardStore } from "../state/boardStore";

const instructions = [
  "Raelin is a canvas of boards holding flow steps (flowNode), notes, regions, text, checklists,",
  "link cards, table cards (ER design: relations are reference edges) and edges.",
  "Start with get_overview; read only what you need (read_board with regionId/ids/kinds, or search).",
  "Write with ONE apply_changes call per intent: pass the board revision you read as expectedRevision,",
  "give new nodes a ref and use refs in later ops of the same batch. Place nodes with",
  "place.after (below a node) or place.in (inside a region) instead of coordinates; then call layout",
  "to tidy a region. On STALE_REVISION re-read and retry. Deletes ask the user for confirmation.",
  "Also: find_replace (dryRun first), copy_items between boards, rename/duplicate/delete_board,",
  "view_board for a picture, select/focus to show the user something, recent_changes for history,",
  "apply_template for a mind map, kanban or swimlane.",
].join(" ");

type ToolText = { content: { type: "text"; text: string }[]; isError?: boolean };

const confirmLimit = 20;

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
  return commitManyFromClient([{ id, next }], client, summary)[0];
}

/**
 * Several boards changed by one AI action: one step per board, grouped so that Ctrl+Z on
 * any of them (or the toast's button) undoes the whole action.
 */
function commitManyFromClient(
  changes: { id: string; next: BoardDoc }[],
  client: string,
  summary: string,
): number[] {
  const store = useBoardStore.getState();
  const group = changes.length > 1 ? newId("g") : undefined;
  const revisions = changes.map(({ id, next }) =>
    store.commitTo(id, next, `${client}: ${summary}`, group),
  );
  store.showToast(`${client} ${summary}`, "ok", {
    label: "Geri al",
    run: () => {
      const s = useBoardStore.getState();
      if (changes.every(({ id }, i) => s.revisions[id] === revisions[i])) {
        s.undoBoard(changes[0].id);
      } else s.showToast("Geri alınamadı: bu arada panoda başka değişiklik oldu.", "error");
    },
  });
  return revisions;
}

async function confirmOrReject(message: string): Promise<void> {
  if (!(await confirmAction(message))) {
    throw new CommandError("REJECTED", "Kullanıcı bu değişikliği onaylamadı.");
  }
}

/** The active board, or NO_BOARD telling the client to call focus first. */
function activeOrFail(boardId: string | undefined) {
  const s = useBoardStore.getState();
  if (boardId && boardId !== s.activeBoardId) {
    throw new CommandError(
      "NO_BOARD",
      `Pano açık değil: ${boardId}. Önce focus ile bu panoyu aç (açık pano: ${s.activeBoardId}).`,
    );
  }
  return boardOrFail(s.activeBoardId);
}

/** ids plus regionId, all of which must exist on the board. */
function existingIds(board: BoardDoc, ids: string[] | undefined, regionId?: string): string[] {
  const wanted = [...(ids ?? []), ...(regionId ? [regionId] : [])];
  const present = new Set(board.items.map((i) => i.id));
  const missing = wanted.filter((w) => !present.has(w));
  if (missing.length > 0) {
    throw new CommandError("NOT_FOUND", `Öğe bulunamadı: ${missing.slice(0, 5).join(", ")}`);
  }
  return wanted;
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
        kinds: z
          .array(
            z.enum([
              "flowNode",
              "note",
              "region",
              "stroke",
              "image",
              "text",
              "arrow",
              "checklist",
              "link",
              "table",
            ]),
          )
          .optional(),
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

  server.registerTool(
    "apply_template",
    {
      description:
        "Add a ready-made layout: mindMap, kanban (3 columns) or swimlane (3 lanes). Placed right of the content or centred on at. One undo step; returns new ids.",
      inputSchema: {
        boardId: z.string().optional(),
        expectedRevision: z.number().int(),
        template: z.enum(["mindMap", "kanban", "swimlane"]),
        at: z.object({ x: z.number().finite(), y: z.number().finite() }).optional(),
        opId: z.string().max(80).optional(),
      },
    },
    async ({ boardId, expectedRevision, template, at, opId }) => {
      try {
        const { id, board } = boardOrFail(boardId);
        const key = opId ? `${id}:template:${opId}` : null;
        const hit = cached(key);
        if (hit) return hit;
        checkRevision(id, expectedRevision);
        const result = placeTemplate(board, template, at);
        const revision = commitFromClient(id, result.board, client(), "şablon ekledi");
        const response = ok({ revision, created: result.created });
        remember(key, response);
        return response;
      } catch (error) {
        return failWithRevision(error);
      }
    },
  );

  server.registerTool(
    "rename_board",
    {
      description: "Rename a board (one undo step).",
      inputSchema: {
        boardId: z.string(),
        expectedRevision: z.number().int(),
        title: z.string().min(1).max(120),
      },
    },
    async ({ boardId, expectedRevision, title }) => {
      try {
        const { id, board } = boardOrFail(boardId);
        checkRevision(id, expectedRevision);
        const clean = title.trim();
        if (!clean) throw new CommandError("INVALID", "Pano adı boş olamaz.");
        if (clean === board.title) return ok({ revision: expectedRevision });
        const revision = commitFromClient(
          id,
          { ...board, title: clean },
          client(),
          `panoyu "${clean}" olarak adlandırdı`,
        );
        return ok({ revision });
      } catch (error) {
        return failWithRevision(error);
      }
    },
  );

  server.registerTool(
    "duplicate_board",
    {
      description: "Copy a board with fresh ids, next to the original (view stays). Returns id.",
      inputSchema: {
        boardId: z.string(),
        title: z.string().max(120).optional(),
        opId: z.string().max(80).optional(),
      },
    },
    async ({ boardId, title, opId }) => {
      try {
        const { id } = boardOrFail(boardId);
        const key = opId ? `${id}:duplicate:${opId}` : null;
        const hit = cached(key);
        if (hit) return hit;
        const store = useBoardStore.getState();
        const copyId = store.duplicateBoard(id, { open: false, title });
        if (!copyId) throw new CommandError("NO_BOARD", `Pano bulunamadı: ${id}`);
        const copy = useBoardStore.getState().workspace.boards[copyId];
        const revision = useBoardStore.getState().revisions[copyId] ?? 0;
        store.showToast(`${client()} "${copy.title}" kopyasını oluşturdu.`, "ok", {
          label: "Geri al",
          run: () => {
            const s = useBoardStore.getState();
            if (s.revisions[copyId] === revision) s.deleteBoard(copyId);
            else s.showToast("Geri alınamadı: kopya bu arada değişti.", "error");
          },
        });
        const response = ok({ id: copyId, title: copy.title, revision });
        remember(key, response);
        return response;
      } catch (error) {
        return fail(error);
      }
    },
  );

  server.registerTool(
    "delete_board",
    {
      description: "Delete a board (asks the user; never the last board; the user can restore).",
      inputSchema: { boardId: z.string(), expectedRevision: z.number().int() },
      annotations: { destructiveHint: true },
    },
    async ({ boardId, expectedRevision }) => {
      try {
        const { id, board } = boardOrFail(boardId);
        checkRevision(id, expectedRevision);
        const lastBoard = () => useBoardStore.getState().workspace.manifest.boards.length <= 1;
        if (lastBoard()) throw new CommandError("INVALID", "Son pano silinemez.");
        await confirmOrReject(
          `${client()} "${board.title}" panosunu (${board.items.length} öğe) silmek istiyor. Onaylıyor musun?`,
        );
        checkRevision(id, expectedRevision);
        if (lastBoard()) throw new CommandError("INVALID", "Son pano silinemez.");
        const store = useBoardStore.getState();
        const removed = store.deleteBoard(id);
        if (!removed) throw new CommandError("NO_BOARD", `Pano bulunamadı: ${id}`);
        store.showToast(`${client()} "${board.title}" panosunu sildi.`, "ok", {
          label: "Geri al",
          run: () => useBoardStore.getState().restoreBoard(removed),
        });
        return ok({ deleted: id, activeBoard: useBoardStore.getState().activeBoardId });
      } catch (error) {
        return failWithRevision(error);
      }
    },
  );

  server.registerTool(
    "copy_items",
    {
      description:
        "Copy ids (with region contents and edges among them) to another board with fresh ids. move:true also removes them from the source (asks the user; needs sourceRevision); both boards undo together.",
      inputSchema: {
        fromBoardId: z.string(),
        toBoardId: z.string(),
        ids: z.array(z.string()).min(1).max(maxLimit),
        expectedRevision: z.number().int().describe("Revision of the target board."),
        sourceRevision: z.number().int().optional(),
        move: z.boolean().optional(),
        place: z
          .object({
            after: z.string().optional(),
            in: z.string().optional(),
            x: z.number().finite().optional(),
            y: z.number().finite().optional(),
          })
          .optional()
          .describe("Target spot like apply_changes place; default right of its content."),
        opId: z.string().max(80).optional(),
      },
    },
    async ({
      fromBoardId,
      toBoardId,
      ids,
      expectedRevision,
      sourceRevision,
      move,
      place,
      opId,
    }) => {
      try {
        const from = boardOrFail(fromBoardId);
        const to = boardOrFail(toBoardId);
        const key = opId ? `${to.id}:copy:${opId}` : null;
        const hit = cached(key);
        if (hit) return hit;
        if (move && from.id === to.id) {
          throw new CommandError("INVALID", "Aynı panoda taşımak için apply_changes move kullan.");
        }
        if (move && sourceRevision === undefined) {
          throw new CommandError("INVALID", "move için sourceRevision gerekli.");
        }
        const checkBoth = () => {
          checkRevision(to.id, expectedRevision);
          if (move) checkRevision(from.id, sourceRevision as number);
        };
        checkBoth();
        const result = copyItems(from.board, to.board, ids, place);
        const copied = new Set(result.copied);
        if (move) {
          await confirmOrReject(
            `${client()} "${from.board.title}" panosundan ${copied.size} öğeyi "${to.board.title}" panosuna taşımak istiyor. Onaylıyor musun?`,
          );
          checkBoth();
        }
        const changes = [{ id: to.id, next: result.board }];
        if (move) changes.push({ id: from.id, next: removeItems(from.board, copied) });
        const [revision, newSourceRevision] = commitManyFromClient(
          changes,
          client(),
          `${copied.size} öğeyi "${to.board.title}" panosuna ${move ? "taşıdı" : "kopyaladı"}`,
        );
        const response = ok({
          revision,
          ...(move ? { sourceRevision: newSourceRevision } : {}),
          ids: result.ids,
        });
        remember(key, response);
        return response;
      } catch (error) {
        return failWithRevision(error);
      }
    },
  );

  server.registerTool(
    "find_replace",
    {
      description:
        "Find/replace text in steps, notes, regions, edge labels, image alt, free text, checklists, link and table cards. dryRun lists matches; otherwise one atomic step (needs expectedRevision).",
      inputSchema: {
        boardId: z.string().optional(),
        find: z.string().min(1).max(200),
        replace: z.string().max(2000),
        caseSensitive: z.boolean().optional(),
        dryRun: z.boolean().optional(),
        expectedRevision: z.number().int().optional(),
        opId: z.string().max(80).optional(),
      },
    },
    async ({ boardId, find, replace, caseSensitive, dryRun, expectedRevision, opId }) => {
      try {
        const { id, board, revision: current } = boardOrFail(boardId);
        const key = opId && !dryRun ? `${id}:replace:${opId}` : null;
        const hit = cached(key);
        if (hit) return hit;
        if (!dryRun && expectedRevision === undefined) {
          throw new CommandError("INVALID", "Değiştirmek için expectedRevision gerekli.");
        }
        if (!dryRun) checkRevision(id, expectedRevision as number);
        const result = findReplace(board, { find, replace, caseSensitive });
        const matches = result.matches.slice(0, 50);
        const summary = {
          total: result.total,
          items: result.changed.length,
          matches,
          ...(matches.length < result.matches.length ? { truncated: true } : {}),
        };
        if (dryRun || result.changed.length === 0) return ok({ revision: current, ...summary });
        if (result.changed.length > confirmLimit) {
          await confirmOrReject(
            `${client()} "${board.title}" panosunda ${result.changed.length} öğede "${find}" metnini değiştirmek istiyor. Onaylıyor musun?`,
          );
          checkRevision(id, expectedRevision as number);
        }
        const revision = commitFromClient(
          id,
          result.board,
          client(),
          `${result.changed.length} öğede metni değiştirdi`,
        );
        const response = ok({ revision, total: result.total, changed: result.changed });
        remember(key, response);
        return response;
      } catch (error) {
        return failWithRevision(error);
      }
    },
  );

  server.registerTool(
    "view_board",
    {
      description:
        "PNG of the active board as the user sees it (whole, a region, or ids), longest side ≤1200 px.",
      inputSchema: {
        boardId: z.string().optional().describe("Must be the active board; else call focus first."),
        regionId: z.string().optional(),
        ids: z.array(z.string()).max(maxLimit).optional(),
      },
      annotations: { readOnlyHint: true },
    },
    async ({ boardId, regionId, ids }) => {
      try {
        const { board } = activeOrFail(boardId);
        const wanted = existingIds(board, ids, regionId);
        const view = viewController();
        if (!view) throw new CommandError("NO_BOARD", "Tuval hazır değil.");
        const scope =
          wanted.length > 0 ? new Set(itemsWithContents(board, wanted).map((i) => i.id)) : null;
        const { renderBoardImage } = await import("../app/exportImage");
        const url = await renderBoardImage(view.getNodes(), { kind: "png", scope, maxSide: 1200 });
        if (!url) throw new CommandError("NOT_FOUND", "Çizilecek öğe yok.");
        return {
          content: [
            {
              type: "image" as const,
              data: url.slice(url.indexOf(",") + 1),
              mimeType: "image/png",
            },
          ],
        };
      } catch (error) {
        return fail(error);
      }
    },
  );

  server.registerTool(
    "select",
    {
      description: "Set the user's selection on the active board (empty ids clears it).",
      inputSchema: {
        ids: z.array(z.string()).max(maxLimit),
        boardId: z.string().optional().describe("Must be the active board."),
      },
    },
    async ({ ids, boardId }) => {
      try {
        const { board } = activeOrFail(boardId);
        const present = new Set(board.items.map((i) => i.id));
        const selected = [...new Set(ids)].filter((id) => present.has(id));
        const missing = ids.filter((id) => !present.has(id));
        if (ids.length > 0 && selected.length === 0) {
          throw new CommandError("NOT_FOUND", `Öğe bulunamadı: ${missing.slice(0, 5).join(", ")}`);
        }
        useBoardStore.getState().setSelection(selected);
        return ok({ selected: selected.length, ...(missing.length > 0 ? { missing } : {}) });
      } catch (error) {
        return fail(error);
      }
    },
  );

  server.registerTool(
    "focus",
    {
      description:
        "Show the user a board (switches the active board) and fit the view to ids or a region (default: whole board).",
      inputSchema: {
        boardId: z.string().optional(),
        ids: z.array(z.string()).max(maxLimit).optional(),
        regionId: z.string().optional(),
      },
    },
    async ({ boardId, ids, regionId }) => {
      try {
        const { id, board } = boardOrFail(boardId);
        const wanted = existingIds(board, ids, regionId);
        const store = useBoardStore.getState();
        const switched = store.activeBoardId !== id;
        if (switched) store.selectBoard(id);
        const targets = itemsWithContents(board, wanted)
          .filter(isNodeItem)
          .map((i) => i.id);
        const fitted = (await viewController()?.fitToIds(targets)) ?? false;
        return ok({ activeBoard: id, switched, fitted });
      } catch (error) {
        return fail(error);
      }
    },
  );

  server.registerTool(
    "recent_changes",
    {
      description:
        "Last undo steps of a board, newest first: who (AI label or kullanıcı), when, added/removed/changed counts.",
      inputSchema: {
        boardId: z.string().optional(),
        limit: z.number().int().min(1).max(50).optional(),
      },
      annotations: { readOnlyHint: true },
    },
    async ({ boardId, limit }) => {
      try {
        const { id, board, revision } = boardOrFail(boardId);
        const past = useBoardStore.getState().history[id]?.past ?? [];
        return ok({ revision, changes: recentChanges(past, board, limit ?? 10) });
      } catch (error) {
        return fail(error);
      }
    },
  );

  return server;
}
