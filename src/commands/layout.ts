import dagre from "@dagrejs/dagre";
import type { BoardDoc, NodeItem, RegionItem } from "../model/types";
import { isEdgeItem, isNodeItem } from "../model/types";
import { CommandError } from "./apply";
import { boundsOf, contains, rectOf } from "./geometry";

export interface LayoutOptions {
  /** Lay out the flow inside this region; the region grows to fit. */
  regionId?: string;
  /** Or exactly these nodes. With neither, every step and note outside regions. */
  ids?: string[];
  direction?: "TB" | "LR";
}

export interface LayoutResult {
  board: BoardDoc;
  moved: string[];
}

const regionPadding = { left: 40, top: 96, right: 40, bottom: 48 };

/**
 * Deterministic layered layout of flow steps and notes. Same board + options give the
 * same result: nodes are fed to dagre in a stable order (by position, then id) and the
 * group keeps its top-left corner, so a re-run does not wander across the canvas.
 */
export function layoutBoard(board: BoardDoc, options: LayoutOptions): LayoutResult {
  const nodes = board.items.filter(isNodeItem);
  const region = options.regionId
    ? (nodes.find((n) => n.id === options.regionId) as RegionItem | undefined)
    : undefined;
  if (options.regionId && region?.kind !== "region") {
    throw new CommandError("NOT_FOUND", `Bölge bulunamadı: ${options.regionId}`);
  }

  const wanted = options.ids ? new Set(options.ids) : null;
  const regions = nodes.filter((n): n is RegionItem => n.kind === "region");
  const scope = nodes
    .filter((n) => n.kind === "flowNode" || n.kind === "note")
    .filter((n) => {
      if (wanted) return wanted.has(n.id);
      if (region) return contains(region, n);
      return !regions.some((r) => contains(r, n));
    })
    .sort((a, b) => a.y - b.y || a.x - b.x || (a.id < b.id ? -1 : 1));
  if (wanted && scope.length !== wanted.size) {
    const found = new Set(scope.map((n) => n.id));
    const missing = [...wanted].filter((id) => !found.has(id));
    throw new CommandError(
      "NOT_FOUND",
      `Yerleştirilecek adım veya not bulunamadı: ${missing.join(", ")}`,
    );
  }
  if (scope.length === 0) return { board, moved: [] };

  const g = new dagre.graphlib.Graph();
  g.setGraph({
    rankdir: options.direction ?? "TB",
    nodesep: 48,
    ranksep: 64,
    marginx: 0,
    marginy: 0,
  });
  g.setDefaultEdgeLabel(() => ({}));
  const inScope = new Set(scope.map((n) => n.id));
  for (const node of scope) {
    const r = rectOf(node);
    g.setNode(node.id, { width: r.width, height: r.height });
  }
  const edges = board.items
    .filter(isEdgeItem)
    .filter((e) => e.style === "flow" && inScope.has(e.source) && inScope.has(e.target))
    .sort((a, b) => (a.id < b.id ? -1 : 1));
  for (const edge of edges) g.setEdge(edge.source, edge.target);
  dagre.layout(g);

  const before = boundsOf(scope.map(rectOf));
  const anchor = region
    ? { x: region.x + regionPadding.left, y: region.y + regionPadding.top }
    : { x: before?.x ?? 0, y: before?.y ?? 0 };
  const placed = new Map<string, { x: number; y: number }>();
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  for (const node of scope) {
    const p = g.node(node.id);
    const r = rectOf(node);
    const x = p.x - r.width / 2;
    const y = p.y - r.height / 2;
    placed.set(node.id, { x, y });
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
  }

  const moved: string[] = [];
  let items = board.items.map((item) => {
    const p = placed.get(item.id);
    if (!p || !isNodeItem(item)) return item;
    const x = Math.round(anchor.x + p.x - minX);
    const y = Math.round(anchor.y + p.y - minY);
    if (x === item.x && y === item.y) return item;
    moved.push(item.id);
    return { ...item, x, y } as NodeItem;
  });

  if (region) {
    const after = boundsOf(
      items.filter((i) => inScope.has(i.id)).map((i) => rectOf(i as NodeItem)),
    );
    if (after) {
      const width = Math.max(region.width, after.x + after.width + regionPadding.right - region.x);
      const height = Math.max(
        region.height,
        after.y + after.height + regionPadding.bottom - region.y,
      );
      if (width !== region.width || height !== region.height) {
        items = items.map((i) => (i.id === region.id ? { ...region, width, height } : i));
        moved.push(region.id);
      }
    }
  }
  return { board: { ...board, items }, moved };
}
