import type { BoardDoc, NodeItem } from "../model/types";
import { isNodeItem } from "../model/types";
import { type Rect, rectOf } from "./geometry";

export type AlignMode =
  | "left"
  | "center"
  | "right"
  | "top"
  | "middle"
  | "bottom"
  | "distributeH"
  | "distributeV";

/** Measured size from the canvas when known; notes otherwise use the estimate. */
export type SizeOf = (item: NodeItem) => { width: number; height: number } | undefined;

/**
 * Aligns or evenly spaces the given nodes. Distribution keeps the outermost two in
 * place and makes the gaps between neighbours equal. Returns the same board when
 * nothing moves.
 */
export function alignItems(
  board: BoardDoc,
  ids: ReadonlySet<string>,
  mode: AlignMode,
  sizeOf: SizeOf = () => undefined,
): BoardDoc {
  const picked = board.items.filter(
    (i): i is NodeItem => isNodeItem(i) && ids.has(i.id) && i.kind !== "stroke",
  );
  if (picked.length < (mode.startsWith("distribute") ? 3 : 2)) return board;
  const entries = picked.map((item) => ({ item, r: { ...rectOf(item), ...sizeOf(item) } as Rect }));
  const all = entries.map((e) => e.r);
  const left = Math.min(...all.map((r) => r.x));
  const right = Math.max(...all.map((r) => r.x + r.width));
  const top = Math.min(...all.map((r) => r.y));
  const bottom = Math.max(...all.map((r) => r.y + r.height));
  const target = new Map<string, { x: number; y: number }>();

  if (mode === "distributeH" || mode === "distributeV") {
    const horizontal = mode === "distributeH";
    const pos = (r: Rect) => (horizontal ? r.x : r.y);
    const len = (r: Rect) => (horizontal ? r.width : r.height);
    const order = [...entries].sort((a, b) => pos(a.r) - pos(b.r));
    const span = (horizontal ? right - left : bottom - top) - all.reduce((s, r) => s + len(r), 0);
    const gap = span / (order.length - 1);
    let cursor = horizontal ? left : top;
    for (const { item, r } of order) {
      target.set(item.id, horizontal ? { x: cursor, y: r.y } : { x: r.x, y: cursor });
      cursor += len(r) + gap;
    }
  } else {
    for (const { item, r } of entries) {
      const x =
        mode === "left"
          ? left
          : mode === "right"
            ? right - r.width
            : mode === "center"
              ? (left + right) / 2 - r.width / 2
              : r.x;
      const y =
        mode === "top"
          ? top
          : mode === "bottom"
            ? bottom - r.height
            : mode === "middle"
              ? (top + bottom) / 2 - r.height / 2
              : r.y;
      target.set(item.id, { x, y });
    }
  }

  let changed = false;
  const items = board.items.map((item) => {
    const to = target.get(item.id);
    if (!to || !isNodeItem(item)) return item;
    const x = Math.round(to.x);
    const y = Math.round(to.y);
    if (x === Math.round(item.x) && y === Math.round(item.y)) return item;
    changed = true;
    return { ...item, x, y };
  });
  return changed ? { ...board, items } : board;
}
