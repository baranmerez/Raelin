import { describe, expect, it } from "vitest";
import { emptyBoard, makeEdge, makeFlowNode, makeNote } from "../model/factory";
import { FormatError, validateItems } from "../model/serialize";
import type { BoardDoc, NoteItem, Workspace } from "../model/types";
import { formatVersion } from "../model/types";
import { useBoardStore } from "../state/boardStore";
import { copyItems } from "./copy";
import { findReplace } from "./findReplace";

describe("review regressions (waves 1-3)", () => {
  it("drops text nodes that a replacement empties instead of keeping them", () => {
    const note: NoteItem = {
      ...makeNote(0, 0, "Not"),
      content: {
        type: "doc",
        content: [
          {
            type: "paragraph",
            content: [
              { type: "text", text: "draft", marks: [{ type: "bold" }] },
              { type: "text", text: " plan" },
            ],
          },
        ],
      },
    };
    const result = findReplace(
      { ...emptyBoard("Test"), items: [note] },
      { find: "draft", replace: "" },
    );
    const paragraph = (result.board.items[0] as NoteItem).content.content?.[0];
    expect(paragraph?.content).toEqual([{ type: "text", text: " plan" }]);
    // A file that still carries an empty text node is refused at load.
    const broken = {
      ...note,
      content: {
        type: "doc",
        content: [{ type: "paragraph", content: [{ type: "text", text: "" }] }],
      },
    };
    expect(() => validateItems([broken])).toThrow(FormatError);
  });

  it("copies a node even when the ids also name an edge whose ends stay behind", () => {
    const a = makeFlowNode("process", 0, 0);
    const b = makeFlowNode("process", 0, 200);
    const c = makeFlowNode("process", 0, 400);
    const bc = makeEdge(b.id, c.id);
    const source = { ...emptyBoard("Kaynak"), items: [a, b, c, bc] };
    const result = copyItems(source, emptyBoard("Hedef"), [a.id, bc.id]);
    expect(result.copied).toEqual([a.id]);
    expect(Object.keys(result.ids)).toEqual([a.id]);
    expect(result.board.items).toHaveLength(1);
  });

  it("undoes and redoes a change spread over two boards as one action", () => {
    const one = { ...emptyBoard("Bir"), items: [makeFlowNode("process", 0, 0)] };
    const two = emptyBoard("İki");
    const workspace: Workspace = {
      manifest: {
        formatVersion,
        title: "Deneme",
        boards: [one, two].map((b) => ({ id: b.id, title: b.title })),
      },
      boards: { [one.id]: one, [two.id]: two },
    };
    const s = () => useBoardStore.getState();
    s().loadWorkspace(workspace, null, true);
    s().selectBoard(two.id);
    const moved = one.items[0];
    const nextOne: BoardDoc = { ...one, items: [] };
    const nextTwo: BoardDoc = { ...two, items: [{ ...moved, id: "n-copy" }] };
    s().commitTo(one.id, nextOne, "AI: taşıdı", "g-1");
    s().commitTo(two.id, nextTwo, "AI: taşıdı", "g-1");
    // Ctrl+Z on the target board brings the source back too.
    s().undo();
    expect(s().workspace.boards[one.id].items).toHaveLength(1);
    expect(s().workspace.boards[two.id].items).toHaveLength(0);
    s().redo();
    expect(s().workspace.boards[one.id].items).toHaveLength(0);
    expect(s().workspace.boards[two.id].items).toHaveLength(1);
  });
});
