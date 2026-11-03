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

export function serializeManifest(manifest: WorkspaceManifest): string {
  return stableStringify(manifest);
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

/** Field-level checks so a hand-edited or badly merged file fails here, not during render. */
function itemProblem(item: BoardItem): string | null {
  if (!item || typeof item !== "object" || !isStr(item.id)) return "kimlik eksik";
  if (item.kind === "edge") {
    if (!isStr(item.source) || !isStr(item.target)) return "bağlantı uçları eksik";
    if (item.style !== "flow" && item.style !== "reference") return "bağlantı türü geçersiz";
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
      return item.content?.type === "doc" ? null : "not içeriği geçersiz";
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
  const data = parseJson(text, "Pano dosyası") as BoardDoc;
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

export function parseManifest(text: string): WorkspaceManifest {
  const data = parseJson(text, "raelin.json") as WorkspaceManifest;
  if (data?.formatVersion !== formatVersion || !Array.isArray(data.boards)) {
    throw new FormatError("raelin.json eksik veya desteklenmeyen sürümde.");
  }
  for (const board of data.boards) {
    if (!isSafeId(board.id)) throw new FormatError(`Geçersiz pano kimliği: ${board.id}`);
  }
  return data;
}

export function parseWorkspace(
  manifestText: string,
  boardTexts: Record<string, string>,
): Workspace {
  const manifest = parseManifest(manifestText);
  const boards: Record<string, BoardDoc> = {};
  for (const { id } of manifest.boards) {
    const text = boardTexts[id];
    if (text === undefined) throw new FormatError(`Pano dosyası bulunamadı: boards/${id}.json`);
    const board = parseBoard(text);
    if (board.id !== id) throw new FormatError(`Pano kimliği dosya adıyla uyuşmuyor: ${id}`);
    boards[id] = board;
  }
  return { manifest, boards };
}
