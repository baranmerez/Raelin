import { invoke } from "@tauri-apps/api/core";
import { getNodesBounds, type Node } from "@xyflow/react";
import { toPng, toSvg } from "html-to-image";
import { selectionItems } from "../canvas/useClipboard";
import { isDesktop } from "../platform/storage";
import { useBoardStore } from "../state/boardStore";

export type ImageKind = "png" | "svg";

const padding = 48;
/** PNGs are rendered at twice the board size, but never past this many pixels a side. */
const maxPixels = 8000;

/** Canvas chrome that must not end up in a picture of the board. */
const chrome = [
  "react-flow__handle",
  "react-flow__resize-control",
  "react-flow__panel",
  "is-empty",
];

function fileName(title: string, kind: ImageKind): string {
  return `${title.replace(/[\\/:*?"<>|]+/g, "-").trim() || "raelin"}.${kind}`;
}

function nextFrame(): Promise<void> {
  return new Promise((resolve) =>
    requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
  );
}

function dataUrlBytes(url: string): Uint8Array {
  const comma = url.indexOf(",");
  const head = url.slice(0, comma);
  const body = url.slice(comma + 1);
  if (head.endsWith(";base64")) return Uint8Array.from(atob(body), (c) => c.charCodeAt(0));
  return new TextEncoder().encode(decodeURIComponent(body));
}

async function deliver(bytes: Uint8Array, name: string, kind: ImageKind): Promise<boolean> {
  if (!isDesktop) {
    const type = kind === "png" ? "image/png" : "image/svg+xml";
    const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type }));
    const link = Object.assign(document.createElement("a"), { href: url, download: name });
    link.click();
    URL.revokeObjectURL(url);
    return true;
  }
  const path = await invoke<string | null>("pick_image_file", { defaultName: name, kind });
  if (!path) return false;
  await invoke("write_image_file", bytes, { headers: { "x-path": encodeURIComponent(path) } });
  return true;
}

export interface RenderOptions {
  kind: ImageKind;
  /** Ids to draw (with their edges); null draws the whole board. */
  scope: ReadonlySet<string> | null;
  /** Longest side of the picture in pixels; defaults to twice the board size. */
  maxSide?: number;
}

/**
 * Renders the active board (or the scoped items) to a data URL, or null when nothing is
 * in scope. Selection highlights are cleared for the few frames of rendering and then
 * restored, unless the user selected something else meanwhile.
 */
export async function renderBoardImage(
  nodes: Node[],
  { kind, scope, maxSide }: RenderOptions,
): Promise<string | null> {
  const viewport = document.querySelector<HTMLElement>(".react-flow__viewport");
  const picked = scope ? nodes.filter((n) => scope.has(n.id)) : nodes;
  if (!viewport || picked.length === 0) return null;

  const bounds = getNodesBounds(picked);
  const width = Math.ceil(bounds.width + padding * 2);
  const height = Math.ceil(bounds.height + padding * 2);
  const pixelRatio = Math.min(2, (maxSide ?? maxPixels) / Math.max(width, height));
  const paper = getComputedStyle(document.documentElement).getPropertyValue("--paper").trim();

  const selected = useBoardStore.getState().selectedIds;
  if (selected.length > 0) {
    useBoardStore.getState().setSelection([]);
    await nextFrame();
  }
  try {
    const options = {
      backgroundColor: paper || "#fbf7f1",
      width,
      height,
      pixelRatio,
      style: {
        width: `${width}px`,
        height: `${height}px`,
        transform: `translate(${padding - bounds.x}px, ${padding - bounds.y}px) scale(1)`,
      },
      filter: (el: HTMLElement) => {
        const classes = el.classList;
        if (!classes) return true;
        if (chrome.some((c) => classes.contains(c))) return false;
        if (!scope) return true;
        // Edge labels live outside their edge's element and carry its id separately.
        const id = el.getAttribute?.("data-id") ?? el.getAttribute?.("data-edge-label");
        const isItem =
          classes.contains("react-flow__node") ||
          classes.contains("react-flow__edge") ||
          classes.contains("edge-label");
        return !isItem || !id || scope.has(id);
      },
    };
    return kind === "png" ? await toPng(viewport, options) : await toSvg(viewport, options);
  } finally {
    const store = useBoardStore.getState();
    if (selected.length > 0 && store.selectedIds.length === 0) store.setSelection(selected);
  }
}

/**
 * Renders the board (or the selection, with everything inside selected regions) to a
 * PNG or SVG file.
 */
export async function exportBoardImage(kind: ImageKind, nodes: Node[]): Promise<void> {
  const store = useBoardStore.getState();
  const board = store.workspace.boards[store.activeBoardId];
  if (!board) return;
  const selected = store.selectedIds;
  const scope =
    selected.length > 0 ? new Set(selectionItems(board, selected).map((i) => i.id)) : null;
  try {
    const url = await renderBoardImage(nodes, { kind, scope });
    if (!url) {
      store.showToast("Dışa aktarılacak bir şey yok.", "error");
      return;
    }
    if (await deliver(dataUrlBytes(url), fileName(board.title, kind), kind)) {
      store.showToast(`${kind.toUpperCase()} kaydedildi.`);
    }
  } catch (error) {
    store.showToast(
      `Dışa aktarılamadı: ${error instanceof Error ? error.message : String(error)}`,
      "error",
    );
  }
}
