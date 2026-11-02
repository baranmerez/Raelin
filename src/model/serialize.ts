import { isSafeId } from "./ids";
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

const itemKinds = new Set(["flowNode", "note", "region", "stroke", "edge"]);

export function parseBoard(text: string): BoardDoc {
  const data = JSON.parse(text) as BoardDoc;
  if (data.formatVersion !== formatVersion) {
    throw new FormatError(`Desteklenmeyen pano biçimi: ${String(data.formatVersion)}`);
  }
  if (!isSafeId(data.id) || !Array.isArray(data.items)) {
    throw new FormatError("Pano dosyası eksik veya bozuk.");
  }
  const ids = new Set<string>();
  for (const item of data.items as BoardItem[]) {
    if (!itemKinds.has(item.kind)) throw new FormatError(`Bilinmeyen öğe türü: ${item.kind}`);
    if (ids.has(item.id)) throw new FormatError(`Tekrarlanan öğe kimliği: ${item.id}`);
    ids.add(item.id);
  }
  for (const item of data.items) {
    if (item.kind === "edge" && (!ids.has(item.source) || !ids.has(item.target))) {
      throw new FormatError(`Bağlantı olmayan bir öğeyi gösteriyor: ${item.id}`);
    }
  }
  return data;
}

export function parseManifest(text: string): WorkspaceManifest {
  const data = JSON.parse(text) as WorkspaceManifest;
  if (data.formatVersion !== formatVersion || !Array.isArray(data.boards)) {
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
