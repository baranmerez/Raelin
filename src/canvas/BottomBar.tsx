import { Panel, useReactFlow } from "@xyflow/react";
import { AnimatePresence, motion } from "motion/react";
import { useState } from "react";
import { makeFlowNode } from "../model/factory";
import { buildTemplate, type TemplateId, templateList } from "../model/templates";
import { penColors } from "../model/tones";
import type { BoardItem, FlowShape } from "../model/types";
import { isNodeItem } from "../model/types";
import { type Tool, useBoardStore } from "../state/boardStore";
import { Icon, type IconName } from "../ui/Icon";
import { placeItem } from "./ToolOverlay";

type MenuEntry = {
  key: string;
  label: string;
  icon: IconName;
  make: (x: number, y: number) => BoardItem | null;
};

const shape = (s: FlowShape, label: string): MenuEntry => ({
  key: s,
  label,
  icon: s,
  make: (x, y) => makeFlowNode(s, x, y),
});
const tool = (t: Tool, label: string, icon: IconName): MenuEntry => ({
  key: t,
  label,
  icon,
  make: (x, y) => placeItem(t, x, y),
});

const shapeMenu: { title: string; entries: MenuEntry[] }[] = [
  {
    title: "Akış",
    entries: [
      shape("terminal", "Başlangıç / bitiş"),
      shape("process", "Adım"),
      shape("decision", "Karar"),
      shape("ellipse", "Elips"),
      shape("io", "Girdi / çıktı"),
      shape("document", "Belge"),
      shape("database", "Veritabanı"),
      shape("cloud", "Bulut"),
      shape("actor", "Aktör"),
    ],
  },
  {
    title: "Kartlar",
    entries: [
      tool("note", "Not", "note"),
      tool("region", "Bölge", "region"),
      tool("text", "Metin", "text"),
      tool("checklist", "Kontrol listesi", "checklist"),
      tool("link", "Bağlantı kartı", "link"),
      tool("table", "Tablo", "table"),
    ],
  },
];

const menuMotion = {
  initial: { opacity: 0, y: 8, scale: 0.97 },
  animate: { opacity: 1, y: 0, scale: 1 },
  exit: { opacity: 0, y: 6, scale: 0.98 },
  transition: { duration: 0.16 },
};

export function BottomBar() {
  const activeTool = useBoardStore((s) => s.tool);
  const setTool = useBoardStore((s) => s.setTool);
  const penColor = useBoardStore((s) => s.penColor);
  const setPen = useBoardStore((s) => s.setPen);
  const commit = useBoardStore((s) => s.commit);
  const setSelection = useBoardStore((s) => s.setSelection);
  const { screenToFlowPosition } = useReactFlow();
  const [menu, setMenu] = useState<"shapes" | "templates" | null>(null);

  const viewCenter = () => {
    const canvas = document.querySelector(".canvas")?.getBoundingClientRect();
    if (!canvas) return null;
    return screenToFlowPosition({
      x: canvas.left + canvas.width / 2,
      y: canvas.top + canvas.height / 2,
    });
  };

  /** Adds items in one undo step and selects the new nodes. */
  const insert = (items: BoardItem[]) => {
    if (items.length === 0) return;
    commit((b) => ({ ...b, items: [...b.items, ...items] }));
    setSelection(
      items
        .filter(isNodeItem)
        .map((i) => i.id)
        .sort(),
    );
    setMenu(null);
  };

  const addAtCenter = (entry: MenuEntry) => {
    const pos = viewCenter();
    const item = pos && entry.make(pos.x, pos.y);
    if (item) insert([item]);
  };

  const addTemplate = (id: TemplateId) => {
    const pos = viewCenter();
    if (pos) insert(buildTemplate(id, pos.x, pos.y));
  };

  const toggle = (which: "shapes" | "templates") => setMenu((m) => (m === which ? null : which));

  return (
    <Panel position="bottom-center" className="bottom-bar">
      {(["select", "pen"] as const).map((t) => (
        <button
          key={t}
          type="button"
          className={`tool-button${activeTool === t ? " is-active" : ""}`}
          onClick={() => setTool(t)}
          aria-label={t === "select" ? "Seç" : "Kalem"}
          aria-pressed={activeTool === t}
        >
          {activeTool === t && <motion.span layoutId="bottom-tool" className="tool-active-bg" />}
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
          onClick={() => toggle("shapes")}
          aria-expanded={menu === "shapes"}
        >
          <Icon name="process" size={18} />
          Şekil ekle
          <Icon name="chevron" size={16} />
        </button>
        <AnimatePresence>
          {menu === "shapes" && (
            <motion.div className="popover-menu up shape-menu" {...menuMotion}>
              {shapeMenu.map((group) => (
                <div key={group.title} className="shape-menu-group">
                  <p className="menu-hint">{group.title}</p>
                  {group.entries.map((entry) => (
                    <button
                      key={entry.key}
                      type="button"
                      className="menu-item"
                      onClick={() => addAtCenter(entry)}
                    >
                      <Icon name={entry.icon} size={18} />
                      {entry.label}
                    </button>
                  ))}
                </div>
              ))}
            </motion.div>
          )}
        </AnimatePresence>
      </div>
      <div className="menu-anchor">
        <button
          type="button"
          className="pill-button"
          onClick={() => toggle("templates")}
          aria-expanded={menu === "templates"}
        >
          <Icon name="template" size={18} />
          Şablonlar
          <Icon name="chevron" size={16} />
        </button>
        <AnimatePresence>
          {menu === "templates" && (
            <motion.div className="popover-menu up align-right" {...menuMotion}>
              {templateList.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  className="menu-item"
                  onClick={() => addTemplate(t.id)}
                >
                  <Icon name="template" size={18} />
                  {t.label}
                </button>
              ))}
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </Panel>
  );
}
