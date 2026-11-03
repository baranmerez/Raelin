import {
  BaseEdge,
  type Edge,
  EdgeLabelRenderer,
  type EdgeProps,
  getBezierPath,
  getSmoothStepPath,
  getStraightPath,
} from "@xyflow/react";
import { memo, useEffect, useRef, useState } from "react";
import type { ConnectorType, EdgeItem } from "../model/types";
import { patchItem, useBoardStore } from "../state/boardStore";

export type RaelinRfEdge = Edge<{ item: EdgeItem; connector: ConnectorType }, "raelin">;

export const RaelinEdge = memo(function RaelinEdge(props: EdgeProps<RaelinRfEdge>) {
  const {
    id,
    sourceX,
    sourceY,
    targetX,
    targetY,
    sourcePosition,
    targetPosition,
    data,
    selected,
    markerEnd,
  } = props;
  const commit = useBoardStore((s) => s.commit);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const item = data?.item;
  const connector = data?.connector ?? "elbow";

  const args = { sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition };
  const [path, labelX, labelY] =
    connector === "curve"
      ? getBezierPath(args)
      : connector === "straight"
        ? getStraightPath(args)
        : getSmoothStepPath({ ...args, borderRadius: 14, offset: 28 });

  useEffect(() => {
    if (editing) inputRef.current?.focus();
  }, [editing]);

  if (!item) return null;
  const isReference = item.style === "reference";

  const finish = (save: boolean) => {
    setEditing(false);
    const label = draft.trim();
    if (save && label !== (item.label ?? "")) {
      commit((b) => patchItem<EdgeItem>(b, id, { label: label || undefined }));
    }
  };

  const startEdit = () => {
    setDraft(item.label ?? "");
    setEditing(true);
  };
  const labelStyle = { transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)` };

  return (
    <>
      <BaseEdge
        id={id}
        path={path}
        markerEnd={markerEnd}
        className={`raelin-edge${isReference ? " is-reference" : ""}${selected ? " is-selected" : ""}`}
        interactionWidth={18}
      />
      <EdgeLabelRenderer>
        {editing ? (
          <div className="edge-label nodrag nopan" style={labelStyle}>
            <input
              ref={inputRef}
              className="edge-label-input"
              value={draft}
              size={Math.max(4, draft.length + 1)}
              aria-label="Bağlantı etiketi"
              onChange={(e) => setDraft(e.target.value)}
              onBlur={() => finish(true)}
              onKeyDown={(e) => {
                e.stopPropagation();
                if (e.nativeEvent.isComposing) return;
                if (e.key === "Enter") finish(true);
                else if (e.key === "Escape") finish(false);
              }}
            />
          </div>
        ) : (
          <button
            type="button"
            className={`edge-label text-button nodrag nopan${item.label ? "" : " is-empty"}${selected ? " is-selected" : ""}`}
            style={labelStyle}
            data-edge-label={id}
            title="Etiketi düzenlemek için çift tıkla veya F2"
            onDoubleClick={(e) => {
              e.stopPropagation();
              startEdit();
            }}
            onKeyDown={(e) => {
              if (e.key === "F2" || e.key === "Enter") {
                e.preventDefault();
                startEdit();
              }
            }}
          >
            {item.label ?? (selected ? "etiket" : "")}
          </button>
        )}
      </EdgeLabelRenderer>
    </>
  );
});
