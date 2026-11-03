import { beforeEach, describe, expect, it } from "vitest";
import { emptyBoard, makeFlowNode } from "../model/factory";
import type { FlowNodeItem, Workspace } from "../model/types";
import { patchItem, useBoardStore } from "./boardStore";

function setup(): { nodeId: string } {
  const board = emptyBoard("Test");
  const node = makeFlowNode("process", 0, 0, "A");
  board.items = [node];
  const workspace: Workspace = {
    manifest: { formatVersion: 1, title: "T", boards: [{ id: board.id, title: board.title }] },
    boards: { [board.id]: board },
  };
  useBoardStore.getState().loadWorkspace(workspace, null, true);
  return { nodeId: node.id };
}

const nodeX = (id: string) => {
  const s = useBoardStore.getState();
  return (s.workspace.boards[s.activeBoardId].items.find((i) => i.id === id) as FlowNodeItem).x;
};

const moveTo = (id: string, x: number) => (b: Parameters<typeof patchItem>[0]) =>
  patchItem<FlowNodeItem>(b, id, { x });

describe("board history", () => {
  let nodeId = "";
  beforeEach(() => {
    nodeId = setup().nodeId;
  });

  it("undoes a whole gesture as one step", () => {
    const s = useBoardStore.getState();
    const start = nodeX(nodeId);
    s.beginGesture();
    s.live(moveTo(nodeId, start + 10));
    s.live(moveTo(nodeId, start + 20));
    s.endGesture();
    s.undo();
    expect(nodeX(nodeId)).toBe(start);
  });

  it("gives a live change without a gesture its own step and clears redo", () => {
    const s = useBoardStore.getState();
    const start = nodeX(nodeId);
    s.commit(moveTo(nodeId, start + 5));
    s.undo();
    // Arrow-key nudge: React Flow emits a position change with no drag start.
    s.live(moveTo(nodeId, start + 1));
    expect(
      useBoardStore.getState().history[useBoardStore.getState().activeBoardId].future,
    ).toHaveLength(0);
    s.undo();
    expect(nodeX(nodeId)).toBe(start);
  });

  it("splits a gesture at a commit so both parts undo separately", () => {
    const s = useBoardStore.getState();
    const start = nodeX(nodeId);
    s.beginGesture();
    s.live(moveTo(nodeId, start + 10));
    s.commit(moveTo(nodeId, start + 20));
    s.live(moveTo(nodeId, start + 30));
    s.endGesture();
    s.undo();
    expect(nodeX(nodeId)).toBe(start + 20);
    s.undo();
    expect(nodeX(nodeId)).toBe(start + 10);
  });

  it("tracks unsaved edits against the saved workspace", () => {
    const s = useBoardStore.getState();
    expect(s.workspace).toBe(s.savedWorkspace);
    s.commit(moveTo(nodeId, 99));
    const after = useBoardStore.getState();
    expect(after.workspace).not.toBe(after.savedWorkspace);
    after.markSaved({ path: "C:\\example\\example.raelin", stamp: "1:1" }, after.workspace);
    const saved = useBoardStore.getState();
    expect(saved.workspace).toBe(saved.savedWorkspace);
  });
});
