import { motion } from "motion/react";
import { useShallow } from "zustand/react/shallow";
import { useBoardStore } from "../state/boardStore";
import { Icon } from "../ui/Icon";

const tabTones = ["lilac", "peach", "sage", "periwinkle", "butter"];

export function BoardTabs() {
  const boards = useBoardStore((s) => s.workspace.manifest.boards);
  const titles = useBoardStore(
    useShallow((s) =>
      s.workspace.manifest.boards.map((b) => s.workspace.boards[b.id]?.title ?? b.title),
    ),
  );
  const activeId = useBoardStore((s) => s.activeBoardId);
  const selectBoard = useBoardStore((s) => s.selectBoard);
  const addBoard = useBoardStore((s) => s.addBoard);

  return (
    <nav className="board-tabs" aria-label="Panolar">
      {boards.map((board, index) => {
        const active = board.id === activeId;
        return (
          <button
            key={board.id}
            type="button"
            className={`board-tab tone-${tabTones[index % tabTones.length]}${active ? " is-active" : ""}`}
            onClick={() => selectBoard(board.id)}
            aria-current={active ? "page" : undefined}
          >
            {active && (
              <motion.span
                layoutId="tab-lift"
                className="tab-lift"
                transition={{ type: "spring", bounce: 0.2, duration: 0.4 }}
              />
            )}
            <span className="tab-label">{titles[index]}</span>
          </button>
        );
      })}
      <button
        type="button"
        className="board-tab-add"
        onClick={() => addBoard(`Pano ${boards.length + 1}`)}
        aria-label="Yeni pano"
        title="Yeni pano"
      >
        <Icon name="plus" size={16} />
      </button>
    </nav>
  );
}
