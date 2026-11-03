import { type Node, type NodeProps, NodeResizer } from "@xyflow/react";
import { memo, useEffect, useState } from "react";
import type { ImageItem } from "../../model/types";
import { assetUrl } from "../../platform/assets";
import { useBoardStore } from "../../state/boardStore";
import { SideHandles } from "./FlowNodeView";

export type ImageRfNode = Node<{ item: ImageItem }, "image">;

export const ImageView = memo(function ImageView({ data, selected }: NodeProps<ImageRfNode>) {
  const { item } = data;
  const dir = useBoardStore((s) => s.origin?.dir ?? null);
  const beginGesture = useBoardStore((s) => s.beginGesture);
  const endGesture = useBoardStore((s) => s.endGesture);
  // undefined while loading, null when the file cannot be found.
  const [url, setUrl] = useState<string | null | undefined>(undefined);

  useEffect(() => {
    let current = true;
    void assetUrl(item.src, dir).then((next) => {
      if (current) setUrl(next);
    });
    return () => {
      current = false;
    };
  }, [item.src, dir]);

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
          {url === null ? "Resim bulunamadı" : ""}
        </div>
      )}
      <SideHandles />
    </div>
  );
});
