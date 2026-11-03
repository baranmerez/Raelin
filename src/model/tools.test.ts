import { describe, expect, it } from "vitest";
import { cloneItems } from "./clone";
import {
  emptyBoard,
  makeArrow,
  makeChecklist,
  makeColumn,
  makeEdge,
  makeFlowNode,
  makeLink,
  makeTable,
  makeText,
} from "./factory";
import { boardToMarkdown } from "./markdown";
import { FormatError, parseBoard, serializeBoard, validateItems } from "./serialize";
import { buildTemplate, templateList } from "./templates";
import type { BoardItem } from "./types";
import { isNodeItem } from "./types";

const orders = () =>
  makeTable(0, 0, "orders", [
    makeColumn("order_id", "bigint", { pk: true }),
    makeColumn("customer_id", "bigint", { nullable: false, note: "who | ordered" }),
    makeColumn("created_at", "timestamptz"),
  ]);

/** Same item with one field replaced, typed loosely so malformed values can be tested. */
function broken(item: BoardItem, patch: Record<string, unknown>): BoardItem {
  return { ...item, ...patch } as unknown as BoardItem;
}

describe("new item kinds: validation", () => {
  it("accepts every new kind and round-trips through the board file", () => {
    const board = emptyBoard("Araçlar");
    board.items = [
      makeText(0, 0, "Başlık", "l"),
      makeArrow({ x: 0, y: 0 }, { x: 120, y: 40 }, "#3f5f9e", { head: "both", dashed: true }),
      makeChecklist(0, 200, "Hazırlık", [{ text: "Bir" }, { text: "İki", done: true }]),
      makeLink(400, 0, "https://example.com/docs?a=1", "Belgeler", "okunacak"),
      orders(),
      ...(["ellipse", "database", "document", "io", "cloud", "actor"] as const).map((s) =>
        makeFlowNode(s, 0, 500),
      ),
    ];
    expect(() => validateItems(board.items)).not.toThrow();
    expect(parseBoard(serializeBoard(board)).items).toHaveLength(board.items.length);
  });

  it("rejects links that are not http(s)", () => {
    for (const url of ["javascript:alert(1)", "file:///C:/x", "data:text/html,x", "example.com"]) {
      expect(() => validateItems([broken(makeLink(0, 0), { url })])).toThrow(FormatError);
    }
    expect(() => validateItems([broken(makeLink(0, 0), { url: 42 })])).toThrow(FormatError);
  });

  it("rejects malformed table columns", () => {
    const table = orders();
    const bad = [
      [{ ...table.columns[0], name: 7 }],
      [{ ...table.columns[0], pk: "yes" }],
      [{ ...table.columns[0], extra: true }],
      [table.columns[0], table.columns[0]],
      [{ ...table.columns[0], id: "Not Safe!" }],
      "order_id",
    ];
    for (const columns of bad) {
      expect(() => validateItems([broken(table, { columns })])).toThrow(FormatError);
    }
  });

  it("rejects malformed checklist entries and unknown fields", () => {
    const list = makeChecklist(0, 0);
    const entry = list.items[0];
    for (const items of [
      [{ ...entry, done: 1 }],
      [{ id: entry.id, text: "x" }],
      [{ ...entry, text: null }],
      ["bir madde"],
      Array.from({ length: 201 }, (_, i) => ({ id: `c-${i}`, text: "x", done: false })),
    ]) {
      expect(() => validateItems([broken(list, { items })])).toThrow(FormatError);
    }
    expect(() => validateItems([broken(list, { onClick: "x" })])).toThrow(FormatError);
  });

  it("rejects bad text sizes, arrow points and colors", () => {
    expect(() => validateItems([broken(makeText(0, 0), { size: "xl" })])).toThrow(FormatError);
    expect(() => validateItems([broken(makeText(0, 0), { text: "x".repeat(3000) })])).toThrow(
      FormatError,
    );
    const arrow = makeArrow({ x: 0, y: 0 }, { x: 50, y: 50 }, "#3f5f9e");
    expect(() => validateItems([broken(arrow, { end: [9999, 0] })])).toThrow(FormatError);
    expect(() => validateItems([broken(arrow, { color: "red;x" })])).toThrow(FormatError);
    expect(() => validateItems([broken(arrow, { head: "big" })])).toThrow(FormatError);
  });

  it("clones cards with fresh item ids", () => {
    const list = makeChecklist(0, 0);
    const [copy] = cloneItems([list], 10, 10);
    expect(copy.id).not.toBe(list.id);
    expect(() => validateItems([list, copy])).not.toThrow();
  });
});

describe("templates", () => {
  it("produce valid items with fresh, unique ids every time", () => {
    for (const { id } of templateList) {
      const first = buildTemplate(id, 100, 100);
      const second = buildTemplate(id, 100, 100);
      expect(first.length).toBeGreaterThan(3);
      expect(() => validateItems([...first, ...second])).not.toThrow();
      const ids = new Set([...first, ...second].map((i) => i.id));
      expect(ids.size).toBe(first.length * 2);
    }
  });

  it("keeps kanban cards inside their columns", () => {
    const items = buildTemplate("kanban", 0, 0);
    const regions = items.filter((i) => i.kind === "region");
    expect(regions.map((r) => r.title)).toEqual(["Yapılacak", "Yapılıyor", "Bitti"]);
    const markdown = boardToMarkdown({ ...emptyBoard("K"), items });
    expect(markdown).toContain("## Yapılacak");
    expect(markdown).toContain("- [x] İlk sürüm");
    expect(items.filter(isNodeItem).some((i) => i.kind === "checklist")).toBe(true);
  });
});

describe("markdown export of the new kinds", () => {
  it("writes tables as a Veritabanı section with their relations", () => {
    const a = orders();
    const b = makeTable(400, 0, "customers", [makeColumn("customer_id", "bigint", { pk: true })]);
    const relation = makeEdge(a.id, b.id, { style: "reference", label: "customer_id" });
    const markdown = boardToMarkdown({ ...emptyBoard("ER"), items: [a, b, relation] });
    expect(markdown).toContain("## Veritabanı");
    expect(markdown).toContain("| Kolon | Tür | PK | Boş olabilir | Not |");
    expect(markdown).toContain("| order_id | bigint | ✓ | hayır |  |");
    expect(markdown).toContain("| customer_id | bigint |  | hayır | who \\| ordered |");
    expect(markdown).toContain("| created_at | timestamptz |  | evet |  |");
    expect(markdown).toContain("- orders → customers (customer_id)");
    // Table relations are listed once, not again as references.
    expect(markdown).not.toContain("## Referanslar");
  });

  it("writes checklists as task lists with progress, and links and text in place", () => {
    const list = makeChecklist(0, 0, "Yayın", [{ text: "Test", done: true }, { text: "Not yaz" }]);
    const link = makeLink(0, 300, "https://example.com/a b", "Örnek", "kaynak");
    const label = makeText(0, 500, "Serbest metin");
    const markdown = boardToMarkdown({ ...emptyBoard("L"), items: [list, link, label] });
    expect(markdown).toContain("### Yayın (1/2)");
    expect(markdown).toContain("- [x] Test\n- [ ] Not yaz");
    expect(markdown).toContain("- [Örnek](<https://example.com/a%20b>) — kaynak");
    expect(markdown).toContain("Serbest metin");
  });
});
