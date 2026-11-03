import { create } from "zustand";
import { cloneItems } from "../model/clone";
import { emptyBoard } from "../model/factory";
import { FormatError, validateItems } from "../model/serialize";
import type { BoardDoc, BoardItem, Workspace } from "../model/types";
import type { WorkspaceOrigin } from "../platform/storage";

export type Tool =
  | "select"
  | "pen"
  | "eraser"
  | "process"
  | "decision"
  | "terminal"
  | "note"
  | "region"
  | "text"
  | "arrow"
  | "checklist"
  | "link"
  | "table";

/** One undo step: the board before the change, when it happened and, for AI changes, who made it. */
export interface Step {
  board: BoardDoc;
  label?: string;
  /** Epoch ms of the change; kept when the step moves between undo and redo. */
  at: number;
}

export interface History {
  past: Step[];
  future: Step[];
}

export interface Toast {
  id: number;
  text: string;
  tone: "ok" | "error";
  action?: { label: string; run: () => void };
}

const historyLimit = 200;

export interface RemovedBoard {
  board: BoardDoc;
  index: number;
  history: History | undefined;
}

interface BoardState {
  workspace: Workspace;
  activeBoardId: string;
  history: Record<string, History>;
  /**
   * Runtime revision per board, bumped on every change (UI, AI, undo). AI writes must
   * name the revision they read; it is never stored in files.
   */
  revisions: Record<string, number>;
  gesture: { base: BoardDoc; pushed: boolean } | null;
  selectedIds: string[];
  tool: Tool;
  penColor: string;
  penSize: number;
  /** File and on-disk stamp of the open workspace; null until first save/open. */
  origin: WorkspaceOrigin | null;
  /** Workspace object as last saved or opened; anything else means unsaved edits. */
  savedWorkspace: Workspace | null;
  toast: Toast | null;

  setTool: (tool: Tool) => void;
  setPen: (patch: { color?: string; size?: number }) => void;
  setSelection: (ids: string[]) => void;
  selectBoard: (id: string) => void;
  addBoard: (title: string) => void;
  /** New board without switching to it (AI clients). Returns its id. */
  createBoard: (title: string) => string;
  /** Undoable on that board; the manifest title follows the board title when saving. */
  renameBoard: (id: string, title: string) => void;
  /** Copy with fresh ids, placed right after the original and opened unless open is false. */
  duplicateBoard: (id: string, options?: { open?: boolean; title?: string }) => string | null;
  /** Removes a board (never the last one) and returns what restoreBoard needs. */
  deleteBoard: (id: string) => RemovedBoard | null;
  restoreBoard: (removed: RemovedBoard) => void;
  /** One undoable step on the active board. Return the same board to signal "no change". */
  commit: (mutate: (board: BoardDoc) => BoardDoc) => void;
  /** One undoable step on any board, already validated by the command layer. */
  commitTo: (boardId: string, next: BoardDoc, label?: string) => number;
  /** Drag/resize/typing: many live updates that undo as one step. */
  beginGesture: () => void;
  live: (mutate: (board: BoardDoc) => BoardDoc) => void;
  endGesture: () => void;
  undo: () => void;
  redo: () => void;
  undoBoard: (boardId: string) => void;
  loadWorkspace: (workspace: Workspace, origin: WorkspaceOrigin | null, saved: boolean) => void;
  /** written is the workspace object that was serialized; edits made during the save stay dirty. */
  markSaved: (origin: WorkspaceOrigin, written: Workspace) => void;
  showToast: (text: string, tone?: Toast["tone"], action?: Toast["action"]) => void;
}

function emptyHistory(): History {
  return { past: [], future: [] };
}

function pushPast(history: History | undefined, step: Omit<Step, "at">): History {
  const past = [...(history?.past ?? []), { ...step, at: Date.now() }];
  if (past.length > historyLimit) past.shift();
  return { past, future: [] };
}

type State = BoardState;

