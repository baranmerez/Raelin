import { FormatError, validateItems } from "../model/serialize";
import { buildTemplate, type TemplateId } from "../model/templates";
import type { BoardDoc } from "../model/types";
import { isNodeItem } from "../model/types";
import { CommandError } from "./apply";
import { boundsOf, rectOf } from "./geometry";

const gap = 120;

/**
 * Adds a template to a board: centred on `at` when given, otherwise to the right of
 * everything already there, top-aligned. Returns the new board and the new node ids.
 */
export function placeTemplate(
  board: BoardDoc,
  id: TemplateId,
  at?: { x: number; y: number },
): { board: BoardDoc; created: string[] } {
  const draft = buildTemplate(id, 0, 0);
  const shape = boundsOf(draft.filter(isNodeItem).map(rectOf));
  if (!shape) throw new CommandError("INVALID", "Şablon boş.");
  const existing = boundsOf(board.items.filter(isNodeItem).map(rectOf));
  const target = at
    ? { x: at.x - shape.width / 2, y: at.y - shape.height / 2 }
    : existing
      ? { x: existing.x + existing.width + gap, y: existing.y }
      : { x: 0, y: 0 };
  const dx = Math.round(target.x - shape.x);
  const dy = Math.round(target.y - shape.y);
  const placed = draft.map((item) =>
    isNodeItem(item) ? { ...item, x: item.x + dx, y: item.y + dy } : item,
  );
  const items = [...board.items, ...placed];
  try {
    validateItems(items);
  } catch (error) {
    if (error instanceof FormatError) throw new CommandError("INVALID", error.message);
    throw error;
  }
  return { board: { ...board, items }, created: placed.filter(isNodeItem).map((i) => i.id) };
}
