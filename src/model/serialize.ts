import { isAssetName, isSafeId } from "./ids";
import {
  type BoardDoc,
  type BoardItem,
  formatVersion,
  type Workspace,
  type WorkspaceManifest,
} from "./types";

/**
 * JSON with sorted object keys and 2-space indent, so the same document always
 * produces the same text and git diffs only show real changes.
 */
export function stableStringify(value: unknown): string {
  return `${JSON.stringify(sortKeys(value), null, 2)}\n`;
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value && typeof value === "object") {
    const result: Record<string, unknown> = {};
    for (const key of Object.keys(value).sort()) {
      const child = (value as Record<string, unknown>)[key];
      if (child !== undefined) result[key] = sortKeys(child);
    }
    return result;
  }
  return value;
}

export function serializeBoard(board: BoardDoc): string {
  const items = [...board.items].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return stableStringify({ ...board, items });
}

export class FormatError extends Error {}

function parseJson(text: string, what: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    throw new FormatError(`${what} geçerli JSON değil.`);
  }
}

const isNum = (v: unknown) => typeof v === "number" && Number.isFinite(v);
const isStr = (v: unknown) => typeof v === "string";
const tones = new Set(["lilac", "peach", "periwinkle", "sage", "butter", "paper"]);
const shapes = new Set(["terminal", "process", "decision"]);

const isOptStr = (v: unknown) => v === undefined || isStr(v);

/**
 * Shape of a Tiptap document node: what the note renderer walks. Deeply nested or
 * malformed content is rejected instead of crashing the canvas on every start.
 */
function isDocNode(node: unknown, depth = 0): boolean {
  if (depth > 40 || !node || typeof node !== "object" || Array.isArray(node)) return false;
  const n = node as {
    type?: unknown;
    text?: unknown;
    attrs?: unknown;
    marks?: unknown;
    content?: unknown;
  };
  if (!isStr(n.type) || !isOptStr(n.text)) return false;
  if (
    n.attrs !== undefined &&
    (!n.attrs || typeof n.attrs !== "object" || Array.isArray(n.attrs))
  ) {
    return false;
  }
  if (
    n.marks !== undefined &&
    !(Array.isArray(n.marks) && n.marks.every((m) => !!m && typeof m === "object" && isStr(m.type)))
  ) {
    return false;
  }
  return (
    n.content === undefined ||
    (Array.isArray(n.content) && n.content.every((child) => isDocNode(child, depth + 1)))
  );
}

/** Field-level checks so a hand-edited or badly merged file fails here, not during render. */
function itemProblem(item: BoardItem): string | null {
  if (!item || typeof item !== "object" || !isStr(item.id)) return "kimlik eksik";
  if (item.kind === "edge") {
    if (!isStr(item.source) || !isStr(item.target)) return "bağlantı uçları eksik";
    if (item.style !== "flow" && item.style !== "reference") return "bağlantı türü geçersiz";
    if (!isOptStr(item.label) || !isOptStr(item.sourceHandle) || !isOptStr(item.targetHandle)) {
      return "bağlantı etiketi veya ucu geçersiz";
    }
    return null;
  }
  if (!isNum(item.x) || !isNum(item.y) || !isNum(item.width) || item.width <= 0) {
    return "konum veya boyut geçersiz";
  }
  switch (item.kind) {
    case "flowNode":
      if (!shapes.has(item.shape) || !isStr(item.text) || !tones.has(item.tone))
        return "akış alanları geçersiz";
      return isNum(item.height) && item.height > 0 ? null : "yükseklik geçersiz";
    case "note":
      if (!isStr(item.title) || !tones.has(item.tone)) return "not alanları geçersiz";
      return item.content?.type === "doc" && isDocNode(item.content)
        ? null
        : "not içeriği geçersiz";
    case "region":
      if (!isStr(item.title) || !tones.has(item.tone)) return "bölge alanları geçersiz";
      return isNum(item.height) && item.height > 0 ? null : "yükseklik geçersiz";
    case "stroke": {
      const pointsOk =
        Array.isArray(item.points) &&
        item.points.every((p) => Array.isArray(p) && p.length === 3 && p.every(isNum));
      if (!pointsOk || !isStr(item.color) || !isNum(item.size)) return "çizim noktaları geçersiz";
      return isNum(item.height) && item.height > 0 ? null : "yükseklik geçersiz";
    }
    case "image":
      if (!isStr(item.src) || !isAssetName(item.src) || !isStr(item.alt)) {
        return "resim alanları geçersiz";
      }
      return isNum(item.height) && item.height > 0 ? null : "yükseklik geçersiz";
    default:
      return `bilinmeyen öğe türü: ${String((item as { kind?: unknown }).kind)}`;
  }
}

