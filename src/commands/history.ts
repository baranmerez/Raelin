import type { BoardDoc } from "../model/types";

export interface HistoryStep {
  board: BoardDoc;
  label?: string;
  at: number;
}

export interface ChangeSummary {
  label: string;
  at: string;
  added: number;
  removed: number;
  changed: number;
  /** Title or board style changed. */
  board?: true;
}

/** Item-level difference between two states of the same board. */
export function diffBoards(before: BoardDoc, after: BoardDoc) {
  const old = new Map(before.items.map((i) => [i.id, i]));
  let added = 0;
  let changed = 0;
  for (const item of after.items) {
    const previous = old.get(item.id);
    if (!previous) added++;
    else if (previous !== item && JSON.stringify(previous) !== JSON.stringify(item)) changed++;
    old.delete(item.id);
  }
  const boardChanged =
    before.title !== after.title ||
    before.flowStyle !== after.flowStyle ||
    before.connector !== after.connector ||
    before.background !== after.background;
  return { added, removed: old.size, changed, boardChanged };
}

/**
 * The newest `limit` undo steps of a board, newest first. Each step holds the board before
 * the change, so it is diffed with the following step (or the current board).
 */
export function recentChanges(
  past: readonly HistoryStep[],
  current: BoardDoc,
  limit = 10,
): ChangeSummary[] {
  const result: ChangeSummary[] = [];
  for (let i = past.length - 1; i >= 0 && result.length < limit; i--) {
    const after = i + 1 < past.length ? past[i + 1].board : current;
    const { added, removed, changed, boardChanged } = diffBoards(past[i].board, after);
    result.push({
      label: past[i].label ?? "kullanıcı",
      at: new Date(past[i].at).toISOString(),
      added,
      removed,
      changed,
      ...(boardChanged ? { board: true as const } : {}),
    });
  }
  return result;
}
