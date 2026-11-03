import type { Node, NodeProps } from "@xyflow/react";
import { memo } from "react";
import type { ArrowItem } from "../../model/types";

export type ArrowRfNode = Node<{ item: ArrowItem }, "arrow">;

type Pt = readonly [number, number];

/** Triangle at `to`, pointing away from `from`, as an SVG points list. */
export function arrowHeadPoints(from: Pt, to: Pt, size: number): string {
  const angle = Math.atan2(to[1] - from[1], to[0] - from[0]);
  const spread = 0.42;
  const a = [to[0] - size * Math.cos(angle - spread), to[1] - size * Math.sin(angle - spread)];
  const b = [to[0] - size * Math.cos(angle + spread), to[1] - size * Math.sin(angle + spread)];
  return [to, a, b].map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(" ");
}

const headSize = 13;

export const ArrowView = memo(function ArrowView({ data, selected }: NodeProps<ArrowRfNode>) {
  const { item } = data;
  const { start, end } = item;
  const both = item.head === "both";
  const hasEnd = item.head !== "none";
  return (
    <svg
      className={`arrow-node${selected ? " is-selected" : ""}`}
      role="img"
      aria-label="Ok"
      width={item.width}
      height={item.height}
      viewBox={`0 0 ${item.width} ${item.height}`}
    >
      {selected && (
        <line className="arrow-halo" x1={start[0]} y1={start[1]} x2={end[0]} y2={end[1]} />
      )}
      <line
        x1={start[0]}
        y1={start[1]}
        x2={end[0]}
        y2={end[1]}
        stroke={item.color}
        strokeWidth={2.4}
        strokeLinecap="round"
        strokeDasharray={item.dashed ? "9 7" : undefined}
      />
      {hasEnd && <polygon points={arrowHeadPoints(start, end, headSize)} fill={item.color} />}
      {both && <polygon points={arrowHeadPoints(end, start, headSize)} fill={item.color} />}
      {/* Wide invisible line: the arrow is picked by its stroke, not its whole box. */}
      <line className="arrow-hit" x1={start[0]} y1={start[1]} x2={end[0]} y2={end[1]} />
    </svg>
  );
});
