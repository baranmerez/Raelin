import type { Node, NodeProps } from "@xyflow/react";
import { memo } from "react";
import { makeCheckEntry } from "../../model/factory";
import type { BoardDoc, CheckEntry, ChecklistItem } from "../../model/types";
import { mapItems, useBoardStore } from "../../state/boardStore";
import { Icon } from "../../ui/Icon";
import { InlineText, SideHandles, toneStyle } from "./FlowNodeView";
import { WidthResizer } from "./WidthResizer";

export type ChecklistRfNode = Node<{ item: ChecklistItem }, "checklist">;

/** Rewrites the entries of the current version of the list, so quick edits never race. */
function editEntries(
  board: BoardDoc,
  id: string,
  fn: (entries: CheckEntry[]) => CheckEntry[],
): BoardDoc {
  return mapItems(board, (i) =>
    i.id === id && i.kind === "checklist" ? { ...i, items: fn(i.items) } : i,
  );
}

export const ChecklistView = memo(function ChecklistView({
  data,
  selected,
}: NodeProps<ChecklistRfNode>) {
  const { item } = data;
  const commit = useBoardStore((s) => s.commit);
  const done = item.items.filter((e) => e.done).length;
  const total = item.items.length;
  const edit = (fn: (entries: CheckEntry[]) => CheckEntry[]) =>
    commit((b) => editEntries(b, item.id, fn));

  return (
    <div
      className={`board-card checklist-card${selected ? " is-selected" : ""}`}
      style={{ ...toneStyle(item.tone), width: item.width }}
    >
      <WidthResizer visible={selected} minWidth={200} />
      <div className="card-header">
        <Icon name="checklist" size={18} />
        <InlineText
          className="card-title"
          multiline={false}
          value={item.title}
          onCommit={(title) =>
            commit((b) =>
              mapItems(b, (i) =>
                i.id === item.id && i.kind === "checklist" ? { ...i, title } : i,
              ),
            )
          }
        />
        <span className="card-chip" title="Tamamlanan / toplam">
          {done}/{total}
        </span>
      </div>
      <div className="check-progress" aria-hidden="true">
        <span style={{ width: total ? `${(done / total) * 100}%` : 0 }} />
      </div>
      <ul className="check-list">
        {item.items.map((entry) => (
          <li key={entry.id} className={entry.done ? "is-done" : ""}>
            <button
              type="button"
              className="check-box nodrag"
              aria-pressed={entry.done}
              aria-label={entry.done ? "İşareti kaldır" : "Tamamlandı olarak işaretle"}
              onClick={() =>
                edit((list) => list.map((e) => (e.id === entry.id ? { ...e, done: !e.done } : e)))
              }
            >
              {entry.done && <Icon name="check" size={14} />}
            </button>
            <InlineText
              className="check-text"
              value={entry.text}
              onCommit={(text) =>
                // Clearing an entry's text removes it.
                edit((list) =>
                  text
                    ? list.map((e) => (e.id === entry.id ? { ...e, text } : e))
                    : list.filter((e) => e.id !== entry.id),
                )
              }
            />
            <button
              type="button"
              className="row-remove nodrag"
              aria-label="Maddeyi sil"
              title="Maddeyi sil"
              onClick={() => edit((list) => list.filter((e) => e.id !== entry.id))}
            >
              <Icon name="close" size={13} />
            </button>
          </li>
        ))}
      </ul>
      <button
        type="button"
        className="card-add nodrag"
        onClick={() => edit((list) => [...list, makeCheckEntry("Yeni madde")])}
      >
        <Icon name="plus" size={14} />
        Madde ekle
      </button>
      <SideHandles />
    </div>
  );
});
