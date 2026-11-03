import { Handle, type Node, type NodeProps, Position } from "@xyflow/react";
import { type CSSProperties, memo, useEffect, useRef, useState } from "react";
import { tones } from "../../model/tones";
import type { FlowNodeItem, FlowShape } from "../../model/types";
import { patchItem, useBoardStore } from "../../state/boardStore";

export type FlowRfNode = Node<{ item: FlowNodeItem }, "flowNode">;

export const sideHandles = [
  { id: "t", position: Position.Top },
  { id: "r", position: Position.Right },
  { id: "b", position: Position.Bottom },
  { id: "l", position: Position.Left },
] as const;

export function SideHandles() {
  return sideHandles.map((h) => (
    <Handle key={h.id} id={h.id} type="source" position={h.position} className="side-handle" />
  ));
}

export function toneStyle(tone: keyof typeof tones): CSSProperties {
  const t = tones[tone];
  return {
    "--tone-fill": t.fill,
    "--tone-border": t.border,
    "--tone-ink": t.ink,
    "--tone-solid": t.solid,
    "--tone-wash": t.wash,
  } as CSSProperties;
}

export function InlineText({
  value,
  onCommit,
  className,
  multiline = true,
}: {
  value: string;
  onCommit: (text: string) => void;
  className?: string;
  multiline?: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const ref = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (editing) {
      ref.current?.focus();
      ref.current?.select();
    }
  }, [editing]);

  if (!editing) {
    const start = () => {
      setDraft(value);
      setEditing(true);
    };
    return (
      <button
        type="button"
        className={`text-button ${className ?? ""}`}
        title="Düzenlemek için çift tıkla veya F2"
        onDoubleClick={(e) => {
          e.stopPropagation();
          start();
        }}
        onKeyDown={(e) => {
          if (e.key === "F2" || e.key === "Enter") {
            e.preventDefault();
            e.stopPropagation();
            start();
          }
        }}
      >
        {value || " "}
      </button>
    );
  }

  const finish = (commit: boolean) => {
    setEditing(false);
    if (commit && draft.trim() !== value) onCommit(draft.trim());
  };

  return (
    <textarea
      ref={ref}
      className={`inline-editor nodrag nopan nowheel ${className ?? ""}`}
      value={draft}
      rows={multiline ? 2 : 1}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => finish(true)}
      onKeyDown={(e) => {
        e.stopPropagation();
        // Keep IME composition (e.g. Turkish/Asian input) from committing early.
        if (e.nativeEvent.isComposing) return;
        if (e.key === "Enter" && !e.shiftKey) {
          e.preventDefault();
          finish(true);
        } else if (e.key === "Escape") {
          finish(false);
        }
      }}
    />
  );
}

/** Outlines drawn in a 100×100 box that stretches with the node. */
const outlines: Partial<Record<FlowShape, { body: string; detail?: string }>> = {
  database: {
    body: "M2,14 A48,12 0 0 1 98,14 V86 A48,12 0 0 1 2,86 Z",
    detail: "M2,14 A48,12 0 0 0 98,14",
  },
  document: { body: "M2,2 H98 V86 C80,74 66,98 44,92 C28,88 14,84 2,90 Z" },
  io: { body: "M18,2 H98 L82,98 H2 Z" },
  cloud: {
    body: "M26,92 C10,92 2,80 6,67 C0,54 9,39 23,41 C23,22 41,11 55,20 C63,6 87,8 89,29 C100,33 101,55 92,63 C100,78 88,94 74,92 Z",
  },
};

function ShapeOutline({ shape }: { shape: FlowShape }) {
  const outline = outlines[shape];
  if (!outline) return null;
  return (
    <svg
      className="shape-outline"
      viewBox="0 0 100 100"
      preserveAspectRatio="none"
      aria-hidden="true"
    >
      {/* Offset copy instead of a CSS drop-shadow filter, which is costly to repaint. */}
      <path className="outline-shadow" d={outline.body} transform="translate(0 4)" />
      <path className="outline-body" d={outline.body} vectorEffect="non-scaling-stroke" />
      {outline.detail && (
        <path className="outline-detail" d={outline.detail} vectorEffect="non-scaling-stroke" />
      )}
    </svg>
  );
}

export const FlowNodeView = memo(function FlowNodeView({ data, selected }: NodeProps<FlowRfNode>) {
  const { item } = data;
  const commit = useBoardStore((s) => s.commit);
  const rename = (text: string) => commit((b) => patchItem<FlowNodeItem>(b, item.id, { text }));

  return (
    <div
      className={`flow-node shape-${item.shape}${selected ? " is-selected" : ""}`}
      style={{ ...toneStyle(item.tone), width: item.width, height: item.height }}
    >
      {item.shape === "decision" && (
        <svg
          className="decision-shape"
          viewBox="0 0 100 100"
          preserveAspectRatio="none"
          aria-hidden="true"
        >
          {/* Offset copy instead of a CSS drop-shadow filter, which is costly to repaint. */}
          <polygon className="decision-shadow" points="50,6 98,54 50,102 2,54" />
          <polygon points="50,2 98,50 50,98 2,50" vectorEffect="non-scaling-stroke" />
        </svg>
      )}
      <ShapeOutline shape={item.shape} />
      {item.shape === "actor" && (
        <svg className="actor-figure" viewBox="0 0 40 60" aria-hidden="true">
          <circle cx="20" cy="11" r="8" />
          <path d="M20 19v19M6 27h28M20 38 9 56M20 38l11 18" />
        </svg>
      )}
      <InlineText className="flow-node-text" value={item.text} onCommit={rename} />
      <SideHandles />
    </div>
  );
});
