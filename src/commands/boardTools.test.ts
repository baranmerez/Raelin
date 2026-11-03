import { describe, expect, it } from "vitest";
import { emptyBoard, makeEdge, makeFlowNode, makeNote, makeRegion } from "../model/factory";
import { markdownToDoc } from "../model/noteMarkdown";
import type { BoardDoc, EdgeItem, FlowNodeItem, NoteItem, RegionItem } from "../model/types";
import { isNodeItem } from "../model/types";
import { CommandError } from "./apply";
import { copyItems } from "./copy";
import { findReplace } from "./findReplace";
import { contains, overlaps, rectOf } from "./geometry";
import { recentChanges } from "./history";

function sourceBoard() {
  const board = emptyBoard("Kaynak");
  const region = makeRegion(0, 0, "Sipariş akışı", "sage");
  const a = makeFlowNode("process", region.x + 200, region.y + 160, "Siparişi al");
  const b = makeFlowNode("process", region.x + 200, region.y + 320, "Kargola");
  const outside = makeFlowNode("terminal", 2000, 0, "Dışarıda");
  const inner = makeEdge(a.id, b.id, { style: "flow" });
  const leaving = makeEdge(b.id, outside.id, { style: "flow" });
  board.items = [region, a, b, outside, inner, leaving];
  return { board, region, a, b, outside, inner, leaving };
}

describe("copyItems", () => {
  it("copies a region with its contents and inner edges under fresh ids", () => {
    const { board, region, a, b, outside, inner } = sourceBoard();
    const target = emptyBoard("Hedef");
    const result = copyItems(board, target, [region.id]);
    expect(new Set(result.copied)).toEqual(new Set([region.id, a.id, b.id, inner.id]));
    expect(Object.keys(result.ids)).toHaveLength(4);
    const copies = result.board.items;
    expect(copies).toHaveLength(4);
    const sourceIds = new Set(board.items.map((i) => i.id));
    for (const item of copies) expect(sourceIds.has(item.id)).toBe(false);
    const edge = copies.find((i) => i.kind === "edge") as EdgeItem;
    expect(edge.source).toBe(result.ids[a.id]);
    expect(edge.target).toBe(result.ids[b.id]);
    expect(copies.some((i) => i.id === result.ids[outside.id])).toBe(false);
    // The source board is not touched.
    expect(board.items).toHaveLength(6);
  });

  it("drops edges whose other end is not copied", () => {
    const { board, b, outside } = sourceBoard();
    const result = copyItems(board, emptyBoard("Hedef"), [b.id]);
    expect(result.board.items.filter((i) => i.kind === "edge")).toHaveLength(0);
    expect(result.ids[outside.id]).toBeUndefined();
  });

  it("places the group to the right of the target content without overlaps", () => {
    const { board, a, b } = sourceBoard();
    const target = emptyBoard("Hedef");
    const existing = makeFlowNode("process", 0, 0, "Var olan");
    target.items = [existing];
    const result = copyItems(board, target, [a.id, b.id]);
    const copies = result.board.items.filter(isNodeItem).filter((i) => i.id !== existing.id);
    for (const copy of copies) {
      expect(copy.x).toBeGreaterThan(existing.x + existing.width);
      expect(overlaps(rectOf(copy), rectOf(existing), 0)).toBe(false);
    }
    // The group keeps its own layout.
    const [ca, cb] = [result.ids[a.id], result.ids[b.id]].map(
      (id) => copies.find((c) => c.id === id) as FlowNodeItem,
    );
    expect(cb.y - ca.y).toBe(b.y - a.y);
  });

  it("puts the group inside a target region and grows the region", () => {
    const { board, a, b } = sourceBoard();
    const target = emptyBoard("Hedef");
    const host = makeRegion(0, 0, "Yeni bölge", "lilac");
    target.items = [{ ...host, width: 200, height: 160 }];
    const result = copyItems(board, target, [a.id, b.id], { in: host.id });
    const region = result.board.items.find((i) => i.id === host.id) as RegionItem;
    for (const id of [result.ids[a.id], result.ids[b.id]]) {
      const copy = result.board.items.find((i) => i.id === id) as FlowNodeItem;
      expect(contains(region, copy)).toBe(true);
    }
  });

  it("rejects unknown ids", () => {
    const { board } = sourceBoard();
    expect(() => copyItems(board, emptyBoard("Hedef"), ["n-missing"])).toThrow(CommandError);
  });
});

