import { type Node, type NodeProps, NodeResizer } from "@xyflow/react";
import { memo } from "react";
import type { RegionItem } from "../../model/types";
import { patchItem, useBoardStore } from "../../state/boardStore";
import { InlineText, toneStyle } from "./FlowNodeView";

export type RegionRfNode = Node<{ item: RegionItem }, "region">;

export const RegionView = memo(function RegionView({ data, selected }: NodeProps<RegionRfNode>) {
  const { item } = data;
  const commit = useBoardStore((s) => s.commit);
  const beginGesture = useBoardStore((s) => s.beginGesture);
  const endGesture = useBoardStore((s) => s.endGesture);

  return (
    <div className={`region${selected ? " is-selected" : ""}`} style={toneStyle(item.tone)}>
      <NodeResizer
        isVisible={selected}
        minWidth={200}
        minHeight={160}
        lineClassName="region-resize-line"
        handleClassName="region-resize-handle"
        onResizeStart={beginGesture}
        onResizeEnd={endGesture}
      />
      <div className="region-blob" aria-hidden="true" />
      <div className="region-handle">
        <InlineText
          className="region-title"
          multiline={false}
          value={item.title}
          onCommit={(title) => commit((b) => patchItem<RegionItem>(b, item.id, { title }))}
        />
        <svg
          className="region-swash"
          viewBox="0 0 120 12"
          preserveAspectRatio="none"
          aria-hidden="true"
        >
          <path d="M2 9C30 3 70 2 118 5" />
        </svg>
      </div>
    </div>
  );
});
