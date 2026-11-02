import { Panel, useReactFlow, useViewport } from "@xyflow/react";
import { Icon } from "../ui/Icon";

export function ZoomControl() {
  const { zoomIn, zoomOut, fitView, zoomTo } = useReactFlow();
  const { zoom } = useViewport();
  return (
    <Panel position="bottom-right" className="zoom-control">
      <button
        type="button"
        className="icon-button"
        onClick={() => zoomOut({ duration: 200 })}
        aria-label="Uzaklaş"
      >
        <Icon name="minus" size={18} />
      </button>
      <button
        type="button"
        className="zoom-value"
        onClick={() => zoomTo(1, { duration: 250 })}
        title="%100'e dön"
      >
        {Math.round(zoom * 100)}%
      </button>
      <button
        type="button"
        className="icon-button"
        onClick={() => zoomIn({ duration: 200 })}
        aria-label="Yakınlaş"
      >
        <Icon name="plus" size={18} />
      </button>
      <span className="zoom-divider" />
      <button
        type="button"
        className="icon-button"
        onClick={() => fitView({ padding: 0.12, duration: 400 })}
        aria-label="Hepsini sığdır"
        title="Hepsini sığdır"
      >
        <Icon name="fit" size={18} />
      </button>
    </Panel>
  );
}
