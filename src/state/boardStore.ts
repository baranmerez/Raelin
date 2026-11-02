import { create } from "zustand";
import { emptyBoard } from "../model/factory";
import type { BoardDoc, BoardItem, Workspace } from "../model/types";
import type { WorkspaceOrigin } from "../platform/storage";

export type Tool = "select" | "pen" | "process" | "decision" | "terminal" | "note" | "region";

interface History {
  past: BoardDoc[];
  future: BoardDoc[];
}

interface Toast {
  id: number;
  text: string;
  tone: "ok" | "error";
}

const historyLimit = 200;

interface BoardState {
  workspace: Workspace;
  activeBoardId: string;
  history: Record<string, History>;
  gesture: { base: BoardDoc; pushed: boolean } | null;
  selectedIds: string[];
  tool: Tool;
  penColor: string;
  penSize: number;
  /** Folder and on-disk fingerprint of the open workspace; null until first save/open. */
  origin: WorkspaceOrigin | null;
  /** Workspace object as last saved or opened; anything else means unsaved edits. */
  savedWorkspace: Workspace | null;
  toast: Toast | null;

  setTool: (tool: Tool) => void;
  setPen: (patch: { color?: string; size?: number }) => void;
  setSelection: (ids: string[]) => void;
  selectBoard: (id: string) => void;
  addBoard: (title: string) => void;
  /** One undoable step. Return the same board to signal "no change". */
  commit: (mutate: (board: BoardDoc) => BoardDoc) => void;
  /** Drag/resize/typing: many live updates that undo as one step. */
  beginGesture: () => void;
  live: (mutate: (board: BoardDoc) => BoardDoc) => void;
  endGesture: () => void;
  undo: () => void;
  redo: () => void;
  loadWorkspace: (workspace: Workspace, origin: WorkspaceOrigin | null, saved: boolean) => void;
  /** written is the workspace object that was serialized; edits made during the save stay dirty. */
  markSaved: (origin: WorkspaceOrigin, written: Workspace) => void;
  showToast: (text: string, tone?: Toast["tone"]) => void;
}

function emptyHistory(): History {
  return { past: [], future: [] };
}

function pushPast(history: History | undefined, board: BoardDoc): History {
  const past = [...(history?.past ?? []), board];
  if (past.length > historyLimit) past.shift();
  return { past, future: [] };
}