function textBoard(): BoardDoc {
  const board = emptyBoard("Metin");
  const step = makeFlowNode("process", 0, 0, "Fatura kes, fatura gönder");
  const note = makeNote(400, 0, "Fatura notu");
  note.content = markdownToDoc("Önce **fatura** hazırlanır.\n\n- İkinci FATURA");
  const region = makeRegion(0, 400, "Fatura bölgesi", "peach");
  const other = makeFlowNode("process", 0, 200, "Kargola");
  const edge = makeEdge(step.id, other.id, { style: "flow", label: "fatura sonrası" });
  board.items = [step, note, region, other, edge];
  return board;
}

describe("findReplace", () => {
  it("replaces case-insensitively across kinds, keeping note marks", () => {
    const board = textBoard();
    const result = findReplace(board, { find: "fatura", replace: "makbuz" });
    expect(result.total).toBe(7);
    expect(result.changed).toHaveLength(4);
    const items = result.board.items;
    const step = items.find((i) => i.kind === "flowNode" && i.text.includes("makbuz"));
    expect((step as FlowNodeItem).text).toBe("makbuz kes, makbuz gönder");
    const note = items.find((i) => i.kind === "note") as NoteItem;
    expect(note.title).toBe("makbuz notu");
    const json = JSON.stringify(note.content);
    expect(json).not.toMatch(/fatura/i);
    const bold = JSON.stringify(note.content).match(/"text":"makbuz","marks":\[\{"type":"bold"/);
    expect(bold).not.toBeNull();
    expect((items.find((i) => i.kind === "edge") as EdgeItem).label).toBe("makbuz sonrası");
    // Pure: the input board is unchanged.
    expect(JSON.stringify(board)).toContain("Fatura kes");
  });

  it("respects caseSensitive", () => {
    const result = findReplace(textBoard(), { find: "FATURA", replace: "x", caseSensitive: true });
    expect(result.total).toBe(1);
    expect(result.matches).toEqual([expect.objectContaining({ kind: "note", field: "body" })]);
  });

  it("reports matches with previews and leaves an unmatched board as is", () => {
    const board = textBoard();
    const result = findReplace(board, { find: "kes", replace: "yaz" });
    expect(result.matches).toEqual([
      expect.objectContaining({ field: "text", before: "Fatura kes, fatura gönder" }),
    ]);
    expect(result.matches[0].after).toBe("Fatura yaz, fatura gönder");
    expect(findReplace(board, { find: "yok böyle", replace: "x" }).board).toBe(board);
  });

  it("treats the search text literally", () => {
    const board = emptyBoard("Desen");
    board.items = [makeFlowNode("process", 0, 0, "a.b ve a+b")];
    const result = findReplace(board, { find: "a.b", replace: "$&!" });
    expect((result.board.items[0] as FlowNodeItem).text).toBe("$&! ve a+b");
  });
});

describe("recentChanges", () => {
  it("diffs each step with the next state, newest first", () => {
    const b0 = emptyBoard("Pano");
    const a = makeFlowNode("process", 0, 0, "A");
    const b1 = { ...b0, items: [a] };
    const b2 = { ...b1, items: [{ ...a, text: "A2" }, makeFlowNode("process", 0, 200, "B")] };
    const b3 = { ...b2, title: "Yeni ad", items: [b2.items[1]] };
    const past = [
      { board: b0, at: 1000 },
      { board: b1, label: "Claude Code: 2 değişiklik yaptı", at: 2000 },
      { board: b2, at: 3000 },
    ];
    const changes = recentChanges(past, b3);
    expect(changes.map((c) => c.label)).toEqual([
      "kullanıcı",
      "Claude Code: 2 değişiklik yaptı",
      "kullanıcı",
    ]);
    expect(changes[0]).toMatchObject({ added: 0, removed: 1, changed: 0, board: true });
    expect(changes[1]).toMatchObject({ added: 1, removed: 0, changed: 1 });
    expect(changes[2]).toMatchObject({ added: 1, removed: 0, changed: 0 });
    expect(changes[2].at).toBe(new Date(1000).toISOString());
    expect(recentChanges(past, b3, 1)).toHaveLength(1);
  });
});
