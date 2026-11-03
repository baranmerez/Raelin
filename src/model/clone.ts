import { newId } from "./ids";
import type { BoardItem } from "./types";
import { isEdgeItem, isNodeItem } from "./types";

/** "note-abc123" → "note": keeps the kind prefix of an id for its copy. */
function idPrefix(id: string): string {
  const cut = id.lastIndexOf("-");
  return cut > 0 ? id.slice(0, cut) : "x";
}

/**
 * Copies items with fresh ids, shifted by `dx`/`dy`. Edges are kept only when both of
 * their ends are among the copied nodes, and are pointed at the copies.
 */
export function cloneItems(items: readonly BoardItem[], dx = 0, dy = 0): BoardItem[] {
  const ids = new Map<string, string>();
  const nodes = items.filter(isNodeItem).map((item) => {
    const id = newId(idPrefix(item.id));
    ids.set(item.id, id);
    return { ...structuredClone(item), id, x: item.x + dx, y: item.y + dy };
  });
  const edges = items.filter(isEdgeItem).flatMap((edge) => {
    const source = ids.get(edge.source);
    const target = ids.get(edge.target);
    if (!source || !target) return [];
    return [{ ...edge, id: newId(idPrefix(edge.id)), source, target }];
  });
  return [...nodes, ...edges];
}

/** The given ids plus every edge whose two ends are both included. */
export function withInnerEdges(items: readonly BoardItem[], ids: ReadonlySet<string>): BoardItem[] {
  return items.filter(
    (item) =>
      ids.has(item.id) || (isEdgeItem(item) && ids.has(item.source) && ids.has(item.target)),
  );
}
