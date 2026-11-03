import { noteToMarkdown } from "../model/markdown";
import type { BoardDoc, BoardItem, NodeItem, Workspace } from "../model/types";
import { isEdgeItem, isNodeItem } from "../model/types";
import { rectOf, regionOf } from "./geometry";

/**
 * Compact, token-lean views of the board for AI clients. Geometry is opt-in, long text is
 * clipped with a marker, and large reads page through a cursor instead of dumping all.
 */

export interface ReadOptions {
  regionId?: string;
  ids?: string[];
  kinds?: NodeItem["kind"][];
  limit?: number;
  cursor?: number;
  textLimit?: number;
  withGeometry?: boolean;
}

export const defaultLimit = 200;
export const maxLimit = 1000;

function clip(text: string, limit: number): string {
  return text.length <= limit ? text : `${text.slice(0, limit)}…[+${text.length - limit}]`;
}

function compactNode(board: BoardDoc, item: NodeItem, textLimit: number, withGeometry: boolean) {
  const region = item.kind === "region" ? undefined : regionOf(board, item)?.id;
  const geo = withGeometry
    ? {
        geo: [rectOf(item).x, rectOf(item).y, rectOf(item).width, rectOf(item).height].map(
          Math.round,
        ),
      }
    : {};
  switch (item.kind) {
    case "flowNode":
      return {
        id: item.id,
        kind: item.kind,
        shape: item.shape,
        text: clip(item.text, textLimit),
        tone: item.tone,
        region,
        ...geo,
      };
    case "note":
      return {
        id: item.id,
        kind: item.kind,
        title: clip(item.title, textLimit),
        md: clip(noteToMarkdown(item.content), textLimit),
        tone: item.tone,
        region,
        ...geo,
      };
    case "region":
      return {
        id: item.id,
        kind: item.kind,
        title: clip(item.title, textLimit),
        tone: item.tone,
        ...geo,
      };
    case "stroke":
      return { id: item.id, kind: item.kind, region, ...geo };
    case "image":
      return { id: item.id, kind: item.kind, alt: clip(item.alt, textLimit), region, ...geo };
  }
}

function compactEdge(item: BoardItem) {
  if (!isEdgeItem(item)) return null;
  return {
    id: item.id,
    from: item.source,
    to: item.target,
    ...(item.label ? { label: item.label } : {}),
    ...(item.style === "reference" ? { style: "reference" } : {}),
  };
}

function counts(board: BoardDoc) {
  const result: Record<string, number> = {
    flowNode: 0,
    note: 0,
    region: 0,
    stroke: 0,
    image: 0,
    edge: 0,
  };
  for (const item of board.items) result[item.kind]++;
  return result;
}

export function describeOverview(
  workspace: Workspace,
  revisions: Record<string, number>,
  activeBoardId: string,
  selectedCount: number,
) {
  return {
    workspace: workspace.manifest.title,
    activeBoard: activeBoardId,
    selectedCount,
    boards: workspace.manifest.boards.map(({ id }) => {
      const board = workspace.boards[id];
      return {
        id,
        title: board.title,
        revision: revisions[id] ?? 0,
        style: board.flowStyle,
        counts: counts(board),
        regions: board.items
          .filter((i) => i.kind === "region")
          .map((r) => ({ id: r.id, title: r.title })),
      };
    }),
  };
}

export function describeBoard(board: BoardDoc, revision: number, options: ReadOptions = {}) {
  const limit = Math.min(Math.max(1, options.limit ?? defaultLimit), maxLimit);
  const textLimit = Math.max(20, options.textLimit ?? 300);
  const cursor = Math.max(0, options.cursor ?? 0);
  const wanted = options.ids ? new Set(options.ids) : null;
  const kinds = options.kinds ? new Set(options.kinds) : null;

  const region = options.regionId ? board.items.find((i) => i.id === options.regionId) : undefined;
  let nodes = board.items.filter(isNodeItem);
  if (wanted) nodes = nodes.filter((n) => wanted.has(n.id));
  if (kinds) nodes = nodes.filter((n) => kinds.has(n.kind));
  if (region?.kind === "region") {
    nodes = nodes.filter((n) => n.id === region.id || regionOf(board, n)?.id === region.id);
  }
  // Reading order: top to bottom, then left to right; regions first so ids resolve.
  nodes.sort(
    (a, b) => Number(b.kind === "region") - Number(a.kind === "region") || a.y - b.y || a.x - b.x,
  );

  const page = nodes.slice(cursor, cursor + limit);
  const pageIds = new Set(page.map((n) => n.id));
  const edges = board.items
    .filter((e) => isEdgeItem(e) && pageIds.has(e.source) && pageIds.has(e.target))
    .map(compactEdge);
  const next = cursor + limit < nodes.length ? cursor + limit : undefined;

  return {
    board: { id: board.id, title: board.title, revision, style: board.flowStyle },
    items: page.map((n) => compactNode(board, n, textLimit, options.withGeometry ?? false)),
    edges,
    ...(next !== undefined ? { nextCursor: next, total: nodes.length } : {}),
  };
}

function searchable(item: NodeItem): { field: string; text: string }[] {
  switch (item.kind) {
    case "flowNode":
      return [{ field: "text", text: item.text }];
    case "note":
      return [
        { field: "title", text: item.title },
        { field: "md", text: noteToMarkdown(item.content) },
      ];
    case "region":
      return [{ field: "title", text: item.title }];
    case "stroke":
      return [];
    case "image":
      return [{ field: "alt", text: item.alt }];
  }
}

export function searchWorkspace(
  workspace: Workspace,
  query: string,
  options: { boardId?: string; limit?: number } = {},
) {
  const needle = query.trim().toLocaleLowerCase("tr");
  const limit = Math.min(Math.max(1, options.limit ?? 30), 200);
  const hits: { board: string; id: string; kind: string; field: string; preview: string }[] = [];
  if (!needle) return { hits };
  for (const { id: boardId } of workspace.manifest.boards) {
    if (options.boardId && options.boardId !== boardId) continue;
    for (const item of workspace.boards[boardId].items) {
      if (!isNodeItem(item)) continue;
      for (const { field, text } of searchable(item)) {
        const at = text.toLocaleLowerCase("tr").indexOf(needle);
        if (at < 0) continue;
        const start = Math.max(0, at - 40);
        hits.push({
          board: boardId,
          id: item.id,
          kind: item.kind,
          field,
          preview: `${start > 0 ? "…" : ""}${text.slice(start, at + needle.length + 60)}`,
        });
        break;
      }
      if (hits.length >= limit) return { hits, truncated: true };
    }
  }
  return { hits };
}