/** Workspace + revision patch for replacing one board. */
function withBoard(s: State, next: BoardDoc): Pick<State, "workspace" | "revisions"> {
  return {
    workspace: { ...s.workspace, boards: { ...s.workspace.boards, [next.id]: next } },
    revisions: { ...s.revisions, [next.id]: (s.revisions[next.id] ?? 0) + 1 },
  };
}

function undoOn(s: State, id: string): Partial<State> | State {
  const history = s.history[id];
  const previous = history?.past.at(-1);
  if (!history || !previous) return s;
  return {
    ...withBoard(s, previous.board),
    history: {
      ...s.history,
      [id]: {
        past: history.past.slice(0, -1),
        future: [{ ...previous, board: s.workspace.boards[id] }, ...history.future],
      },
    },
    selectedIds: id === s.activeBoardId ? [] : s.selectedIds,
    gesture: null,
  };
}

export const useBoardStore = create<BoardState>()((set, get) => ({
  workspace: { manifest: { formatVersion: 1, title: "", boards: [] }, boards: {} },
  activeBoardId: "",
  history: {},
  revisions: {},
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
  addBoard: (title) => {
    const id = get().createBoard(title);
    set({ activeBoardId: id, selectedIds: [], gesture: null });
  },
  createBoard: (title) => {
    const board = emptyBoard(title);
    set((s) => ({
      workspace: {
        manifest: {
          ...s.workspace.manifest,
          boards: [...s.workspace.manifest.boards, { id: board.id, title }],
        },
        boards: { ...s.workspace.boards, [board.id]: board },
      },
      revisions: { ...s.revisions, [board.id]: 1 },
      history: { ...s.history, [board.id]: emptyHistory() },
    }));
    return board.id;
  },
  renameBoard: (id, title) => {
    const board = get().workspace.boards[id];
    const clean = title.trim().slice(0, 120);
    if (!board || !clean || clean === board.title) return;
    get().commitTo(id, { ...board, title: clean });
  },
  duplicateBoard: (id, options = {}) => {
    const source = get().workspace.boards[id];
    if (!source) return null;
    const open = options.open ?? true;
    const copy: BoardDoc = {
      ...emptyBoard(options.title?.trim().slice(0, 120) || `${source.title} (kopya)`),
      flowStyle: source.flowStyle,
      connector: source.connector,
      background: source.background,
      items: cloneItems(source.items),
    };
    set((s) => {
      const boards = [...s.workspace.manifest.boards];
      const at = boards.findIndex((b) => b.id === id);
      boards.splice(at + 1, 0, { id: copy.id, title: copy.title });
      return {
        workspace: {
          manifest: { ...s.workspace.manifest, boards },
          boards: { ...s.workspace.boards, [copy.id]: copy },
        },
        revisions: { ...s.revisions, [copy.id]: 1 },
        history: { ...s.history, [copy.id]: emptyHistory() },
        ...(open ? { activeBoardId: copy.id, selectedIds: [], gesture: null } : {}),
      };
    });
    return copy.id;
  },
  deleteBoard: (id) => {
    const s = get();
    const list = s.workspace.manifest.boards;
    const index = list.findIndex((b) => b.id === id);
    const board = s.workspace.boards[id];
    if (index < 0 || !board || list.length <= 1) return null;
    const rest = list.filter((b) => b.id !== id);
    const { [id]: _board, ...boards } = s.workspace.boards;
    const { [id]: history, ...histories } = s.history;
    const active =
      s.activeBoardId === id ? rest[Math.min(index, rest.length - 1)].id : s.activeBoardId;
    set({
      workspace: { manifest: { ...s.workspace.manifest, boards: rest }, boards },
      history: histories,
      // The revision is kept so an AI still holding this board's id gets NO_BOARD, and a
      // restored board continues counting up.
      activeBoardId: active,
      selectedIds: active === s.activeBoardId ? s.selectedIds : [],
      gesture: null,
    });
    return { board, index, history };
  },
  restoreBoard: ({ board, index, history }) =>
    set((s) => {
      if (s.workspace.boards[board.id]) return s;
      const boards = [...s.workspace.manifest.boards];
      boards.splice(Math.min(index, boards.length), 0, { id: board.id, title: board.title });
      return {
        workspace: {
          manifest: { ...s.workspace.manifest, boards },
          boards: { ...s.workspace.boards, [board.id]: board },
        },
        revisions: { ...s.revisions, [board.id]: (s.revisions[board.id] ?? 0) + 1 },
        history: { ...s.history, [board.id]: history ?? emptyHistory() },
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
      // UI edits pass the same invariants as files and AI batches.
      try {
        validateItems(next.items);
      } catch (error) {
        const text = error instanceof FormatError ? error.message : String(error);
        return { toast: { id: Date.now(), text: `Değişiklik reddedildi: ${text}`, tone: "error" } };
      }
      return {
        ...withBoard(s, next),
        history: { ...s.history, [board.id]: pushPast(s.history[board.id], { board }) },
        // A commit inside a gesture (e.g. renaming while a note is open) closes the
        // current step; later live updates of the same gesture form a new one.
        gesture: s.gesture ? { base: next, pushed: false } : null,
      };
    }),

  commitTo: (boardId, next, label) => {
    set((s) => {
      const board = s.workspace.boards[boardId];
      if (!board || next === board) return s;
      const present = new Set(next.items.map((i) => i.id));
      return {
        ...withBoard(s, next),
        history: { ...s.history, [boardId]: pushPast(s.history[boardId], { board, label }) },
        // An outside change closes the current local step; the rest of the same drag or
        // typing session forms one new step instead of one per frame.
        gesture:
          boardId === s.activeBoardId && s.gesture ? { base: next, pushed: false } : s.gesture,
        selectedIds:
          boardId === s.activeBoardId
            ? s.selectedIds.filter((id) => present.has(id))
            : s.selectedIds,
      };
    });
    return get().revisions[boardId] ?? 0;
  },

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
      const patch: Partial<BoardState> = withBoard(s, next);
      if (!s.gesture) {
        // Live change without a gesture (e.g. arrow-key nudges): its own undo step.
        patch.history = { ...s.history, [board.id]: pushPast(s.history[board.id], { board }) };
      } else if (!s.gesture.pushed) {
        patch.history = {
          ...s.history,
          [board.id]: pushPast(s.history[board.id], { board: s.gesture.base }),
        };
        patch.gesture = { ...s.gesture, pushed: true };
      }
      return patch;
    }),
  endGesture: () => set({ gesture: null }),

  undo: () => set((s) => undoOn(s, s.activeBoardId)),
  undoBoard: (boardId) => set((s) => undoOn(s, boardId)),
  redo: () =>
    set((s) => {
      const id = s.activeBoardId;
      const history = s.history[id];
      const next = history?.future[0];
      if (!history || !next) return s;
      return {
        ...withBoard(s, next.board),
        history: {
          ...s.history,
          [id]: {
            past: [...history.past, { ...next, board: s.workspace.boards[id] }],
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
    set((s) => ({
      workspace,
      activeBoardId: first?.id ?? "",
      history: Object.fromEntries(Object.keys(workspace.boards).map((id) => [id, emptyHistory()])),
      // Keep counting up across loads so an AI holding an old revision is always rejected.
      // Boards of the previous workspace keep their count too, for when it is reopened.
      revisions: {
        ...s.revisions,
        ...Object.fromEntries(
          Object.keys(workspace.boards).map((id) => [id, (s.revisions[id] ?? 0) + 1]),
        ),
      },
      gesture: null,
      selectedIds: [],
      origin,
      savedWorkspace: saved ? workspace : null,
    }));
  },
  markSaved: (origin, written) => set({ origin, savedWorkspace: written }),
  showToast: (text, tone = "ok", action) => set({ toast: { id: Date.now(), text, tone, action } }),
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
