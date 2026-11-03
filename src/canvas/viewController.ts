import { type Node, useReactFlow } from "@xyflow/react";
import { useEffect } from "react";
import { isVisible, nextFrame, within } from "../ui/frames";

/**
 * The canvas owns the React Flow instance; code outside React (MCP tools) reaches the
 * view through this registry. Empty until a canvas is mounted.
 */
export interface ViewController {
  /** Fits the view to the given nodes, or to the whole board when ids is empty. */
  fitToIds: (ids: readonly string[]) => Promise<boolean>;
  /** Rendered nodes with measured sizes, for pictures of the board. */
  getNodes: () => Node[];
}

let current: ViewController | null = null;

export function viewController(): ViewController | null {
  return current;
}

/** Registers the surrounding React Flow instance while the calling component is mounted. */
export function useViewController() {
  const { fitView, getNodes } = useReactFlow();
  useEffect(() => {
    const controller: ViewController = {
      fitToIds: async (ids) => {
        // After a board switch the nodes render and get measured over the next frames, and
        // the new board fits itself once; fit after that so this view wins.
        const wanted = new Set(ids);
        const ready = () => {
          const nodes = getNodes().filter((n) => wanted.size === 0 || wanted.has(n.id));
          return nodes.length > 0 && nodes.every((n) => n.measured?.width);
        };
        for (let frame = 0; frame < 30 && !ready(); frame++) await nextFrame();
        await nextFrame();
        await nextFrame();
        if (getNodes().length === 0) return false;
        // The fit animation runs on animation frames too; a hidden window skips it.
        const fitted = fitView({
          nodes: ids.length > 0 ? ids.map((id) => ({ id })) : undefined,
          padding: 0.15,
          maxZoom: 1.2,
          duration: isVisible() ? 300 : 0,
        });
        return within(fitted, 1000, true);
      },
      getNodes,
    };
    current = controller;
    return () => {
      if (current === controller) current = null;
    };
  }, [fitView, getNodes]);
}
