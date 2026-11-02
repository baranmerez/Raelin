import { create } from "zustand";
import { emptyBoard } from "../model/factory";
import type { BoardDoc, BoardItem, Workspace } from "../model/types";

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
  workspaceDir: string | null;
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
  loadWorkspace: (workspace: Workspace, dir: string | null) => void;
  setWorkspaceDir: (dir: string) => void;
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
  workspaceDir: null,
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
      if (s.gesture && !s.gesture.pushed) {
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
      };
    }),

  loadWorkspace: (workspace, dir) => {
    const first =
      workspace.manifest.boards.find((b) => b.title.startsWith("Akış")) ??
      workspace.manifest.boards[0];
    set({
      workspace,
      activeBoardId: first?.id ?? "",
      history: Object.fromEntries(Object.keys(workspace.boards).map((id) => [id, emptyHistory()])),
      gesture: null,
      selectedIds: [],
      workspaceDir: dir,
    });
  },
  setWorkspaceDir: (dir) => set({ workspaceDir: dir }),
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
