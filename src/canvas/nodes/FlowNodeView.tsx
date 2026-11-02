import { Handle, type Node, type NodeProps, Position } from "@xyflow/react";
import { type CSSProperties, useEffect, useRef, useState } from "react";
import { tones } from "../../model/tones";
import type { FlowNodeItem } from "../../model/types";
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

export function FlowNodeView({ data, selected }: NodeProps<FlowRfNode>) {
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
          <polygon points="50,2 98,50 50,98 2,50" vectorEffect="non-scaling-stroke" />
        </svg>
      )}
      <InlineText className="flow-node-text" value={item.text} onCommit={rename} />
      <SideHandles />
    </div>
  );
}
