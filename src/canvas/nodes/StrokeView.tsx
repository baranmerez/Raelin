import type { Node, NodeProps } from "@xyflow/react";
import { getStroke } from "perfect-freehand";
import { memo, useMemo } from "react";
import type { StrokeItem } from "../../model/types";

export type StrokeRfNode = Node<{ item: StrokeItem }, "stroke">;

export const strokeOptions = { thinning: 0.55, smoothing: 0.6, streamline: 0.5 };

/** Outline polygon from perfect-freehand as a smooth quadratic SVG path. */
export function outlinePath(outline: number[][]): string {
  if (outline.length < 4) return "";
  const [first, ...rest] = outline;
  let d = `M${first[0].toFixed(1)},${first[1].toFixed(1)} Q`;
  for (let i = 0; i < rest.length; i++) {
    const [x0, y0] = rest[i];
    const [x1, y1] = rest[(i + 1) % rest.length];
    d += `${x0.toFixed(1)},${y0.toFixed(1)} ${((x0 + x1) / 2).toFixed(1)},${((y0 + y1) / 2).toFixed(1)} `;
  }
  return `${d}Z`;
}

export const StrokeView = memo(function StrokeView({ data, selected }: NodeProps<StrokeRfNode>) {
  const { item } = data;
  const d = useMemo(
    () =>
      outlinePath(
        getStroke(item.points, { size: item.size, ...strokeOptions, simulatePressure: true }),
      ),
    [item.points, item.size],
  );
  return (
    <svg
      className={`stroke-node${selected ? " is-selected" : ""}`}
      role="img"
      aria-label="Serbest çizim"
      width={item.width}
      height={item.height}
      viewBox={`0 0 ${item.width} ${item.height}`}
    >
      <path d={d} fill={item.color} />
    </svg>
  );
});
