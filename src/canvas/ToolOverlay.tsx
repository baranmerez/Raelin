import { useReactFlow, useViewport } from "@xyflow/react";
import { getStroke } from "perfect-freehand";
import { type PointerEvent, useRef, useState } from "react";
import { strokesAt } from "../commands/geometry";
import { makeFlowNode, makeNote, makeRegion } from "../model/factory";
import { newId } from "../model/ids";
import type { BoardItem, StrokeItem } from "../model/types";
import { removeItems, type Tool, useBoardStore } from "../state/boardStore";
import { outlinePath, strokeOptions } from "./nodes/StrokeView";

type Point = [number, number, number];

export function placeItem(tool: Tool, x: number, y: number): BoardItem | null {
  switch (tool) {
    case "process":
    case "decision":
    case "terminal":
      return makeFlowNode(tool, x, y);
    case "note":
      return makeNote(x, y, "Yeni not");
    case "region":
      return makeRegion(x, y, "Yeni bölge", "sage");
    default:
      return null;
  }
}

/** Captures pointer input for the pen and placement tools above the canvas. */
export function ToolOverlay() {
  const tool = useBoardStore((s) => s.tool);
  const penColor = useBoardStore((s) => s.penColor);
  const penSize = useBoardStore((s) => s.penSize);
  const commit = useBoardStore((s) => s.commit);
  const setTool = useBoardStore((s) => s.setTool);
  const setSelection = useBoardStore((s) => s.setSelection);
  const live = useBoardStore((s) => s.live);
  const beginGesture = useBoardStore((s) => s.beginGesture);
  const endGesture = useBoardStore((s) => s.endGesture);
  const { screenToFlowPosition } = useReactFlow();
  const { zoom } = useViewport();
  const overlay = useRef<HTMLDivElement>(null);
  const [points, setPoints] = useState<Point[] | null>(null);
  const [erasing, setErasing] = useState(false);
  const lastErase = useRef<{ x: number; y: number } | null>(null);

  if (tool === "select") return null;

  const local = (e: PointerEvent): Point => {
    const rect = overlay.current?.getBoundingClientRect();
    const pressure = e.pointerType === "pen" ? e.pressure : 0.5;
    return [e.clientX - (rect?.left ?? 0), e.clientY - (rect?.top ?? 0), pressure];
  };

  const finishStroke = (captured: Point[]) => {
    const rect = overlay.current?.getBoundingClientRect();
    if (!rect || captured.length < 2) return;
    const flow = captured.map(([x, y, p]) => {
      const pos = screenToFlowPosition({ x: x + rect.left, y: y + rect.top });
      return [pos.x, pos.y, p] as Point;
    });
    const pad = penSize * 2;
    const minX = Math.min(...flow.map((p) => p[0])) - pad;
    const minY = Math.min(...flow.map((p) => p[1])) - pad;
    const maxX = Math.max(...flow.map((p) => p[0])) + pad;
    const maxY = Math.max(...flow.map((p) => p[1])) + pad;
    const stroke: StrokeItem = {
      id: newId("s"),
      kind: "stroke",
      color: penColor,
      size: penSize,
      x: minX,
      y: minY,
      width: Math.ceil(maxX - minX),
      height: Math.ceil(maxY - minY),
      points: flow.map(([x, y, p]) => [
        Math.round((x - minX) * 10) / 10,
        Math.round((y - minY) * 10) / 10,
        p,
      ]),
    };
    commit((b) => ({ ...b, items: [...b.items, stroke] }));
  };

  /**
   * One erase drag removes every stroke it touches as a single undo step. Pointer events
   * arrive far apart on a fast drag, so the path since the last event is sampled too.
   */
  const eraseAt = (e: PointerEvent) => {
    const pos = screenToFlowPosition({ x: e.clientX, y: e.clientY });
    const from = lastErase.current ?? pos;
    lastErase.current = pos;
    const radius = 10 / zoom;
    const steps = Math.max(1, Math.ceil(Math.hypot(pos.x - from.x, pos.y - from.y) / radius));
    live((b) => {
      const hits = new Set<string>();
      for (let i = 0; i <= steps; i++) {
        const t = i / steps;
        const x = from.x + (pos.x - from.x) * t;
        const y = from.y + (pos.y - from.y) * t;
        for (const id of strokesAt(b, x, y, radius)) hits.add(id);
      }
      return hits.size > 0 ? removeItems(b, hits) : b;
    });
  };

  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    if (tool === "eraser") {
      e.currentTarget.setPointerCapture(e.pointerId);
      beginGesture();
      setErasing(true);
      lastErase.current = null;
      eraseAt(e);
      return;
    }
    if (tool === "pen") {
      e.currentTarget.setPointerCapture(e.pointerId);
      setPoints([local(e)]);
      return;
    }
    const pos = screenToFlowPosition({ x: e.clientX, y: e.clientY });
    const item = placeItem(tool, pos.x, pos.y);
    if (item) {
      commit((b) => ({ ...b, items: [...b.items, item] }));
      setSelection([item.id]);
    }
    setTool("select");
  };

  const preview =
    points && points.length > 1
      ? outlinePath(
          getStroke(points, {
            size: penSize * zoom,
            ...strokeOptions,
            simulatePressure: points[0][2] === 0.5,
          }),
        )
      : "";

  return (
    <div
      ref={overlay}
      className={`tool-overlay tool-${tool}`}
      onPointerDown={onPointerDown}
      onPointerMove={(e) => {
        if (points) setPoints([...points, local(e)]);
        if (erasing) eraseAt(e);
      }}
      onPointerUp={() => {
        if (points) finishStroke(points);
        setPoints(null);
        if (erasing) endGesture();
        setErasing(false);
      }}
      onPointerCancel={() => {
        setPoints(null);
        if (erasing) endGesture();
        setErasing(false);
      }}
    >
      {preview && (
        <svg className="stroke-preview" aria-hidden="true">
          <path d={preview} fill={penColor} />
        </svg>
      )}
    </div>
  );
}
