import type { JSONContent } from "@tiptap/react";

export const formatVersion = 1;

export type ToneName = "lilac" | "peach" | "periwinkle" | "sage" | "butter" | "paper";
export type FlowShape =
  | "terminal"
  | "process"
  | "decision"
  | "ellipse"
  | "database"
  | "document"
  | "io"
  | "cloud"
  | "actor";
export type TextSize = "s" | "m" | "l";
export type ArrowHead = "end" | "both" | "none";
export type FlowStyle = "pastel" | "line" | "flat";
export type ConnectorType = "elbow" | "curve" | "straight";
export type BackgroundKind = "dots" | "grid" | "plain";

interface PlacedItem {
  id: string;
  x: number;
  y: number;
}

export interface FlowNodeItem extends PlacedItem {
  kind: "flowNode";
  shape: FlowShape;
  text: string;
  tone: ToneName;
  width: number;
  height: number;
}

export interface NoteItem extends PlacedItem {
  kind: "note";
  title: string;
  content: JSONContent;
  tone: ToneName;
  width: number;
}

export interface RegionItem extends PlacedItem {
  kind: "region";
  title: string;
  tone: ToneName;
  width: number;
  height: number;
}

/** Pen stroke; points are [x, y, pressure] relative to the item's x/y. */
export interface StrokeItem extends PlacedItem {
  kind: "stroke";
  points: [number, number, number][];
  color: string;
  size: number;
  width: number;
  height: number;
}

/**
 * Pasted or dropped picture. The board only names it; the bytes are stored once per
 * workspace file under `assets[<src>]`, so the same picture is never duplicated.
 */
export interface ImageItem extends PlacedItem {
  kind: "image";
  src: string;
  alt: string;
  width: number;
  height: number;
}

/** Borderless label; the tone only colors the ink. Height follows the text. */
export interface TextItem extends PlacedItem {
  kind: "text";
  text: string;
  size: TextSize;
  tone: ToneName;
  width: number;
}

/** Free arrow or line; start/end are relative to the item's x/y, inside width/height. */
export interface ArrowItem extends PlacedItem {
  kind: "arrow";
  start: [number, number];
  end: [number, number];
  head: ArrowHead;
  dashed: boolean;
  color: string;
  width: number;
  height: number;
}

export interface CheckEntry {
  id: string;
  text: string;
  done: boolean;
}

/** Card with tickable entries; height follows the list. */
export interface ChecklistItem extends PlacedItem {
  kind: "checklist";
  title: string;
  items: CheckEntry[];
  tone: ToneName;
  width: number;
}

/** Web link card; the url is always http(s). */
export interface LinkItem extends PlacedItem {
  kind: "link";
  url: string;
  title: string;
  note: string;
  tone: ToneName;
  width: number;
}

export interface TableColumn {
  id: string;
  name: string;
  type: string;
  pk: boolean;
  nullable: boolean;
  note?: string;
}

/** Database table card (ER design); relations are ordinary edges between tables. */
export interface TableItem extends PlacedItem {
  kind: "table";
  name: string;
  columns: TableColumn[];
  tone: ToneName;
  width: number;
}

/**
 * A flow edge is part of the semantic graph. "reference" is a cross-reference
 * (e.g. a step pointing at a sketch) and never implies flow order.
 */
export interface EdgeItem {
  id: string;
  kind: "edge";
  source: string;
  target: string;
  sourceHandle?: string;
  targetHandle?: string;
  label?: string;
  style: "flow" | "reference";
}

export type NodeItem =
  | FlowNodeItem
  | NoteItem
  | RegionItem
  | StrokeItem
  | ImageItem
  | TextItem
  | ArrowItem
  | ChecklistItem
  | LinkItem
  | TableItem;

/** Items whose height follows their content instead of being stored. */
export type CardItem = TextItem | ChecklistItem | LinkItem | TableItem;
export type BoardItem = NodeItem | EdgeItem;

export interface BoardDoc {
  formatVersion: number;
  id: string;
  title: string;
  flowStyle: FlowStyle;
  connector: ConnectorType;
  background: BackgroundKind;
  items: BoardItem[];
}

export interface WorkspaceManifest {
  formatVersion: number;
  title: string;
  boards: { id: string; title: string }[];
}

export interface Workspace {
  manifest: WorkspaceManifest;
  boards: Record<string, BoardDoc>;
}

export function isNodeItem(item: BoardItem): item is NodeItem {
  return item.kind !== "edge";
}

export function isEdgeItem(item: BoardItem): item is EdgeItem {
  return item.kind === "edge";
}
