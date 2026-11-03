import { newId } from "./ids";
import type {
  ArrowItem,
  BoardDoc,
  CardItem,
  CheckEntry,
  ChecklistItem,
  EdgeItem,
  FlowNodeItem,
  FlowShape,
  LinkItem,
  NoteItem,
  RegionItem,
  TableColumn,
  TableItem,
  TextItem,
  TextSize,
  ToneName,
} from "./types";
import { formatVersion } from "./types";

export const shapeSize: Record<FlowShape, { width: number; height: number }> = {
  terminal: { width: 220, height: 64 },
  process: { width: 240, height: 68 },
  decision: { width: 176, height: 148 },
  ellipse: { width: 220, height: 104 },
  database: { width: 168, height: 128 },
  document: { width: 230, height: 104 },
  io: { width: 240, height: 72 },
  cloud: { width: 240, height: 140 },
  actor: { width: 120, height: 150 },
};

const shapeTone: Record<FlowShape, ToneName> = {
  terminal: "sage",
  process: "periwinkle",
  decision: "peach",
  ellipse: "lilac",
  database: "periwinkle",
  document: "butter",
  io: "peach",
  cloud: "paper",
  actor: "lilac",
};

const shapeText: Record<FlowShape, string> = {
  terminal: "Başla",
  process: "Yeni adım",
  decision: "Karar?",
  ellipse: "Konu",
  database: "Veritabanı",
  document: "Belge",
  io: "Girdi / çıktı",
  cloud: "Bulut",
  actor: "Kullanıcı",
};

export function makeFlowNode(
  shape: FlowShape,
  x: number,
  y: number,
  text?: string,
  tone?: ToneName,
): FlowNodeItem {
  const size = shapeSize[shape];
  return {
    id: newId("n"),
    kind: "flowNode",
    shape,
    text: text ?? shapeText[shape],
    tone: tone ?? shapeTone[shape],
    x: x - size.width / 2,
    y: y - size.height / 2,
    ...size,
  };
}

export function makeNote(x: number, y: number, title = "Not", lines: string[] = []): NoteItem {
  return {
    id: newId("note"),
    kind: "note",
    title,
    tone: "butter",
    x: x - 140,
    y: y - 40,
    width: 280,
    content: {
      type: "doc",
      content:
        lines.length > 0
          ? [
              {
                type: "bulletList",
                content: lines.map((line) => ({
                  type: "listItem",
                  content: [{ type: "paragraph", content: [{ type: "text", text: line }] }],
                })),
              },
            ]
          : [{ type: "paragraph" }],
    },
  };
}

export function makeRegion(
  x: number,
  y: number,
  title = "Bölge",
  tone: ToneName = "lilac",
): RegionItem {
  return {
    id: newId("r"),
    kind: "region",
    title,
    tone,
    x: x - 240,
    y: y - 180,
    width: 480,
    height: 360,
  };
}

/** Font size and line height of free text, shared by the view and the estimate. */
export const textMetrics: Record<TextSize, { font: number; line: number }> = {
  s: { font: 16, line: 22 },
  m: { font: 22, line: 30 },
  l: { font: 34, line: 44 },
};

function wrappedLines(text: string, width: number, font: number): number {
  const perLine = Math.max(4, Math.floor(width / (font * 0.55)));
  return text
    .split("\n")
    .reduce((sum, line) => sum + Math.max(1, Math.ceil(line.length / perLine)), 0);
}

/** Estimated height of a content-sized card; the canvas measures the real one. */
export function cardHeight(item: CardItem): number {
  switch (item.kind) {
    case "text": {
      const m = textMetrics[item.size];
      return wrappedLines(item.text, item.width - 12, m.font) * m.line + 10;
    }
    case "checklist":
      return 104 + item.items.length * 32;
    case "link":
      return 100 + (item.note ? wrappedLines(item.note, item.width - 36, 15) * 22 : 0);
    case "table":
      return 88 + item.columns.length * 30;
  }
}

function centered<T extends CardItem>(item: T, x: number, y: number): T {
  return { ...item, x: x - item.width / 2, y: y - cardHeight(item) / 2 };
}

export function makeText(
  x: number,
  y: number,
  text = "Metin",
  size: TextSize = "m",
  tone: ToneName = "paper",
): TextItem {
  return centered({ id: newId("t"), kind: "text", text, size, tone, x: 0, y: 0, width: 260 }, x, y);
}

export function makeCheckEntry(text: string, done = false): CheckEntry {
  return { id: newId("c"), text, done };
}

export function makeChecklist(
  x: number,
  y: number,
  title = "Kontrol listesi",
  entries: { text: string; done?: boolean }[] = [{ text: "İlk madde" }],
  tone: ToneName = "sage",
): ChecklistItem {
  return centered(
    {
      id: newId("ck"),
      kind: "checklist",
      title,
      items: entries.map((e) => makeCheckEntry(e.text, e.done ?? false)),
      tone,
      x: 0,
      y: 0,
      width: 280,
    },
    x,
    y,
  );
}

export function makeLink(
  x: number,
  y: number,
  url = "https://example.com",
  title = "Bağlantı",
  note = "",
  tone: ToneName = "periwinkle",
): LinkItem {
  return centered(
    { id: newId("lk"), kind: "link", url, title, note, tone, x: 0, y: 0, width: 300 },
    x,
    y,
  );
}

export function makeColumn(
  name: string,
  type = "text",
  options: Partial<Pick<TableColumn, "pk" | "nullable" | "note">> = {},
): TableColumn {
  return {
    id: newId("col"),
    name,
    type,
    pk: options.pk ?? false,
    nullable: options.nullable ?? !options.pk,
    ...(options.note ? { note: options.note } : {}),
  };
}

export function makeTable(
  x: number,
  y: number,
  name = "yeni_tablo",
  columns: TableColumn[] = [makeColumn("id", "bigint", { pk: true })],
  tone: ToneName = "lilac",
): TableItem {
  return centered(
    { id: newId("tb"), kind: "table", name, columns, tone, x: 0, y: 0, width: 300 },
    x,
    y,
  );
}

/** Arrow between two flow points; the box is padded so heads and the hit area fit. */
export function makeArrow(
  from: { x: number; y: number },
  to: { x: number; y: number },
  color: string,
  options: Partial<Pick<ArrowItem, "head" | "dashed">> = {},
): ArrowItem {
  const pad = 16;
  const x = Math.min(from.x, to.x) - pad;
  const y = Math.min(from.y, to.y) - pad;
  const round = (v: number) => Math.round(v * 10) / 10;
  return {
    id: newId("a"),
    kind: "arrow",
    x,
    y,
    width: Math.ceil(Math.abs(to.x - from.x) + pad * 2),
    height: Math.ceil(Math.abs(to.y - from.y) + pad * 2),
    start: [round(from.x - x), round(from.y - y)],
    end: [round(to.x - x), round(to.y - y)],
    head: options.head ?? "end",
    dashed: options.dashed ?? false,
    color,
  };
}

export function makeEdge(
  source: string,
  target: string,
  options: Partial<Pick<EdgeItem, "label" | "style" | "sourceHandle" | "targetHandle">> = {},
): EdgeItem {
  return { id: newId("e"), kind: "edge", source, target, style: "flow", ...options };
}

export function emptyBoard(title: string): BoardDoc {
  return {
    formatVersion,
    id: newId("board"),
    title,
    flowStyle: "pastel",
    connector: "elbow",
    background: "dots",
    items: [],
  };
}
