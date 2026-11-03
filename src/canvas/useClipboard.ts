import { useReactFlow } from "@xyflow/react";
import { useEffect, useRef } from "react";
import { boundsOf, contentsOf, rectOf } from "../commands/geometry";
import { cloneItems, withInnerEdges } from "../model/clone";
import { makeNote } from "../model/factory";
import { markdownToDoc } from "../model/noteMarkdown";
import { validateItems } from "../model/serialize";
import type { BoardDoc, BoardItem } from "../model/types";
import { isNodeItem } from "../model/types";
import { removeItems, useBoardStore } from "../state/boardStore";

const marker = "raelin/items";
const step = 32;

interface Payload {
  type: typeof marker;
  version: 1;
  items: BoardItem[];
}

function isTyping(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  return !!el && (el.isContentEditable || el.tagName === "INPUT" || el.tagName === "TEXTAREA");
}

/** Selected items, everything inside selected regions, and the edges among them. */
export function selectionItems(board: BoardDoc, selectedIds: readonly string[]): BoardItem[] {
  const ids = new Set(selectedIds);
  for (const id of contentsOf(board, ids)) ids.add(id);
  return withInnerEdges(board.items, ids);
}

function parsePayload(text: string): BoardItem[] | null {
  if (!text.includes(marker)) return null;
  try {
    const payload = JSON.parse(text) as Payload;
    if (payload.type !== marker || !Array.isArray(payload.items)) return null;
    // Same invariants as files: a broken or foreign payload is rejected, not half-pasted.
    validateItems(payload.items);
    return payload.items;
  } catch {
    return null;
  }
}

/** Splits pasted text into a note title (first line) and a Markdown body. */
function noteFromText(text: string, x: number, y: number) {
  const [first, ...rest] = text.trim().split(/\r?\n/);
  const long = first.length > 80;
  const note = makeNote(x, y, long ? "Yapıştırılan not" : first.replace(/^#+\s*/, ""));
  note.content = markdownToDoc(long ? text.trim() : rest.join("\n").trim());
  return note;
}

/**
 * Ctrl+C / Ctrl+X / Ctrl+V / Ctrl+D / Ctrl+A on the canvas. Items travel through the
 * system clipboard as JSON, so they paste across boards and app restarts; plain text
 * pastes as a note.
 */
export function useClipboard() {
  const { screenToFlowPosition } = useReactFlow();
  const repeat = useRef({ text: "", count: 0 });

  useEffect(() => {
    const viewCenter = () => {
      const el = document.querySelector(".canvas")?.getBoundingClientRect();
      if (!el) return { x: 0, y: 0 };
      return screenToFlowPosition({ x: el.left + el.width / 2, y: el.top + el.height / 2 });
    };

    /** Adds copies and selects them; the first paste of a set lands next to the source. */
    const insert = (items: BoardItem[], key: string) => {
      const store = useBoardStore.getState();
      const board = store.workspace.boards[store.activeBoardId];
      const bounds = boundsOf(items.filter(isNodeItem).map(rectOf));
      if (!board || !bounds) return;
      const count = repeat.current.text === key ? repeat.current.count + 1 : 1;
      repeat.current = { text: key, count };
      const onBoard = items.some((i) => board.items.some((b) => b.id === i.id));
      let dx = step * count;
      let dy = step * count;
      if (!onBoard) {
        // From another board or app run: centre it in view instead.
        const c = viewCenter();
        dx = c.x - (bounds.x + bounds.width / 2) + step * (count - 1);
        dy = c.y - (bounds.y + bounds.height / 2) + step * (count - 1);
      }
      const copies = cloneItems(items, Math.round(dx), Math.round(dy));
      store.commit((b) => ({ ...b, items: [...b.items, ...copies] }));
      store.setSelection(
        copies
          .filter(isNodeItem)
          .map((i) => i.id)
          .sort(),
      );
    };

    const current = () => {
      const s = useBoardStore.getState();
      const board = s.workspace.boards[s.activeBoardId];
      if (!board || s.selectedIds.length === 0) return null;
      return { board, items: selectionItems(board, s.selectedIds) };
    };

    const onCopy = (e: ClipboardEvent) => {
      if (isTyping(e.target) || !window.getSelection()?.isCollapsed) return;
      const picked = current();
      if (!picked || !e.clipboardData) return;
      const payload: Payload = { type: marker, version: 1, items: picked.items };
      e.clipboardData.setData("text/plain", JSON.stringify(payload));
      e.preventDefault();
      repeat.current = { text: "", count: 0 };
      if (e.type === "cut") {
        const ids = new Set(picked.items.map((i) => i.id));
        const store = useBoardStore.getState();
        store.commit((b) => removeItems(b, ids));
        store.setSelection([]);
      }
    };

    const onPaste = (e: ClipboardEvent) => {
      if (isTyping(e.target) || !e.clipboardData) return;
      const data = e.clipboardData;
      const text = data.getData("text/plain");
      const items = parsePayload(text);
      if (items) {
        e.preventDefault();
        insert(items, text);
        return;
      }
      if ([...data.items].some((i) => i.type.startsWith("image/"))) {
        e.preventDefault();
        useBoardStore.getState().showToast("Resim yapıştırma henüz yok; sıradaki işlerde.");
        return;
      }
      if (text.trim()) {
        e.preventDefault();
        const c = viewCenter();
        const note = noteFromText(text, c.x, c.y);
        const store = useBoardStore.getState();
        store.commit((b) => ({ ...b, items: [...b.items, note] }));
        store.setSelection([note.id]);
      }
    };

    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || e.altKey || isTyping(e.target)) return;
      const key = e.key.toLowerCase();
      if (key === "d") {
        e.preventDefault();
        const picked = current();
        if (picked) insert(picked.items, `dup:${picked.items.map((i) => i.id).join(",")}`);
      } else if (key === "a") {
        e.preventDefault();
        const s = useBoardStore.getState();
        const board = s.workspace.boards[s.activeBoardId];
        if (board) s.setSelection(board.items.map((i) => i.id).sort());
      }
    };

    document.addEventListener("copy", onCopy);
    document.addEventListener("cut", onCopy);
    document.addEventListener("paste", onPaste);
    window.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("copy", onCopy);
      document.removeEventListener("cut", onCopy);
      document.removeEventListener("paste", onPaste);
      window.removeEventListener("keydown", onKey);
    };
  }, [screenToFlowPosition]);
}
