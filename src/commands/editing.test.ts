import { beforeEach, describe, expect, it } from "vitest";
import { cloneItems, withInnerEdges } from "../model/clone";
import { emptyBoard, makeEdge, makeFlowNode, makeRegion } from "../model/factory";
import type { BoardDoc, FlowNodeItem, Workspace } from "../model/types";
import { formatVersion } from "../model/types";
import { useBoardStore } from "../state/boardStore";
import { alignItems } from "./align";
import { contentsOf, strokesAt } from "./geometry";

function boardOf(...items: BoardDoc["items"]): BoardDoc {
  return { ...emptyBoard("Test"), items };
}

const node = (board: BoardDoc, id: string) => board.items.find((i) => i.id === id) as FlowNodeItem;

describe("alignItems", () => {
  const a = { ...makeFlowNode("process", 0, 0), x: 0, y: 0 };
  const b = { ...makeFlowNode("process", 0, 0), x: 100, y: 50 };
  const c = { ...makeFlowNode("process", 0, 0), x: 900, y: 300 };
  const board = boardOf(a, b, c);
  const ids = new Set([a.id, b.id, c.id]);

  it("aligns left and bottom edges", () => {
    const left = alignItems(board, ids, "left");
    expect([a, b, c].map((n) => node(left, n.id).x)).toEqual([0, 0, 0]);
    const bottom = alignItems(board, ids, "bottom");
    expect(node(bottom, a.id).y + a.height).toBe(300 + c.height);
  });

  it("spaces the middle item evenly and keeps the outer two", () => {
    const spaced = alignItems(board, ids, "distributeH");
    const gap1 = node(spaced, b.id).x - (a.x + a.width);
    const gap2 = c.x - (node(spaced, b.id).x + b.width);
    expect(gap1).toBe(gap2);
    expect(node(spaced, a.id).x).toBe(0);
    expect(node(spaced, c.id).x).toBe(900);
  });

  it("does nothing for too few items", () => {
    expect(alignItems(board, new Set([a.id]), "left")).toBe(board);
    expect(alignItems(board, new Set([a.id, b.id]), "distributeV")).toBe(board);
  });
});

describe("cloneItems", () => {
  it("gives fresh ids and keeps only edges between copied nodes", () => {
    const a = makeFlowNode("process", 0, 0);
    const b = makeFlowNode("process", 0, 200);
    const outside = makeFlowNode("process", 500, 0);
    const inner = makeEdge(a.id, b.id, { label: "evet" });
    const dangling = makeEdge(a.id, outside.id);
    const copies = cloneItems(
      withInnerEdges([a, b, outside, inner, dangling], new Set([a.id, b.id])),
      32,
      32,
    );
    expect(copies).toHaveLength(3);
    const ids = new Set(copies.map((i) => i.id));
    expect(ids.has(a.id) || ids.has(b.id)).toBe(false);
    const edge = copies.find((i) => i.kind === "edge");
    expect(edge && edge.kind === "edge" && ids.has(edge.source) && ids.has(edge.target)).toBe(true);
    expect(edge?.kind === "edge" && edge.label).toBe("evet");
    expect(copies.find((i) => i.kind === "flowNode")?.id.startsWith("n-")).toBe(true);
  });
});

describe("contentsOf", () => {
  it("finds items whose centre lies in the region", () => {
    const region = { ...makeRegion(0, 0), x: 0, y: 0, width: 400, height: 300 };
    const inside = { ...makeFlowNode("process", 200, 150) };
    const outside = { ...makeFlowNode("process", 900, 150) };
    const board = boardOf(region, inside, outside);
    expect([...contentsOf(board, new Set([region.id]))]).toEqual([inside.id]);
  });
});

describe("board management", () => {
  beforeEach(() => {
    const one = { ...emptyBoard("Bir"), items: [makeFlowNode("process", 0, 0)] };
    const two = emptyBoard("İki");
    const workspace: Workspace = {
      manifest: {
        formatVersion,
        title: "Deneme",
        boards: [
          { id: one.id, title: one.title },
          { id: two.id, title: two.title },
        ],
      },
      boards: { [one.id]: one, [two.id]: two },
    };
    useBoardStore.getState().loadWorkspace(workspace, null, true);
    useBoardStore.getState().selectBoard(one.id);
  });

  const state = () => useBoardStore.getState();
  const ids = () => state().workspace.manifest.boards.map((b) => b.id);

  it("renames as an undoable step", () => {
    const id = state().activeBoardId;
    state().renameBoard(id, "  Yeni ad  ");
    expect(state().workspace.boards[id].title).toBe("Yeni ad");
    state().undo();
    expect(state().workspace.boards[id].title).toBe("Bir");
  });

  it("duplicates next to the original with fresh item ids", () => {
    const [first] = ids();
    state().duplicateBoard(first);
    const [, copyId] = ids();
    const copy = state().workspace.boards[copyId];
    expect(copy.title).toBe("Bir (kopya)");
    expect(state().activeBoardId).toBe(copyId);
    expect(copy.items[0].id).not.toBe(state().workspace.boards[first].items[0].id);
  });

  it("deletes, moves to a neighbour and restores in place", () => {
    const [first, second] = ids();
    const removed = state().deleteBoard(first);
    expect(ids()).toEqual([second]);
    expect(state().activeBoardId).toBe(second);
    expect(state().deleteBoard(second)).toBeNull();
    if (removed) state().restoreBoard(removed);
    expect(ids()).toEqual([first, second]);
    expect(state().workspace.boards[first].items).toHaveLength(1);
  });
});

describe("strokesAt", () => {
  it("hits a stroke near its line but not inside its empty box", () => {
    const stroke = {
      id: "s-1",
      kind: "stroke" as const,
      color: "#000",
      size: 4,
      x: 100,
      y: 100,
      width: 200,
      height: 200,
      points: [
        [0, 0, 0.5],
        [200, 0, 0.5],
      ] as [number, number, number][],
    };
    const board = boardOf(stroke);
    expect(strokesAt(board, 150, 105, 8).has("s-1")).toBe(true);
    expect(strokesAt(board, 150, 250, 8).size).toBe(0);
  });
});
