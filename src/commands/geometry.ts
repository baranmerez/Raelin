import { cardHeight } from "../model/factory";
import type { BoardDoc, NodeItem, RegionItem } from "../model/types";
import { isNodeItem } from "../model/types";

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

function countBlocks(nodes: { content?: unknown[] }[] | undefined): number {
  let count = 0;
  for (const node of nodes ?? []) {
    const children = (node as { content?: { content?: unknown[] }[] }).content;
    const type = (node as { type?: string }).type;
    count += type === "bulletList" || type === "orderedList" ? (children?.length ?? 0) : 1;
  }
  return count;
}

/** Notes grow with their text; this estimate is only used for placing new items. */
export function rectOf(item: NodeItem): Rect {
  if (item.kind === "note") {
    const lines = countBlocks(item.content.content as { content?: unknown[] }[]);
    return { x: item.x, y: item.y, width: item.width, height: 64 + Math.max(1, lines) * 26 };
  }
  if (!("height" in item)) {
    return { x: item.x, y: item.y, width: item.width, height: cardHeight(item) };
  }
  return { x: item.x, y: item.y, width: item.width, height: item.height };
}

export function overlaps(a: Rect, b: Rect, gap = 16): boolean {
  return (
    a.x < b.x + b.width + gap &&
    a.x + a.width + gap > b.x &&
    a.y < b.y + b.height + gap &&
    a.y + a.height + gap > b.y
  );
}

export function center(r: Rect): { x: number; y: number } {
  return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
}

export function contains(region: RegionItem, item: NodeItem): boolean {
  const c = center(rectOf(item));
  return (
    c.x >= region.x &&
    c.x <= region.x + region.width &&
    c.y >= region.y &&
    c.y <= region.y + region.height
  );
}

/** The innermost (smallest) region whose area holds the item's center. */
export function regionOf(board: BoardDoc, item: NodeItem): RegionItem | undefined {
  let best: RegionItem | undefined;
  for (const other of board.items) {
    if (other.kind !== "region" || other.id === item.id || !contains(other, item)) continue;
    if (!best || other.width * other.height < best.width * best.height) best = other;
  }
  return best;
}

export function obstacles(board: BoardDoc, ignore: ReadonlySet<string> = new Set()): Rect[] {
  return board.items
    .filter(isNodeItem)
    .filter((i) => i.kind !== "region" && !ignore.has(i.id))
    .map(rectOf);
}

export function boundsOf(rects: Rect[]): Rect | null {
  if (rects.length === 0) return null;
  const minX = Math.min(...rects.map((r) => r.x));
  const minY = Math.min(...rects.map((r) => r.y));
  const maxX = Math.max(...rects.map((r) => r.x + r.width));
  const maxY = Math.max(...rects.map((r) => r.y + r.height));
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

/** Ids of the nodes inside any of the given regions (nested regions included). */
export function contentsOf(board: BoardDoc, regionIds: ReadonlySet<string>): Set<string> {
  const regions = board.items.filter(
    (i): i is RegionItem => i.kind === "region" && regionIds.has(i.id),
  );
  const inside = new Set<string>();
  if (regions.length === 0) return inside;
  for (const item of board.items) {
    if (!isNodeItem(item) || regionIds.has(item.id)) continue;
    if (regions.some((r) => contains(r, item))) inside.add(item.id);
  }
  return inside;
}

function segmentDistance(px: number, py: number, ax: number, ay: number, bx: number, by: number) {
  const dx = bx - ax;
  const dy = by - ay;
  const len = dx * dx + dy * dy;
  const t = len === 0 ? 0 : Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

/** Pen strokes passing within `radius` of a point (flow coordinates). */
export function strokesAt(board: BoardDoc, x: number, y: number, radius: number): Set<string> {
  const hits = new Set<string>();
  for (const item of board.items) {
    if (item.kind !== "stroke") continue;
    const reach = radius + item.size / 2;
    if (
      x < item.x - reach ||
      x > item.x + item.width + reach ||
      y < item.y - reach ||
      y > item.y + item.height + reach
    ) {
      continue;
    }
    const pts = item.points;
    for (let i = 0; i < pts.length; i++) {
      const [ax, ay] = pts[i];
      const [bx, by] = pts[Math.min(i + 1, pts.length - 1)];
      if (segmentDistance(x - item.x, y - item.y, ax, ay, bx, by) <= reach) {
        hits.add(item.id);
        break;
      }
    }
  }
  return hits;
}
