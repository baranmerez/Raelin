import { describe, expect, it } from "vitest";
import { emptyBoard, makeChecklist, makeFlowNode, makeLink, makeTable } from "../model/factory";
import type {
  BoardDoc,
  ChecklistItem,
  LinkItem,
  NodeItem,
  TableItem,
  TextItem,
} from "../model/types";
import { isNodeItem } from "../model/types";
import { applyOps, CommandError } from "./apply";
import { describeBoard, searchWorkspace } from "./describe";
import { findReplace } from "./findReplace";
import { opSchema } from "./schema";
import { placeTemplate } from "./template";

const find = <T>(board: BoardDoc, id: string) => board.items.find((i) => i.id === id) as T;

describe("apply_changes with card kinds", () => {
  it("adds and updates a table, keeping column ids by name", () => {
    const added = applyOps(emptyBoard("ER"), [
      {
        op: "add",
        ref: "o",
        kind: "table",
        title: "orders",
        columns: [
          { name: "order_id", type: "bigint", pk: true },
          { name: "created_at", type: "timestamptz" },
        ],
      },
      { op: "add", ref: "c", kind: "table", title: "customers" },
      { op: "connect", from: "o", to: "c", style: "reference", label: "customer_id" },
    ]);
    const table = find<TableItem>(added.board, added.refs.o);
    expect(table.columns.map((c) => [c.name, c.pk, c.nullable])).toEqual([
      ["order_id", true, false],
      ["created_at", false, true],
    ]);

    const updated = applyOps(added.board, [
      {
        op: "update",
        id: table.id,
        title: "sales_orders",
        columns: [
          { name: "order_id", type: "bigint", pk: true },
          { name: "customer_id", type: "bigint", nullable: false },
        ],
      },
    ]);
    const next = find<TableItem>(updated.board, table.id);
    expect(next.name).toBe("sales_orders");
    expect(next.columns[0].id).toBe(table.columns[0].id);
    expect(next.columns[1].id).not.toBe(table.columns[1].id);
    expect(updated.changed).toEqual([table.id]);
  });

  it("adds a checklist and replaces its entries in one update", () => {
    const added = applyOps(emptyBoard("L"), [
      { op: "add", ref: "k", kind: "checklist", title: "Yayın", items: [{ text: "Test" }] },
    ]);
    const list = find<ChecklistItem>(added.board, added.refs.k);
    expect(list.items).toHaveLength(1);
    expect(list.items[0].done).toBe(false);

    const updated = applyOps(added.board, [
      {
        op: "update",
        id: list.id,
        items: [{ text: "Test", done: true }, { text: "Duyur" }],
        tone: "peach",
      },
    ]);
    const next = find<ChecklistItem>(updated.board, list.id);
    expect(next.items.map((e) => [e.text, e.done])).toEqual([
      ["Test", true],
      ["Duyur", false],
    ]);
    expect(next.items[0].id).toBe(list.items[0].id);
    expect(next.tone).toBe("peach");

    const read = describeBoard(updated.board, 1);
    expect(read.items[0]).toMatchObject({
      kind: "checklist",
      items: [{ text: "Test", done: true }, { text: "Duyur" }],
    });
  });

  it("adds text and links, refuses non-http links, and warns about unused fields", () => {
    const result = applyOps(emptyBoard("T"), [
      { op: "add", ref: "t", kind: "text", text: "Başlık", size: "l", url: "https://x.test" },
      { op: "add", ref: "u", kind: "link", url: "https://example.com", title: "Örnek" },
    ]);
    expect(find<TextItem>(result.board, result.refs.t).size).toBe("l");
    expect(find<LinkItem>(result.board, result.refs.u).url).toBe("https://example.com");
    expect(result.warnings.some((w) => w.includes("url"))).toBe(true);
    expect(
      searchWorkspace(
        {
          manifest: { formatVersion: 1, title: "W", boards: [{ id: result.board.id, title: "T" }] },
          boards: { [result.board.id]: result.board },
        },
        "example.com",
      ).hits,
    ).toHaveLength(1);

    expect(() =>
      applyOps(result.board, [{ op: "update", id: result.refs.u, url: "javascript:alert(1)" }]),
    ).toThrow(CommandError);
    expect(() => applyOps(result.board, [{ op: "add", kind: "link" }])).toThrow(CommandError);
  });

  it("schema accepts the card fields and rejects extra keys in rows", () => {
    expect(
      opSchema.safeParse({ op: "add", kind: "table", columns: [{ name: "id", type: "int" }] })
        .success,
    ).toBe(true);
    expect(
      opSchema.safeParse({
        op: "add",
        kind: "checklist",
        items: [{ text: "x", done: false, id: "c-1" }],
      }).success,
    ).toBe(false);
    expect(opSchema.safeParse({ op: "add", kind: "arrow" }).success).toBe(false);
  });
});

describe("integration of the new kinds with board tools", () => {
  it("places a template right of the content as valid, fresh items", () => {
    const board = { ...emptyBoard("Test"), items: [makeFlowNode("process", 0, 0)] };
    const { board: next, created } = placeTemplate(board, "kanban");
    expect(created.length).toBeGreaterThan(3);
    expect(new Set(next.items.map((i) => i.id)).size).toBe(next.items.length);
    const added = next.items.filter((i) => created.includes(i.id) && isNodeItem(i)) as NodeItem[];
    expect(Math.min(...added.map((i) => i.x))).toBeGreaterThan(board.items[0].x as number);
  });

  it("find_replace reaches checklist entries, link notes and table columns", () => {
    const checklist = {
      ...makeChecklist(0, 0),
      title: "Plan",
      items: [{ id: "c1", text: "order_id ekle", done: false }],
    };
    const link = { ...makeLink(0, 300), note: "order_id açıklaması" };
    const table = makeTable(0, 600);
    const withColumn = {
      ...table,
      columns: [{ id: "k1", name: "order_id", type: "int", pk: true, nullable: false }],
    };
    const board = { ...emptyBoard("Test"), items: [checklist, link, withColumn] };
    const result = findReplace(board, { find: "order_id", replace: "invoice_id" });
    expect(result.changed.sort()).toEqual([checklist.id, link.id, withColumn.id].sort());
    expect(JSON.stringify(result.board)).not.toContain("order_id");
  });
});
