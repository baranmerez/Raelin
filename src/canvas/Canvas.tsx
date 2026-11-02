import {
  Background,
  BackgroundVariant,
  type Connection,
  ConnectionLineType,
  ConnectionMode,
  type Edge,
  type EdgeChange,
  MarkerType,
  type Node,
  type NodeChange,
  ReactFlow,
  SelectionMode,
  useStore,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { useCallback, useMemo, useRef, useState } from "react";
import { makeEdge } from "../model/factory";
import type { BoardDoc, ConnectorType, EdgeItem, NodeItem } from "../model/types";
import { isEdgeItem, isNodeItem } from "../model/types";
import { mapItems, removeItems, useActiveBoard, useBoardStore } from "../state/boardStore";
import { BottomBar } from "./BottomBar";
import { FpsMeter } from "./FpsMeter";
import { FlowNodeView } from "./nodes/FlowNodeView";
import { NoteView } from "./nodes/NoteView";
import { RegionView } from "./nodes/RegionView";
import { StrokeView } from "./nodes/StrokeView";
import { RaelinEdge } from "./RaelinEdge";
import { ToolOverlay } from "./ToolOverlay";
import { ZoomControl } from "./ZoomControl";

const nodeTypes = {
  flowNode: FlowNodeView,
  note: NoteView,
  region: RegionView,
  stroke: StrokeView,
};
const edgeTypes = { raelin: RaelinEdge };
const inkColor = "#5b3a9e";

type Size = { width: number; height: number };

function toRfNode(item: NodeItem, selected: boolean, size: Size | undefined): Node {
  const base = {
    id: item.id,
    position: { x: item.x, y: item.y },
    selected,
    data: { item },
    measured: size,
  };
  switch (item.kind) {
    case "flowNode":
      return { ...base, type: "flowNode", width: item.width, height: item.height };
    case "note":
      // Notes grow with their text; initialHeight stands in until the DOM is measured.
      return {
        ...base,
        type: "note",
        width: item.width,
        initialHeight: 140,
        dragHandle: ".note-drag",
      };
    case "region":
      return {
        ...base,
        type: "region",
        width: item.width,
        height: item.height,
        zIndex: -1,
        dragHandle: ".region-handle",
      };
    case "stroke":
      return { ...base, type: "stroke", width: item.width, height: item.height };
  }
}

function toRfEdge(item: EdgeItem, selected: boolean, connector: ConnectorType): Edge {
  return {
    id: item.id,
    source: item.source,
    target: item.target,
    sourceHandle: item.sourceHandle ?? null,
    targetHandle: item.targetHandle ?? null,
    type: "raelin",
    selected,
    data: { item, connector },
    markerEnd: {
      type: MarkerType.ArrowClosed,
      color: item.style === "reference" ? "#8e6bd1" : inkColor,
      width: 16,
      height: 16,
    },
  };
}

interface NodeEntry {
  item: NodeItem;
  selected: boolean;
  size: Size | undefined;
  node: Node;
}

interface EdgeEntry {
  item: EdgeItem;
  selected: boolean;
  connector: ConnectorType;
  edge: Edge;
}

/**
 * Maps board items to React Flow objects, reusing the previous object whenever its
 * inputs are unchanged. React Flow skips re-rendering nodes whose object is identical,
 * so a drag only re-renders the dragged node instead of the whole board.
 */
function useRfGraph(
  board: BoardDoc | undefined,
  selectedIds: string[],
  measured: Record<string, Size>,
) {
  const nodeCache = useRef(new Map<string, NodeEntry>());
  const edgeCache = useRef(new Map<string, EdgeEntry>());
  return useMemo(() => {
    if (!board) return { nodes: [] as Node[], edges: [] as Edge[] };
    const selected = new Set(selectedIds);
    const nodeItems = board.items.filter(isNodeItem);
    // Regions render first so they stay behind everything else.
    nodeItems.sort((a, b) => Number(b.kind === "region") - Number(a.kind === "region"));

    const nextNodes = new Map<string, NodeEntry>();
    const nodes = nodeItems.map((item) => {
      const isSelected = selected.has(item.id);
      const size = measured[item.id];
      const cached = nodeCache.current.get(item.id);
      const node =
        cached && cached.item === item && cached.selected === isSelected && cached.size === size
          ? cached.node
          : toRfNode(item, isSelected, size);
      nextNodes.set(item.id, { item, selected: isSelected, size, node });
      return node;
    });
    nodeCache.current = nextNodes;

    const nextEdges = new Map<string, EdgeEntry>();
    const edges = board.items.filter(isEdgeItem).map((item) => {
      const isSelected = selected.has(item.id);
      const cached = edgeCache.current.get(item.id);
      const edge =
        cached &&
        cached.item === item &&
        cached.selected === isSelected &&
        cached.connector === board.connector
          ? cached.edge
          : toRfEdge(item, isSelected, board.connector);
      nextEdges.set(item.id, { item, selected: isSelected, connector: board.connector, edge });
      return edge;
    });
    edgeCache.current = nextEdges;
    return { nodes, edges };
  }, [board, selectedIds, measured]);
}

export function Canvas({ stress }: { stress: boolean }) {
  const board = useActiveBoard();
  const selectedIds = useBoardStore((s) => s.selectedIds);
  const tool = useBoardStore((s) => s.tool);
  const live = useBoardStore((s) => s.live);
  const commit = useBoardStore((s) => s.commit);
  const beginGesture = useBoardStore((s) => s.beginGesture);
  const endGesture = useBoardStore((s) => s.endGesture);
  const setSelection = useBoardStore((s) => s.setSelection);
  const [measured, setMeasured] = useState<Record<string, Size>>({});
  // Boolean selector: re-renders only when crossing the threshold, not on every zoom frame.
  const far = useStore((s) => s.transform[2] < 0.5);
  const { nodes, edges } = useRfGraph(board, selectedIds, measured);

  /** Controlled mode: selection arrives as "select" changes and must be written back. */
  const applySelectChanges = useCallback(
    (changes: (NodeChange | EdgeChange)[]) => {
      const selects = changes.filter((c) => c.type === "select");
      if (selects.length === 0) return;
      const next = new Set(useBoardStore.getState().selectedIds);
      for (const change of selects) {
        if (change.selected) next.add(change.id);
        else next.delete(change.id);
      }
      setSelection([...next].sort());
    },
    [setSelection],
  );

  const onNodesChange = useCallback(
    (changes: NodeChange[]) => {
      applySelectChanges(changes);
      const moves = new Map<string, { x: number; y: number }>();
      const sizes = new Map<string, Size>();
      const newMeasured: Record<string, Size> = {};
      for (const change of changes) {
        if (change.type === "position" && change.position) {
          moves.set(change.id, change.position);
        } else if (change.type === "dimensions" && change.dimensions) {
          newMeasured[change.id] = change.dimensions;
          if (change.setAttributes) sizes.set(change.id, change.dimensions);
        }
      }
      if (moves.size > 0 || sizes.size > 0) {
        live((b) =>
          mapItems(b, (item) => {
            if (item.kind === "edge") return item;
            const move = moves.get(item.id);
            const size = sizes.get(item.id);
            if (!move && !size) return item;
            const next = { ...item, ...move };
            if (size && (item.kind === "region" || item.kind === "flowNode")) {
              return { ...next, width: Math.round(size.width), height: Math.round(size.height) };
            }
            return next;
          }),
        );
      }
      if (Object.keys(newMeasured).length > 0) setMeasured((prev) => ({ ...prev, ...newMeasured }));
    },
    [live, applySelectChanges],
  );

  // Removal goes through onDelete so nodes and their edges disappear in one undo step.
  const onEdgesChange = useCallback(
    (changes: EdgeChange[]) => applySelectChanges(changes),
    [applySelectChanges],
  );

  const onConnect = useCallback(
    (connection: Connection) => {
      if (!connection.source || !connection.target || connection.source === connection.target)
        return;
      commit((b) => ({
        ...b,
        items: [
          ...b.items,
          makeEdge(connection.source, connection.target, {
            sourceHandle: connection.sourceHandle ?? undefined,
            targetHandle: connection.targetHandle ?? undefined,
          }),
        ],
      }));
    },
    [commit],
  );

  const onDelete = useCallback(
    ({ nodes: n, edges: e }: { nodes: Node[]; edges: Edge[] }) => {
      const ids = new Set([...n.map((x) => x.id), ...e.map((x) => x.id)]);
      if (ids.size === 0) return;
      commit((b) => removeItems(b, ids));
      // React Flow sends "remove", not "deselect"; drop ids that no longer exist
      // (including edges removed together with their nodes).
      const { workspace, activeBoardId, selectedIds } = useBoardStore.getState();
      const present = new Set(workspace.boards[activeBoardId]?.items.map((i) => i.id));
      setSelection(selectedIds.filter((id) => present.has(id)));
    },
    [commit, setSelection],
  );

  if (!board) return null;
  const many = board.items.length > 300;

  return (
    <div className={`canvas flow-style-${board.flowStyle}${far ? " is-far" : ""}`} data-tool={tool}>
      <ReactFlow
        // A fresh instance per board gives each board its own initial fit.
        key={board.id}
        fitView
        fitViewOptions={{ padding: 0.12, maxZoom: 1 }}
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        onDelete={onDelete}
        onNodeDragStart={beginGesture}
        onNodeDragStop={endGesture}
        onSelectionDragStart={beginGesture}
        onSelectionDragStop={endGesture}
        connectionMode={ConnectionMode.Loose}
        connectionLineType={
          board.connector === "curve" ? ConnectionLineType.Bezier : ConnectionLineType.SmoothStep
        }
        connectionLineStyle={{ stroke: inkColor, strokeWidth: 2, strokeDasharray: "6 5" }}
        deleteKeyCode={["Delete", "Backspace"]}
        multiSelectionKeyCode={["Shift", "Control"]}
        selectionOnDrag
        selectionMode={SelectionMode.Partial}
        panOnDrag={[1, 2]}
        panOnScroll
        zoomOnDoubleClick={false}
        elevateNodesOnSelect={false}
        onlyRenderVisibleElements={many}
        minZoom={0.1}
        maxZoom={3}
        attributionPosition="bottom-left"
      >
        {board.background !== "plain" && (
          <Background
            variant={board.background === "grid" ? BackgroundVariant.Lines : BackgroundVariant.Dots}
            gap={board.background === "grid" ? 28 : 22}
            size={board.background === "grid" ? 1 : 1.6}
            color={board.background === "grid" ? "#efe7de" : "#ddd2c6"}
          />
        )}
        <ToolOverlay />
        <BottomBar />
        <ZoomControl />
        {stress && <FpsMeter itemCount={board.items.length} />}
      </ReactFlow>
    </div>
  );
}
