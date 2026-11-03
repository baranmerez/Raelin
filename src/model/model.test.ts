import { describe, expect, it } from "vitest";
import { emptyBoard, makeEdge, makeFlowNode, makeNote, makeRegion } from "./factory";
import { boardToMarkdown } from "./markdown";
import { seedWorkspace } from "./seed";
import {
  FormatError,
  parseBoard,
  parseWorkspaceFile,
  serializeBoard,
  serializeWorkspaceFile,
} from "./serialize";

describe("serialize", () => {
  it("writes the same text regardless of item order and key order", () => {
    const board = emptyBoard("Test");
    const a = makeFlowNode("process", 0, 0, "A");
    const b = makeFlowNode("process", 0, 100, "B");
    board.items = [a, b, makeEdge(a.id, b.id)];
    const reversed = { ...board, items: [...board.items].reverse() };
    expect(serializeBoard(reversed)).toBe(serializeBoard(board));
    expect(serializeBoard(board).endsWith("\n")).toBe(true);
  });

  it("round-trips the seed workspace as one file", () => {
    const workspace = seedWorkspace();
    const assets = { "img-abc.png": "iVBORw0KGgo=" };
    const text = serializeWorkspaceFile(workspace, assets);
    const parsed = parseWorkspaceFile(text);
    expect(parsed.workspace.manifest).toEqual(workspace.manifest);
    expect(parsed.assets).toEqual(assets);
    // Same workspace, same text: items are sorted by id and keys are sorted.
    expect(serializeWorkspaceFile(parsed.workspace, parsed.assets)).toBe(text);
  });

  it("refuses files that are not Raelin workspaces or carry bad pictures", () => {
    const text = serializeWorkspaceFile(seedWorkspace(), {});
    expect(() => parseWorkspaceFile('{"boards":[]}')).toThrow(FormatError);
    expect(() => parseWorkspaceFile("{ not json")).toThrow(FormatError);
    const withAssets = (assets: Record<string, string>) =>
      JSON.stringify({ ...JSON.parse(text), assets });
    expect(() => parseWorkspaceFile(withAssets({ "../x.png": "AAAA" }))).toThrow(FormatError);
    expect(() => parseWorkspaceFile(withAssets({ "img-a.png": "not base64!" }))).toThrow(
      FormatError,
    );
    const duplicate = JSON.parse(text);
    duplicate.boards.push(duplicate.boards[0]);
    expect(() => parseWorkspaceFile(JSON.stringify(duplicate))).toThrow(FormatError);
  });

  it("rejects an edge that points at a missing item", () => {
    const board = emptyBoard("Test");
    const a = makeFlowNode("process", 0, 0, "A");
    board.items = [a, makeEdge(a.id, "n-missing")];
    expect(() => parseBoard(serializeBoard(board))).toThrow(FormatError);
  });

  it("rejects malformed items before they reach rendering", () => {
    const board = emptyBoard("Test");
    const note = makeNote(0, 0, "Not");
    const text = serializeBoard({ ...board, items: [note] });
    const broken = text.replace('"content"', '"contentX"');
    expect(() => parseBoard(broken)).toThrow(FormatError);
    expect(() => parseBoard("{ not json")).toThrow(FormatError);
  });

  it("rejects an edge whose endpoint is another edge", () => {
    const board = emptyBoard("Test");
    const a = makeFlowNode("process", 0, 0, "A");
    const b = makeFlowNode("process", 0, 100, "B");
    const first = makeEdge(a.id, b.id);
    board.items = [a, b, first, makeEdge(first.id, b.id)];
    expect(() => parseBoard(serializeBoard(board))).toThrow(FormatError);
  });

  it("rejects unsafe board ids", () => {
    const board = { ...emptyBoard("Test"), id: "../outside" };
    expect(() => parseBoard(serializeBoard(board))).toThrow(FormatError);
  });
});

describe("markdown export", () => {
  it("groups by region, orders flow steps and keeps decision labels", () => {
    const board = emptyBoard("Akış");
    const region = { ...makeRegion(0, 0, "Süreç"), x: -500, y: -500, width: 1000, height: 1000 };
    const start = makeFlowNode("terminal", 0, -200, "Başla");
    const check = makeFlowNode("decision", 0, 0, "Uygun mu?");
    const done = makeFlowNode("terminal", 0, 200, "Bitir");
    const note = makeNote(2000, 0, "Kenar notu", ["Birinci", "İkinci"]);
    board.items = [
      region,
      done,
      check,
      start,
      note,
      makeEdge(start.id, check.id),
      makeEdge(check.id, done.id, { label: "Evet" }),
      makeEdge(note.id, start.id, { style: "reference" }),
    ];
    const md = boardToMarkdown(board);
    expect(md).toContain("## Süreç");
    expect(md.indexOf("**Başla**")).toBeLessThan(md.indexOf("**Uygun mu?**"));
    expect(md.indexOf("**Uygun mu?**")).toBeLessThan(md.indexOf("**Bitir**"));
    expect(md).toContain("   - Evet → Bitir");
    expect(md).toContain("## Bölge dışı");
    expect(md).toContain("- Birinci\n- İkinci");
    expect(md).toContain("- Kenar notu ⇢ Başla");
  });

  it("limits the export to the selection", () => {
    const board = emptyBoard("Pano");
    const a = makeFlowNode("process", 0, 0, "Seçili");
    const b = makeFlowNode("process", 0, 100, "Dışarıda");
    board.items = [a, b, makeEdge(a.id, b.id)];
    const md = boardToMarkdown(board, new Set([a.id]));
    expect(md).toContain("Seçili");
    expect(md).not.toContain("Dışarıda");
  });
});