export const useBoardStore = create<BoardState>()((set, get) => ({
  workspace: { manifest: { formatVersion: 1, title: "", boards: [] }, boards: {} },
  activeBoardId: "",
  history: {},
  gesture: null,
  selectedIds: [],
  tool: "select",
  penColor: "#3f5f9e",
  penSize: 5,
  origin: null,
  savedWorkspace: null,
  toast: null,

  setTool: (tool) => set({ tool }),
  setPen: ({ color, size }) =>
    set((s) => ({ penColor: color ?? s.penColor, penSize: size ?? s.penSize })),
  setSelection: (ids) => {
    const current = get().selectedIds;
    if (current.length === ids.length && current.every((id, i) => id === ids[i])) return;
    set({ selectedIds: ids });
  },
  selectBoard: (id) => {
    if (!get().workspace.boards[id]) return;
    set({ activeBoardId: id, selectedIds: [], gesture: null });
  },
  addBoard: (title) =>
    set((s) => {
      const board = emptyBoard(title);
      return {
        workspace: {
          manifest: {
            ...s.workspace.manifest,
            boards: [...s.workspace.manifest.boards, { id: board.id, title }],
          },
          boards: { ...s.workspace.boards, [board.id]: board },
        },
        activeBoardId: board.id,
        selectedIds: [],
        gesture: null,
      };
    }),

  commit: (mutate) =>
    set((s) => {
      const board = s.workspace.boards[s.activeBoardId];
      if (!board) return s;
      const next = mutate(board);
      if (next === board) return s;
      return {
        workspace: { ...s.workspace, boards: { ...s.workspace.boards, [board.id]: next } },
        history: { ...s.history, [board.id]: pushPast(s.history[board.id], board) },
        // A commit inside a gesture (e.g. renaming while a note is open) closes the
        // current step; later live updates of the same gesture form a new one.
        gesture: s.gesture ? { base: next, pushed: false } : null,
      };
    }),

  beginGesture: () => {
    const board = get().workspace.boards[get().activeBoardId];
    if (board) set({ gesture: { base: board, pushed: false } });
  },
  live: (mutate) =>
    set((s) => {
      const board = s.workspace.boards[s.activeBoardId];
      if (!board) return s;
      const next = mutate(board);
      if (next === board) return s;
      const patch: Partial<BoardState> = {
        workspace: { ...s.workspace, boards: { ...s.workspace.boards, [board.id]: next } },
      };
      if (!s.gesture) {
        // Live change without a gesture (e.g. arrow-key nudges): its own undo step.
        patch.history = { ...s.history, [board.id]: pushPast(s.history[board.id], board) };
      } else if (!s.gesture.pushed) {
        patch.history = { ...s.history, [board.id]: pushPast(s.history[board.id], s.gesture.base) };
        patch.gesture = { ...s.gesture, pushed: true };
      }
      return patch;
    }),
  endGesture: () => set({ gesture: null }),

  undo: () =>
    set((s) => {
      const id = s.activeBoardId;
      const history = s.history[id];
      const previous = history?.past.at(-1);
      if (!history || !previous) return s;
      return {
        workspace: { ...s.workspace, boards: { ...s.workspace.boards, [id]: previous } },
        history: {
          ...s.history,
          [id]: {
            past: history.past.slice(0, -1),
            future: [s.workspace.boards[id], ...history.future],
          },
        },
        selectedIds: [],
        gesture: null,
      };
    }),
  redo: () =>
    set((s) => {
      const id = s.activeBoardId;
      const history = s.history[id];
      const next = history?.future[0];
      if (!history || !next) return s;
      return {
        workspace: { ...s.workspace, boards: { ...s.workspace.boards, [id]: next } },
        history: {
          ...s.history,
          [id]: {
            past: [...history.past, s.workspace.boards[id]],
            future: history.future.slice(1),
          },
        },
        selectedIds: [],
        gesture: null,
      };
    }),

  loadWorkspace: (workspace, origin, saved) => {
    const first =
      workspace.manifest.boards.find((b) => b.title.startsWith("Akış")) ??
      workspace.manifest.boards[0];
    set({
      workspace,
      activeBoardId: first?.id ?? "",
      history: Object.fromEntries(Object.keys(workspace.boards).map((id) => [id, emptyHistory()])),
      gesture: null,
      selectedIds: [],
      origin,
      savedWorkspace: saved ? workspace : null,
    });
  },
  markSaved: (origin, written) => set({ origin, savedWorkspace: written }),
  showToast: (text, tone = "ok") => set({ toast: { id: Date.now(), text, tone } }),
}));

export function useActiveBoard(): BoardDoc | undefined {
  return useBoardStore((s) => s.workspace.boards[s.activeBoardId]);
}

export function mapItems(board: BoardDoc, fn: (item: BoardItem) => BoardItem): BoardDoc {
  let changed = false;
  const items = board.items.map((item) => {
    const next = fn(item);
    if (next !== item) changed = true;
    return next;
  });
  return changed ? { ...board, items } : board;
}

export function patchItem<T extends BoardItem>(
  board: BoardDoc,
  id: string,
  patch: Partial<T>,
): BoardDoc {
  return mapItems(board, (item) => (item.id === id ? ({ ...item, ...patch } as BoardItem) : item));
}

export function removeItems(board: BoardDoc, ids: ReadonlySet<string>): BoardDoc {
  const items = board.items.filter(
    (item) =>
      !ids.has(item.id) &&
      !(item.kind === "edge" && (ids.has(item.source) || ids.has(item.target))),
  );
  return items.length === board.items.length ? board : { ...board, items };
}
