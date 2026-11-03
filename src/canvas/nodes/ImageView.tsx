import { type Node, type NodeProps, NodeResizer } from "@xyflow/react";
import { memo } from "react";
import type { ImageItem } from "../../model/types";
import { assetUrl } from "../../platform/assets";
import { useBoardStore } from "../../state/boardStore";
import { SideHandles } from "./FlowNodeView";

export type ImageRfNode = Node<{ item: ImageItem }, "image">;

export const ImageView = memo(function ImageView({ data, selected }: NodeProps<ImageRfNode>) {
  const { item } = data;
  const beginGesture = useBoardStore((s) => s.beginGesture);
  const endGesture = useBoardStore((s) => s.endGesture);
  // Pictures arrive with the workspace file, so there is nothing to wait for.
  const url = assetUrl(item.src);

  return (
    <div className={`image-node${selected ? " is-selected" : ""}`}>
      <NodeResizer
        isVisible={selected}
        keepAspectRatio
        minWidth={48}
        minHeight={48}
        lineClassName="region-resize-line"
        handleClassName="region-resize-handle"
        onResizeStart={beginGesture}
        onResizeEnd={endGesture}
      />
      {url ? (
        <img src={url} alt={item.alt} draggable={false} />
      ) : (
        <div className="image-missing" role="img" aria-label={item.alt || "Resim"}>
          Resim bulunamadı
        </div>
      )}
      <SideHandles />
    </div>
  );
});
