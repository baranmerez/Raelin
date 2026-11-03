import type { Node, NodeProps } from "@xyflow/react";
import { memo } from "react";
import { makeColumn } from "../../model/factory";
import type { BoardDoc, TableColumn, TableItem } from "../../model/types";
import { mapItems, useBoardStore } from "../../state/boardStore";
import { Icon } from "../../ui/Icon";
import { InlineText, SideHandles, toneStyle } from "./FlowNodeView";
import { WidthResizer } from "./WidthResizer";

export type TableRfNode = Node<{ item: TableItem }, "table">;

/** Patches the current version of the table, so quick edits never race. */
function editTable(
  board: BoardDoc,
  id: string,
  fn: (table: TableItem) => Partial<TableItem>,
): BoardDoc {
  return mapItems(board, (i) => (i.id === id && i.kind === "table" ? { ...i, ...fn(i) } : i));
}

export const TableView = memo(function TableView({ data, selected }: NodeProps<TableRfNode>) {
  const { item } = data;
  const commit = useBoardStore((s) => s.commit);
  const edit = (fn: (table: TableItem) => Partial<TableItem>) =>
    commit((b) => editTable(b, item.id, fn));
  const editColumn = (id: string, patch: Partial<TableColumn>) =>
    edit((t) => ({ columns: t.columns.map((c) => (c.id === id ? { ...c, ...patch } : c)) }));

  return (
    <div
      className={`board-card table-card${selected ? " is-selected" : ""}`}
      style={{ ...toneStyle(item.tone), width: item.width }}
    >
      <WidthResizer visible={selected} minWidth={220} />
      <div className="card-header table-header">
        <Icon name="table" size={18} />
        <InlineText
          className="card-title table-name"
          multiline={false}
          value={item.name}
          onCommit={(name) => edit(() => ({ name }))}
        />
      </div>
      <ul className="table-columns">
        {item.columns.map((column) => (
          <li key={column.id} className={column.pk ? "is-pk" : ""}>
            <button
              type="button"
              className="pk-toggle nodrag"
              aria-pressed={column.pk}
              aria-label="Birincil anahtar"
              title="Birincil anahtar (PK)"
              onClick={() =>
                editColumn(column.id, {
                  pk: !column.pk,
                  // A new key column cannot be empty.
                  nullable: column.pk ? column.nullable : false,
                })
              }
            >
              <Icon name="key" size={14} />
            </button>
            <InlineText
              className="column-name"
              multiline={false}
              value={column.name}
              onCommit={(name) =>
                name
                  ? editColumn(column.id, { name })
                  : edit((t) => ({ columns: t.columns.filter((c) => c.id !== column.id) }))
              }
            />
            <InlineText
              className="column-type"
              multiline={false}
              value={column.type}
              onCommit={(type) => editColumn(column.id, { type })}
            />
            <button
              type="button"
              className={`null-toggle nodrag${column.nullable ? " is-on" : ""}`}
              aria-pressed={column.nullable}
              title={column.nullable ? "Boş olabilir" : "Boş olamaz"}
              onClick={() => editColumn(column.id, { nullable: !column.nullable })}
            >
              {column.nullable ? "boş" : "dolu"}
            </button>
            <button
              type="button"
              className="row-remove nodrag"
              aria-label="Kolonu sil"
              title="Kolonu sil"
              onClick={() =>
                edit((t) => ({ columns: t.columns.filter((c) => c.id !== column.id) }))
              }
            >
              <Icon name="close" size={13} />
            </button>
          </li>
        ))}
      </ul>
      <button
        type="button"
        className="card-add nodrag"
        onClick={() =>
          edit((t) => ({ columns: [...t.columns, makeColumn(`kolon_${t.columns.length + 1}`)] }))
        }
      >
        <Icon name="plus" size={14} />
        Kolon ekle
      </button>
      <SideHandles />
    </div>
  );
});
