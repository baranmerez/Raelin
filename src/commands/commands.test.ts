import { describe, expect, it } from "vitest";
import { emptyBoard, makeFlowNode, makeRegion } from "../model/factory";
import { markdownToDoc } from "../model/noteMarkdown";
import type { BoardDoc, FlowNodeItem, NoteItem } from "../model/types";
import { applyOps, CommandError, isDestructive } from "./apply";
import { describeBoard } from "./describe";
import { overlaps, rectOf, regionOf } from "./geometry";
import { layoutBoard } from "./layout";

function boardWithStep(): { board: BoardDoc; stepId: string } {
  const board = emptyBoard("Test");
  const step = makeFlowNode("terminal", 0, 0, "Başla");
  board.items = [step];
  return { board, stepId: step.id };
}

describe("applyOps", () => {
  it("builds a chain in one batch using refs, placing each step below the last", () => {
    const { board, stepId } = boardWithStep();
    const result = applyOps(board, [
      { op: "add", ref: "a", kind: "flowNode", text: "Kontrol et", place: { after: stepId } },
      { op: "add", ref: "b", kind: "flowNode", shape: "decision", text: "Uygun mu?" },
      { op: "connect", from: stepId, to: "a" },
      { op: "connect", from: "a", to: "b", label: "sonra" },
    ]);
    expect(Object.keys(result.refs)).toEqual(["a", "b"]);
    expect(result.created).toHaveLength(4);
    const byId = new Map(result.board.items.map((i) => [i.id, i]));
    const start = byId.get(stepId) as FlowNodeItem;
    const a = byId.get(result.refs.a) as FlowNodeItem;
    const b = byId.get(result.refs.b) as FlowNodeItem;
    expect(a.y).toBeGreaterThan(start.y + start.height);
    expect(b.y).toBeGreaterThan(a.y + a.height);
    expect(overlaps(rectOf(a), rectOf(b), 0)).toBe(false);
  });

  it("is atomic: one bad op leaves the board untouched", () => {
    const { board } = boardWithStep();
    const before = JSON.stringify(board);
    expect(() =>
      applyOps(board, [
        { op: "add", ref: "x", kind: "flowNode", text: "Yeni" },
        { op: "connect", from: "x", to: "n-missing" },
      ]),
    ).toThrow(CommandError);
    expect(JSON.stringify(board)).toBe(before);
  });

  it("writes note bodies from Markdown and updates them", () => {
    const { board } = boardWithStep();
    const added = applyOps(board, [
      {
        op: "add",
        ref: "n",
        kind: "note",
        title: "Kararlar",
        markdown: "- **Önce** basit\n- Sonra hızlı",
      },
    ]);
    const note = added.board.items.find((i) => i.id === added.refs.n) as NoteItem;
    expect(note.content.content?.[0].type).toBe("bulletList");
    const updated = applyOps(added.board, [
      { op: "update", id: note.id, markdown: "Tek paragraf" },
    ]);
    const after = updated.board.items.find((i) => i.id === note.id) as NoteItem;
    expect(after.content.content?.[0].type).toBe("paragraph");
    expect(updated.changed).toEqual([note.id]);
  });

  it("removes connected edges with a deleted node and flags the batch as destructive", () => {
    const { board, stepId } = boardWithStep();
    const built = applyOps(board, [
      { op: "add", ref: "a", kind: "flowNode", text: "A" },
      { op: "connect", ref: "e", from: stepId, to: "a" },
    ]);
    const ops = [{ op: "delete" as const, ids: [built.refs.a] }];
    expect(isDestructive(ops)).toBe(true);
    const result = applyOps(built.board, ops);
    expect(result.removed.sort()).toEqual([built.refs.a, built.refs.e].sort());
    expect(result.board.items.some((i) => i.kind === "edge")).toBe(false);
  });

  it("does not create duplicate edges", () => {
    const { board, stepId } = boardWithStep();
    const built = applyOps(board, [
      { op: "add", ref: "a", kind: "flowNode", text: "A" },
      { op: "connect", from: stepId, to: "a" },
    ]);
    const again = applyOps(built.board, [{ op: "connect", from: stepId, to: built.refs.a }]);
    expect(again.created).toHaveLength(0);
    expect(again.warnings).toHaveLength(1);
  });
});

describe("regions", () => {
  it("grows a region so a chain built inside it never spills out", () => {
    const board = emptyBoard("Akış");
    const built = applyOps(board, [
      { op: "add", ref: "r", kind: "region", title: "Süreç" },
      { op: "add", ref: "a", kind: "flowNode", text: "A", place: { in: "r" } },
      { op: "add", ref: "b", kind: "flowNode", text: "B" },
      { op: "add", ref: "c", kind: "flowNode", text: "C" },
      { op: "add", ref: "d", kind: "flowNode", text: "D" },
      { op: "add", ref: "e", kind: "flowNode", text: "E" },
    ]);
    const region = built.board.items.find((i) => i.id === built.refs.r);
    for (const ref of ["a", "b", "c", "d", "e"]) {
      const node = built.board.items.find((i) => i.id === built.refs[ref]) as FlowNodeItem;
      expect(region && region.kind === "region" && regionOf(built.board, node)?.id).toBe(
        region?.id,
      );
    }
  });
});

describe("layoutBoard", () => {
  it("is deterministic and grows the region to fit", () => {
    const board = emptyBoard("Akış");
    const region = { ...makeRegion(0, 0, "Bölge"), x: 0, y: 0, width: 300, height: 200 };
    board.items = [region];
    const built = applyOps(board, [
      { op: "add", ref: "a", kind: "flowNode", text: "A", place: { in: region.id } },
      { op: "add", ref: "b", kind: "flowNode", text: "B", place: { in: region.id } },
      { op: "add", ref: "c", kind: "flowNode", text: "C", place: { in: region.id } },
      { op: "connect", from: "a", to: "b" },
      { op: "connect", from: "b", to: "c" },
    ]);
    const first = layoutBoard(built.board, { regionId: region.id });
    const second = layoutBoard(built.board, { regionId: region.id });
    expect(JSON.stringify(first.board)).toBe(JSON.stringify(second.board));
    const grown = first.board.items.find((i) => i.id === region.id);
    expect(grown && "height" in grown && grown.height).toBeGreaterThan(200);
    const [a, b, c] = ["a", "b", "c"].map(
      (r) => first.board.items.find((i) => i.id === built.refs[r]) as FlowNodeItem,
    );
    expect(a.y).toBeLessThan(b.y);
    expect(b.y).toBeLessThan(c.y);
  });
});

describe("describeBoard", () => {
  it("returns compact items without geometry, clips text and pages", () => {
    const board = emptyBoard("Büyük");
    board.items = Array.from({ length: 5 }, (_, i) =>
      makeFlowNode("process", 0, i * 100, `Adım ${i} ${"x".repeat(50)}`),
    );
    const page = describeBoard(board, 3, { limit: 2, textLimit: 20 });
    expect(page.items).toHaveLength(2);
    expect(page.nextCursor).toBe(2);
    expect(JSON.stringify(page)).not.toContain('"geo"');
    expect((page.items[0] as { text: string }).text).toContain("…[+");
  });
});

describe("markdownToDoc", () => {
  it("never produces empty text nodes", () => {
    const doc = markdownToDoc("# Başlık\n\n- \n**kalın** ve _eğik_");
    expect(JSON.stringify(doc)).not.toContain('"text":""');
    expect(doc.content?.[0].type).toBe("heading");
  });
});
