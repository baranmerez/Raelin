import type { JSONContent } from "@tiptap/react";

export const formatVersion = 1;

export type ToneName = "lilac" | "peach" | "periwinkle" | "sage" | "butter" | "paper";
export type FlowShape = "terminal" | "process" | "decision";
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

export type NodeItem = FlowNodeItem | NoteItem | RegionItem | StrokeItem;
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
