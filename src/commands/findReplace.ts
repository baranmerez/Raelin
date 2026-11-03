import type { JSONContent } from "@tiptap/react";
import { FormatError, validateItems } from "../model/serialize";
import type { BoardDoc, BoardItem } from "../model/types";
import { CommandError } from "./apply";

export interface FindReplaceOptions {
  find: string;
  replace: string;
  caseSensitive?: boolean;
}

export interface Match {
  id: string;
  kind: BoardItem["kind"];
  field: string;
  count: number;
  before: string;
  after: string;
}

export interface FindReplaceResult {
  board: BoardDoc;
  matches: Match[];
  /** Ids of the items whose text actually changes. */
  changed: string[];
  total: number;
}

function escapePattern(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function preview(text: string, at: number, length: number): string {
  const start = Math.max(0, at - 30);
  const end = Math.min(text.length, at + length + 30);
  return `${start > 0 ? "…" : ""}${text.slice(start, end)}${end < text.length ? "…" : ""}`;
}

/** Replaces inside one string; null when there is no match. */
function replaceIn(text: string, pattern: RegExp, replace: string) {
  pattern.lastIndex = 0;
  const first = pattern.exec(text);
  if (!first) return null;
  let count = 0;
  const next = text.replace(pattern, () => {
    count++;
    return replace;
  });
  return {
    next,
    count,
    before: preview(text, first.index, first[0].length),
    after: preview(next, first.index, replace.length),
  };
}

/** Replaces in every Tiptap text node, keeping its marks; matches never span nodes. */
function replaceInDoc(doc: JSONContent, pattern: RegExp, replace: string) {
  let count = 0;
  let before = "";
  let after = "";
  const walk = (node: JSONContent): JSONContent => {
    if (node.type === "text" && typeof node.text === "string") {
      const hit = replaceIn(node.text, pattern, replace);
      if (!hit) return node;
      count += hit.count;
      if (!before) {
        before = hit.before;
        after = hit.after;
      }
      return { ...node, text: hit.next };
    }
    if (!node.content) return node;
    let touched = false;
    const content = node.content.map((child) => {
      const next = walk(child);
      if (next !== child) touched = true;
      return next;
    });
    return touched ? { ...node, content } : node;
  };
  const next = walk(doc);
  return count > 0 ? { next, count, before, after } : null;
}

/**
 * Finds text in step labels, note titles and bodies, region titles, edge labels and image
 * alt texts and replaces it, as one pure transformation of the board.
 */
export function findReplace(board: BoardDoc, options: FindReplaceOptions): FindReplaceResult {
  if (!options.find) throw new CommandError("INVALID", "Aranacak metin boş.");
  const pattern = new RegExp(escapePattern(options.find), options.caseSensitive ? "g" : "gi");
  const { replace } = options;
  const matches: Match[] = [];
  const changed: string[] = [];
  let total = 0;

  const items = board.items.map((item): BoardItem => {
    let next: BoardItem = item;
    const field = (name: string, text: string | undefined, apply: (value: string) => BoardItem) => {
      if (!text) return;
      const hit = replaceIn(text, pattern, replace);
      if (!hit) return;
      const { next: value, ...shown } = hit;
      matches.push({ id: item.id, kind: item.kind, field: name, ...shown });
      total += hit.count;
      next = apply(value);
    };
    switch (item.kind) {
      case "flowNode":
        field("text", item.text, (text) => ({ ...item, text }));
        break;
      case "note": {
        field("title", item.title, (title) => ({ ...item, title }));
        const body = replaceInDoc(item.content, pattern, replace);
        if (body) {
          matches.push({
            id: item.id,
            kind: item.kind,
            field: "body",
            count: body.count,
            before: body.before,
            after: body.after,
          });
          total += body.count;
          next = { ...(next as typeof item), content: body.next };
        }
        break;
      }
      case "region":
        field("title", item.title, (title) => ({ ...item, title }));
        break;
      case "image":
        field("alt", item.alt, (alt) => ({ ...item, alt }));
        break;
      case "edge":
        field("label", item.label, (label) => ({ ...item, label: label || undefined }));
        break;
      default:
        break;
    }
    if (next !== item && JSON.stringify(next) !== JSON.stringify(item)) {
      changed.push(item.id);
      return next;
    }
    return item;
  });

  const nextBoard = changed.length > 0 ? { ...board, items } : board;
  if (nextBoard !== board) {
    try {
      validateItems(items);
    } catch (error) {
      if (error instanceof FormatError) throw new CommandError("INVALID", error.message);
      throw error;
    }
  }
  return { board: nextBoard, matches, changed, total };
}