export function parseBoard(text: string): BoardDoc {
  return checkBoard(parseJson(text, "Pano dosyası"));
}

function checkBoard(value: unknown): BoardDoc {
  const data = value as BoardDoc;
  if (data?.formatVersion !== formatVersion) {
    throw new FormatError(`Desteklenmeyen pano biçimi: ${String(data?.formatVersion)}`);
  }
  if (!isSafeId(data.id) || !Array.isArray(data.items) || !isStr(data.title)) {
    throw new FormatError("Pano dosyası eksik veya bozuk.");
  }
  validateItems(data.items);
  return data;
}

/**
 * Invariants every board must hold, whether it came from a file, the UI or an AI client.
 * Throws FormatError with the first problem found.
 */
export function validateItems(items: readonly BoardItem[]): void {
  const nodeIds = new Set<string>();
  const ids = new Set<string>();
  for (const item of items) {
    const problem = itemProblem(item);
    if (problem) throw new FormatError(`Öğe ${String(item?.id)}: ${problem}`);
    if (ids.has(item.id)) throw new FormatError(`Tekrarlanan öğe kimliği: ${item.id}`);
    ids.add(item.id);
    if (item.kind !== "edge") nodeIds.add(item.id);
  }
  for (const item of items) {
    // Edges must connect two nodes; an edge pointing at another edge is invalid too.
    if (item.kind === "edge" && (!nodeIds.has(item.source) || !nodeIds.has(item.target))) {
      throw new FormatError(`Bağlantı olmayan bir öğeyi gösteriyor: ${item.id}`);
    }
  }
}

/** Name → base64 bytes of every picture the boards use. */
export type AssetData = Record<string, string>;

export interface WorkspaceFileData {
  workspace: Workspace;
  assets: AssetData;
}

/** Marks a Raelin workspace file, so an unrelated JSON file is not opened by mistake. */
const fileKind = "raelin-workspace";
const base64 = /^[A-Za-z0-9+/]*={0,2}$/;
/** 10 MB of picture is a little over 13.3 MB of base64. */
const maxAssetChars = Math.ceil((10 * 1024 * 1024 * 4) / 3) + 4;

/**
 * The whole workspace as one `.rli` file: boards in tab order, each with its items
 * sorted by id, and pictures as base64. Keys are sorted, so saving the same workspace
 * twice gives the same text.
 */
export function serializeWorkspaceFile(workspace: Workspace, assets: AssetData): string {
  const boards = workspace.manifest.boards.map(({ id }) => {
    const board = workspace.boards[id];
    return { ...board, items: [...board.items].sort((a, b) => (a.id < b.id ? -1 : 1)) };
  });
  return stableStringify({
    kind: fileKind,
    formatVersion,
    title: workspace.manifest.title,
    boards,
    assets,
  });
}

export function parseWorkspaceFile(text: string): WorkspaceFileData {
  const data = parseJson(text, "Çalışma alanı dosyası") as {
    kind?: unknown;
    formatVersion?: unknown;
    title?: unknown;
    boards?: unknown;
    assets?: unknown;
  };
  if (data?.kind !== fileKind) throw new FormatError("Bu bir Raelin çalışma alanı dosyası değil.");
  if (data.formatVersion !== formatVersion) {
    throw new FormatError(`Desteklenmeyen dosya sürümü: ${String(data.formatVersion)}`);
  }
  if (!isStr(data.title) || !Array.isArray(data.boards) || data.boards.length === 0) {
    throw new FormatError("Çalışma alanı dosyası eksik veya bozuk.");
  }
  const boards: Record<string, BoardDoc> = {};
  for (const raw of data.boards) {
    const board = checkBoard(raw);
    if (boards[board.id]) throw new FormatError(`Tekrarlanan pano kimliği: ${board.id}`);
    boards[board.id] = board;
  }
  const assets: AssetData = {};
  const rawAssets = (data.assets ?? {}) as Record<string, unknown>;
  if (typeof rawAssets !== "object" || Array.isArray(rawAssets)) {
    throw new FormatError("Resim listesi bozuk.");
  }
  for (const [name, value] of Object.entries(rawAssets)) {
    if (!isAssetName(name)) throw new FormatError(`Geçersiz resim adı: ${name}`);
    if (!isStr(value) || value.length > maxAssetChars || !base64.test(value)) {
      throw new FormatError(`Resim verisi bozuk: ${name}`);
    }
    assets[name] = value;
  }
  const manifest: WorkspaceManifest = {
    formatVersion,
    title: data.title,
    boards: (data.boards as BoardDoc[]).map((b) => ({ id: b.id, title: b.title })),
  };
  return { workspace: { manifest, boards }, assets };
}
