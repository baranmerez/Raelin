import { motion } from "motion/react";
import { type Tool, useBoardStore } from "../state/boardStore";
import { Icon, type IconName } from "../ui/Icon";

export const toolList: { tool: Tool; icon: IconName; label: string; key: string }[] = [
  { tool: "select", icon: "pointer", label: "Seç", key: "V" },
  { tool: "pen", icon: "pen", label: "Kalem", key: "P" },
  { tool: "process", icon: "process", label: "Adım", key: "R" },
  { tool: "decision", icon: "decision", label: "Karar", key: "D" },
  { tool: "terminal", icon: "terminal", label: "Başlangıç / bitiş", key: "O" },
  { tool: "note", icon: "note", label: "Not", key: "N" },
  { tool: "region", icon: "region", label: "Bölge", key: "F" },
];

export function LeftToolbar() {
  const tool = useBoardStore((s) => s.tool);
  const setTool = useBoardStore((s) => s.setTool);
  return (
    <aside className="left-toolbar" aria-label="Araçlar">
      {toolList.map((entry) => (
        <button
          key={entry.tool}
          type="button"
          className={`tool-button${tool === entry.tool ? " is-active" : ""}`}
          onClick={() => setTool(entry.tool)}
          aria-label={entry.label}
          aria-pressed={tool === entry.tool}
          title={`${entry.label} (${entry.key})`}
        >
          {tool === entry.tool && (
            <motion.span
              layoutId="left-tool"
              className="tool-active-bg"
              transition={{ type: "spring", bounce: 0.25, duration: 0.35 }}
            />
          )}
          <Icon name={entry.icon} size={22} />
        </button>
      ))}
    </aside>
  );
}
