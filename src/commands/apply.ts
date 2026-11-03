import {
  makeChecklist,
  makeEdge,
  makeFlowNode,
  makeLink,
  makeNote,
  makeRegion,
  makeTable,
  makeText,
  shapeSize,
} from "../model/factory";
import { newId } from "../model/ids";
import { markdownToDoc } from "../model/noteMarkdown";
import { FormatError, validateItems } from "../model/serialize";
import type {
  BoardDoc,
  BoardItem,
  CardItem,
  CheckEntry,
  EdgeItem,
  NodeItem,
  RegionItem,
  TableColumn,
} from "../model/types";
import { isNodeItem } from "../model/types";
import { boundsOf, center, obstacles, overlaps, type Rect, rectOf, regionOf } from "./geometry";
import { maxOpsPerBatch, type Op, type Place } from "./schema";

export type CommandErrorCode =
  | "INVALID"
  | "NOT_FOUND"
  | "TOO_LARGE"
  | "STALE_REVISION"
  | "REJECTED"
  | "NO_BOARD";

export class CommandError extends Error {
  constructor(
    readonly code: CommandErrorCode,
    message: string,
    readonly index?: number,
  ) {
    super(message);
  }
}

export interface ApplyResult {
  board: BoardDoc;
  /** Batch-local refs mapped to the ids they were given. */
  refs: Record<string, string>;
  created: string[];
  changed: string[];
  removed: string[];
  warnings: string[];
}

/** Batches that need an explicit user OK before an AI client may apply them. */
export function isDestructive(ops: readonly Op[]): boolean {
  const moves = ops.filter((o) => o.op === "move").length;
  return ops.some((o) => o.op === "delete") || moves > 20;
}

const verticalGap = 56;

type AddOp = Extract<Op, { op: "add" }>;
type UpdateOp = Extract<Op, { op: "update" }>;

const contentFields = [
  "text",
  "title",
  "markdown",
  "shape",
  "size",
  "url",
  "note",
  "items",
  "columns",
] as const;

/**
 * Content fields each kind reads. The older kinds list everything they already warn
 * about themselves, so only the card fields produce the generic warning there.
 */
const usedFields: Record<NodeItem["kind"], readonly string[]> = {
  flowNode: ["text", "shape", "title", "markdown"],
  note: ["title", "markdown", "text", "shape"],
  region: ["title", "markdown", "text", "shape"],
  image: ["title", "text", "shape", "markdown"],
  stroke: contentFields,
  arrow: contentFields,
  text: ["text", "size"],
  checklist: ["title", "items"],
  link: ["url", "title", "note"],
  table: ["title", "columns"],
};

function unusedFields(op: AddOp | UpdateOp, used: readonly string[]): string[] {
  return contentFields.filter((f) => op[f] !== undefined && !used.includes(f));
}

/** Entries keep their ids by position, so an edit does not look like a new list. */
function checkEntries(
  list: NonNullable<AddOp["items"]>,
  previous: readonly CheckEntry[] = [],
): CheckEntry[] {
  return list.map((e, i) => ({
    id: previous[i]?.id ?? newId("c"),
    text: e.text,
    done: e.done ?? false,
  }));
}

/** Columns keep their ids by name; a key column is not nullable unless asked. */
function tableColumns(
  list: NonNullable<AddOp["columns"]>,
  previous: readonly TableColumn[] = [],
): TableColumn[] {
  const byName = new Map(previous.map((c) => [c.name, c.id]));
  const taken = new Set<string>();
  return list.map((c) => {
    let id = byName.get(c.name);
    if (!id || taken.has(id)) id = newId("col");
    taken.add(id);
    const pk = c.pk ?? false;
    return {
      id,
      name: c.name,
      type: c.type,
      pk,
      nullable: c.nullable ?? !pk,
      ...(c.note ? { note: c.note } : {}),
    };
  });
}

/** New card item at the origin, or null for the older kinds. */
function makeCard(op: AddOp, index: number): CardItem | null {
  switch (op.kind) {
    case "text":
      return makeText(0, 0, op.text ?? "Metin", op.size, op.tone);
    case "checklist": {
      const list = makeChecklist(0, 0, op.title ?? "Kontrol listesi", [], op.tone);
      return { ...list, items: checkEntries(op.items ?? []) };
    }
    case "link":
      if (!op.url) throw new CommandError("INVALID", "Bağlantı kartı için url gerekli.", index);
      return makeLink(0, 0, op.url, op.title ?? "", op.note ?? "", op.tone);
    case "table":
      return makeTable(0, 0, op.title ?? "yeni_tablo", tableColumns(op.columns ?? []), op.tone);
    default:
      return null;
  }
}

