import { cloneItems, withInnerEdges } from "../model/clone";
import { FormatError, validateItems } from "../model/serialize";
import type { BoardDoc, BoardItem, RegionItem } from "../model/types";
import { isNodeItem } from "../model/types";
import { CommandError } from "./apply";
import { boundsOf, center, contentsOf, obstacles, overlaps, type Rect, rectOf } from "./geometry";
import type { Place } from "./schema";

export interface CopyResult {
  board: BoardDoc;
  /** Source id → id of its copy (nodes and edges). */
  ids: Record<string, string>;
  /** Source ids that were copied: the named ones, region contents and inner edges. */
  copied: string[];
}

/** The given ids, everything inside given regions, and the edges among them. */
export function itemsWithContents(board: BoardDoc, ids: readonly string[]): BoardItem[] {
  const wanted = new Set(ids);
  for (const id of contentsOf(board, wanted)) wanted.add(id);
  return withInnerEdges(board.items, wanted);
}

/** Moves a group down (then right) until it overlaps none of `taken`. */
function freeSpot(start: Rect, taken: Rect[]): Rect {
  let candidate = { ...start };
  for (let attempt = 0; attempt < 80; attempt++) {
    const hit = taken.find((r) => overlaps(candidate, r));
    if (!hit) return candidate;
    candidate =
      attempt % 20 === 19
        ? { ...start, x: start.x + (Math.floor(attempt / 20) + 1) * (start.width + 60) }
        : { ...candidate, y: hit.y + hit.height + 24 };
  }
  return candidate;
}

/**
 * Copies items (with region contents and inner edges) from one board to another with
 * fresh ids. The group keeps its own layout and lands at the place hint, or to the right
 * of the target's content. Pure: throws CommandError and leaves both boards untouched.
 */
export function copyItems(
  source: BoardDoc,
  target: BoardDoc,
  ids: readonly string[],
  place?: Place,
): CopyResult {
  if (ids.length === 0) throw new CommandError("INVALID", "Kopyalanacak öğe yok.");
  const present = new Set(source.items.map((i) => i.id));
  const missing = ids.filter((id) => !present.has(id));
  if (missing.length > 0) {
    throw new CommandError("NOT_FOUND", `Öğe bulunamadı: ${missing.slice(0, 5).join(", ")}`);
  }
  const picked = itemsWithContents(source, ids);
  const nodes = picked.filter(isNodeItem);
  const group = boundsOf(nodes.map(rectOf));
  if (!group) throw new CommandError("INVALID", "Bağlantılar yalnız uçlarıyla kopyalanabilir.");

  const targetNode = (id: string) => {
    const item = target.items.find((i) => i.id === id);
    if (!item || !isNodeItem(item)) throw new CommandError("NOT_FOUND", `Öğe bulunamadı: ${id}`);
    return item;
  };
  let region: RegionItem | undefined;
  let start: Rect;
  if (place?.x !== undefined && place.y !== undefined) {
    start = { ...group, x: place.x - group.width / 2, y: place.y - group.height / 2 };
  } else if (place?.after) {
    const anchor = rectOf(targetNode(place.after));
    start = { ...group, x: center(anchor).x - group.width / 2, y: anchor.y + anchor.height + 56 };
  } else if (place?.in) {
    const host = targetNode(place.in);
    if (host.kind !== "region") throw new CommandError("INVALID", `Bölge değil: ${place.in}`);
    region = host;
    start = { ...group, x: host.x + 40, y: host.y + 96 };
  } else {
    const bounds = boundsOf(target.items.filter(isNodeItem).map(rectOf));
    start = bounds ? { ...group, x: bounds.x + bounds.width + 120, y: bounds.y } : group;
  }
  const exact = place?.x !== undefined && place.y !== undefined;
  const spot = exact ? start : freeSpot(start, obstacles(target));

  const clones = cloneItems(picked, Math.round(spot.x - group.x), Math.round(spot.y - group.y));
  // cloneItems keeps order: the nodes first, then the edges whose two ends were copied.
  const nodeIds = new Set(nodes.map((n) => n.id));
  const edges = picked.filter(
    (i) => i.kind === "edge" && nodeIds.has(i.source) && nodeIds.has(i.target),
  );
  const map: Record<string, string> = {};
  [...nodes, ...edges].forEach((item, index) => {
    map[item.id] = clones[index].id;
  });

  let items = [...target.items, ...clones];
  if (region) {
    const host = region;
    const x = Math.min(host.x, spot.x - 40);
    const y = Math.min(host.y, spot.y - 96);
    const right = Math.max(host.x + host.width, spot.x + spot.width + 40);
    const bottom = Math.max(host.y + host.height, spot.y + spot.height + 48);
    const grown = { ...host, x, y, width: right - x, height: bottom - y };
    items = items.map((i) => (i.id === host.id ? grown : i));
  }
  try {
    validateItems(items);
  } catch (error) {
    if (error instanceof FormatError) throw new CommandError("INVALID", error.message);
    throw error;
  }
  return { board: { ...target, items }, ids: map, copied: [...nodes, ...edges].map((i) => i.id) };
}
