import type { Node, NodeProps } from "@xyflow/react";
import { memo } from "react";
import { textMetrics } from "../../model/factory";
import type { TextItem } from "../../model/types";
import { patchItem, useBoardStore } from "../../state/boardStore";
import { InlineText, SideHandles, toneStyle } from "./FlowNodeView";
import { WidthResizer } from "./WidthResizer";

export type TextRfNode = Node<{ item: TextItem }, "text">;

export const TextView = memo(function TextView({ data, selected }: NodeProps<TextRfNode>) {
  const { item } = data;
  const commit = useBoardStore((s) => s.commit);
  const m = textMetrics[item.size];
  return (
    <div
      className={`text-node${selected ? " is-selected" : ""}${item.text ? "" : " is-empty"}`}
      style={{
        ...toneStyle(item.tone),
        width: item.width,
        fontSize: m.font,
        lineHeight: `${m.line}px`,
      }}
    >
      <WidthResizer visible={selected} minWidth={60} />
      <InlineText
        className="text-node-text"
        value={item.text}
        onCommit={(text) => commit((b) => patchItem<TextItem>(b, item.id, { text }))}
      />
      <SideHandles />
    </div>
  );
});