/** Finds a free spot for a rect, starting at `start` and stepping down (then right). */
function freeSpot(start: Rect, taken: Rect[]): Rect {
  let candidate = { ...start };
  for (let attempt = 0; attempt < 80; attempt++) {
    const hit = taken.find((r) => overlaps(candidate, r));
    if (!hit) return candidate;
    candidate =
      attempt % 20 === 19
        ? { ...start, x: start.x + (Math.floor(attempt / 20) + 1) * (start.width + 60) }
        : { ...candidate, y: hit.y + hit.height + 24 };
  }
  return candidate;
}

/**
 * Applies a batch to a board as one pure transformation. Either every op applies or a
 * CommandError is thrown and the board is untouched; the result is validated with the
 * same invariants used for files and the UI.
 */
export function applyOps(board: BoardDoc, ops: readonly Op[]): ApplyResult {
  if (ops.length === 0) throw new CommandError("INVALID", "Boş işlem listesi.");
  if (ops.length > maxOpsPerBatch) {
    throw new CommandError(
      "TOO_LARGE",
      `Bir toplu işlemde en fazla ${maxOpsPerBatch} işlem olabilir.`,
    );
  }

  let items: BoardItem[] = [...board.items];
  let style: Pick<BoardDoc, "flowStyle" | "connector" | "background"> = {
    flowStyle: board.flowStyle,
    connector: board.connector,
    background: board.background,
  };
  const refs: Record<string, string> = {};
  const created = new Set<string>();
  const changed = new Set<string>();
  const removed = new Set<string>();
  const warnings: string[] = [];
  let lastAdded: string | null = null;

  const resolve = (idOrRef: string) => refs[idOrRef] ?? idOrRef;
  const find = (idOrRef: string, index: number): BoardItem => {
    const id = resolve(idOrRef);
    const item = items.find((i) => i.id === id);
    if (!item) throw new CommandError("NOT_FOUND", `Öğe bulunamadı: ${idOrRef}`, index);
    return item;
  };
  const findNode = (idOrRef: string, index: number): NodeItem => {
    const item = find(idOrRef, index);
    if (!isNodeItem(item)) throw new CommandError("INVALID", `Düğüm değil: ${idOrRef}`, index);
    return item;
  };
  const replace = (next: BoardItem) => {
    items = items.map((i) => (i.id === next.id ? next : i));
    if (!created.has(next.id)) changed.add(next.id);
  };

  /** Top-left position for a node of the given size, following the place hints. */
  const position = (
    place: Place | undefined,
    size: { width: number; height: number },
    index: number,
    selfId?: string,
  ): { x: number; y: number } => {
    const taken = obstacles({ ...board, items }, new Set(selfId ? [selfId] : []));
    if (place?.x !== undefined && place.y !== undefined) {
      return { x: place.x - size.width / 2, y: place.y - size.height / 2 };
    }
    const afterRef = place?.after ?? (place?.in ? undefined : (lastAdded ?? undefined));
    if (afterRef) {
      const anchor = rectOf(findNode(afterRef, index));
      const c = center(anchor);
      const start = {
        x: c.x - size.width / 2,
        y: anchor.y + anchor.height + verticalGap,
        ...size,
      };
      return freeSpot(start, taken);
    }
    if (place?.in) {
      const region = findNode(place.in, index);
      if (region.kind !== "region") {
        throw new CommandError("INVALID", `Bölge değil: ${place.in}`, index);
      }
      const start = { x: region.x + 40, y: region.y + 96, ...size };
      return freeSpot(start, taken);
    }
    // No hint: to the right of everything, top-aligned.
    const bounds = boundsOf(items.filter(isNodeItem).map(rectOf));
    const start = bounds
      ? { x: bounds.x + bounds.width + 120, y: bounds.y, ...size }
      : { x: 0, y: 0, ...size };
    return freeSpot(start, taken);
  };

  /** The region a placed node belongs to: the named one, or the region of its anchor. */
  const hostRegion = (place: Place | undefined, index: number): RegionItem | undefined => {
    if (place?.in) {
      const region = findNode(place.in, index);
      return region.kind === "region" ? region : undefined;
    }
    const afterRef =
      place?.after ?? (place?.x === undefined ? (lastAdded ?? undefined) : undefined);
    if (!afterRef) return undefined;
    return regionOf({ ...board, items }, findNode(afterRef, index));
  };

  /** Grows a region so a node placed into it stays inside instead of spilling out. */
  const fitRegion = (region: RegionItem | undefined, rect: Rect) => {
    if (!region) return;
    const current = items.find((i) => i.id === region.id) as RegionItem;
    const x = Math.min(current.x, rect.x - 40);
    const y = Math.min(current.y, rect.y - 96);
    const right = Math.max(current.x + current.width, rect.x + rect.width + 40);
    const bottom = Math.max(current.y + current.height, rect.y + rect.height + 48);
    if (
      x === current.x &&
      y === current.y &&
      right === current.x + current.width &&
      bottom === current.y + current.height
    ) {
      return;
    }
    replace({ ...current, x, y, width: right - x, height: bottom - y });
  };

  ops.forEach((op, index) => {
    switch (op.op) {
      case "add": {
        if (op.ref && refs[op.ref])
          throw new CommandError("INVALID", `ref tekrarlandı: ${op.ref}`, index);
        let item: NodeItem;
        const host = op.kind === "region" ? undefined : hostRegion(op.place, index);
        const extra = unusedFields(op, usedFields[op.kind]);
        if (extra.length > 0) warnings.push(`${op.kind}: ${extra.join(", ")} kullanılmaz.`);
        const card = makeCard(op, index);
        if (card) {
          const pos = position(op.place, rectOf(card), index);
          item = { ...card, x: pos.x, y: pos.y };
        } else if (op.kind === "flowNode") {
          const shape = op.shape ?? "process";
          const pos = position(op.place, shapeSize[shape], index);
          const node = makeFlowNode(shape, 0, 0, op.text ?? "", op.tone);
          item = { ...node, x: pos.x, y: pos.y };
        } else if (op.kind === "note") {
          const note = makeNote(0, 0, op.title ?? "Not");
          if (op.markdown !== undefined) note.content = markdownToDoc(op.markdown);
          if (op.tone) note.tone = op.tone;
          const size = rectOf(note);
          const pos = position(op.place, size, index);
          item = { ...note, x: pos.x, y: pos.y };
        } else {
          const region = makeRegion(0, 0, op.title ?? "Bölge", op.tone ?? "lilac");
          const pos = position(op.place, region, index);
          item = { ...region, x: pos.x, y: pos.y };
        }
        items.push(item);
        created.add(item.id);
        fitRegion(host, rectOf(item));
        if (op.ref) refs[op.ref] = item.id;
        if (item.kind !== "region") lastAdded = item.id;
        break;
      }
      case "update": {
        const item = findNode(op.id, index);
        if (item.kind === "stroke" || item.kind === "arrow")
          throw new CommandError("INVALID", "Serbest çizim ve ok düzenlenemez.", index);
        let next: NodeItem = item;
        const extra = unusedFields(op, usedFields[item.kind]);
        if (extra.length > 0) warnings.push(`${op.id}: ${extra.join(", ")} kullanılmaz.`);
        if (item.kind === "text") {
          next = {
            ...item,
            text: op.text ?? item.text,
            size: op.size ?? item.size,
            tone: op.tone ?? item.tone,
          };
        } else if (item.kind === "checklist") {
          next = {
            ...item,
            title: op.title ?? item.title,
            tone: op.tone ?? item.tone,
            items: op.items ? checkEntries(op.items, item.items) : item.items,
          };
        } else if (item.kind === "link") {
          next = {
            ...item,
            url: op.url ?? item.url,
            title: op.title ?? item.title,
            note: op.note ?? item.note,
            tone: op.tone ?? item.tone,
          };
        } else if (item.kind === "table") {
          next = {
            ...item,
            name: op.title ?? item.name,
            tone: op.tone ?? item.tone,
            columns: op.columns ? tableColumns(op.columns, item.columns) : item.columns,
          };
        } else if (item.kind === "flowNode") {
          if (op.title !== undefined || op.markdown !== undefined) {
            warnings.push(`${op.id}: akış adımında yalnız text, tone ve shape kullanılır.`);
          }
          const shape = op.shape ?? item.shape;
          const resized =
            shape !== item.shape
              ? {
                  ...shapeSize[shape],
                  x: item.x + (item.width - shapeSize[shape].width) / 2,
                  y: item.y + (item.height - shapeSize[shape].height) / 2,
                }
              : {};
          next = {
            ...item,
            text: op.text ?? item.text,
            tone: op.tone ?? item.tone,
            shape,
            ...resized,
          };
        } else if (item.kind === "image") {
          if (op.text !== undefined || op.shape !== undefined || op.markdown !== undefined) {
            warnings.push(`${op.id}: resimde yalnız title (alt metin) değişir.`);
          }
          next = { ...item, alt: op.title ?? item.alt };
        } else {
          if (op.text !== undefined || op.shape !== undefined) {
            warnings.push(`${op.id}: not ve bölgede title, markdown ve tone kullanılır.`);
          }
          next = { ...item, title: op.title ?? item.title, tone: op.tone ?? item.tone };
          if (item.kind === "note" && op.markdown !== undefined) {
            next = { ...next, content: markdownToDoc(op.markdown) } as NodeItem;
          } else if (item.kind === "region" && op.markdown !== undefined) {
            warnings.push(`${op.id}: bölgenin gövdesi yok, markdown yok sayıldı.`);
          }
        }
        replace(next);
        break;
      }
      case "connect": {
        const from = findNode(op.from, index);
        const to = findNode(op.to, index);
        if (from.id === to.id)
          throw new CommandError("INVALID", "Bir öğe kendisine bağlanamaz.", index);
        const duplicate = items.find(
          (i) =>
            i.kind === "edge" &&
            i.source === from.id &&
            i.target === to.id &&
            i.style === (op.style ?? "flow"),
        );
        if (duplicate) {
          warnings.push(`${from.id} → ${to.id} bağlantısı zaten var (${duplicate.id}).`);
          if (op.ref) refs[op.ref] = duplicate.id;
          break;
        }
        const edge = makeEdge(from.id, to.id, {
          label: op.label || undefined,
          style: op.style ?? "flow",
          sourceHandle: op.fromSide ?? "b",
          targetHandle: op.toSide ?? "t",
        });
        items.push(edge);
        created.add(edge.id);
        if (op.ref) refs[op.ref] = edge.id;
        break;
      }
      case "update_edge": {
        const edge = find(op.id, index);
        if (edge.kind !== "edge")
          throw new CommandError("INVALID", `Bağlantı değil: ${op.id}`, index);
        const next: EdgeItem = {
          ...edge,
          style: op.style ?? edge.style,
          label: op.label === null ? undefined : (op.label ?? edge.label),
        };
        replace(next);
        break;
      }
      case "move": {
        const item = findNode(op.id, index);
        const rect = rectOf(item);
        const host = item.kind === "region" ? undefined : hostRegion(op.place, index);
        const pos = position(op.place, rect, index, item.id);
        replace({ ...item, x: pos.x, y: pos.y });
        fitRegion(host, { ...rect, x: pos.x, y: pos.y });
        break;
      }
      case "delete": {
        const ids = new Set(
          op.ids.map((id) => {
            const item = find(id, index);
            return item.id;
          }),
        );
        items = items.filter(
          (i) => !ids.has(i.id) && !(i.kind === "edge" && (ids.has(i.source) || ids.has(i.target))),
        );
        for (const id of ids) {
          removed.add(id);
          created.delete(id);
          changed.delete(id);
        }
        break;
      }
      case "style": {
        style = {
          flowStyle: op.flowStyle ?? style.flowStyle,
          connector: op.connector ?? style.connector,
          background: op.background ?? style.background,
        };
        break;
      }
    }
  });

  // Edges removed together with their nodes count as removed too.
  const remaining = new Set(items.map((i) => i.id));
  for (const item of board.items) {
    if (!remaining.has(item.id)) removed.add(item.id);
  }

  try {
    validateItems(items);
  } catch (error) {
    if (error instanceof FormatError) throw new CommandError("INVALID", error.message);
    throw error;
  }

  return {
    board: { ...board, ...style, items },
    refs,
    created: [...created],
    changed: [...changed],
    removed: [...removed],
    warnings,
  };
}
