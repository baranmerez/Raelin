import { Panel, useReactFlow } from "@xyflow/react";
import { AnimatePresence, motion } from "motion/react";
import { useState } from "react";
import { penColors } from "../model/tones";
import { type Tool, useBoardStore } from "../state/boardStore";
import { Icon, type IconName } from "../ui/Icon";
import { placeItem } from "./ToolOverlay";

const shapeMenu: { tool: Tool; label: string; icon: IconName }[] = [
  { tool: "terminal", label: "Başlangıç / bitiş", icon: "terminal" },
  { tool: "process", label: "Adım", icon: "process" },
  { tool: "decision", label: "Karar", icon: "decision" },
  { tool: "note", label: "Not", icon: "note" },
  { tool: "region", label: "Bölge", icon: "region" },
];

export function BottomBar() {
  const tool = useBoardStore((s) => s.tool);
  const setTool = useBoardStore((s) => s.setTool);
  const penColor = useBoardStore((s) => s.penColor);
  const setPen = useBoardStore((s) => s.setPen);
  const commit = useBoardStore((s) => s.commit);
  const setSelection = useBoardStore((s) => s.setSelection);
  const { screenToFlowPosition } = useReactFlow();
  const [menuOpen, setMenuOpen] = useState(false);

  const addAtCenter = (shape: Tool) => {
    const canvas = document.querySelector(".canvas")?.getBoundingClientRect();
    if (!canvas) return;
    const pos = screenToFlowPosition({
      x: canvas.left + canvas.width / 2,
      y: canvas.top + canvas.height / 2,
    });
    const item = placeItem(shape, pos.x, pos.y);
    if (!item) return;
    commit((b) => ({ ...b, items: [...b.items, item] }));
    setSelection([item.id]);
    setMenuOpen(false);
  };

  return (
    <Panel position="bottom-center" className="bottom-bar">
      {(["select", "pen"] as const).map((t) => (
        <button
          key={t}
          type="button"
          className={`tool-button${tool === t ? " is-active" : ""}`}
          onClick={() => setTool(t)}
          aria-label={t === "select" ? "Seç" : "Kalem"}
          aria-pressed={tool === t}
        >
          {tool === t && <motion.span layoutId="bottom-tool" className="tool-active-bg" />}
          <Icon name={t === "select" ? "pointer" : "pen"} />
        </button>
      ))}
      <span className="bar-divider" />
      {penColors.map((color) => (
        <button
          key={color}
          type="button"
          className={`color-dot${penColor === color ? " is-active" : ""}`}
          style={{ background: color }}
          onClick={() => {
            setPen({ color });
            setTool("pen");
          }}
          aria-label={`Kalem rengi ${color}`}
        />
      ))}
      <span className="bar-divider" />
      <div className="menu-anchor">
        <button
          type="button"
          className="pill-button"
          onClick={() => setMenuOpen((o) => !o)}
          aria-expanded={menuOpen}
        >
          <Icon name="process" size={18} />
          Şekil ekle
          <Icon name="chevron" size={16} />
        </button>
        <AnimatePresence>
          {menuOpen && (
            <motion.div
              className="popover-menu up"
              initial={{ opacity: 0, y: 8, scale: 0.97 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 6, scale: 0.98 }}
              transition={{ duration: 0.16 }}
            >
              {shapeMenu.map((entry) => (
                <button
                  key={entry.tool}
                  type="button"
                  className="menu-item"
                  onClick={() => addAtCenter(entry.tool)}
                >
                  <Icon name={entry.icon} size={18} />
                  {entry.label}
                </button>
              ))}
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </Panel>
  );
}
