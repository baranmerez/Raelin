import { NodeResizeControl, ResizeControlVariant } from "@xyflow/react";
import { useBoardStore } from "../../state/boardStore";

/** Right-edge grip for cards whose height follows their content: only the width changes. */
export function WidthResizer({ visible, minWidth }: { visible: boolean; minWidth: number }) {
  const beginGesture = useBoardStore((s) => s.beginGesture);
  const endGesture = useBoardStore((s) => s.endGesture);
  if (!visible) return null;
  return (
    <NodeResizeControl
      variant={ResizeControlVariant.Line}
      position="right"
      minWidth={minWidth}
      maxWidth={1200}
      className="width-resize"
      onResizeStart={beginGesture}
      onResizeEnd={endGesture}
    />
  );
}
