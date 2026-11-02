import { newId } from "./ids";
import type {
  BoardDoc,
  EdgeItem,
  FlowNodeItem,
  FlowShape,
  NoteItem,
  RegionItem,
  ToneName,
} from "./types";
import { formatVersion } from "./types";

export const shapeSize: Record<FlowShape, { width: number; height: number }> = {
  terminal: { width: 220, height: 64 },
  process: { width: 240, height: 68 },
  decision: { width: 176, height: 148 },
};

const shapeTone: Record<FlowShape, ToneName> = {
  terminal: "sage",
  process: "periwinkle",
  decision: "peach",
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
    text: text ?? (shape === "decision" ? "Karar?" : shape === "terminal" ? "Başla" : "Yeni adım"),
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
