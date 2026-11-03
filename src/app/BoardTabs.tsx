import { AnimatePresence, motion } from "motion/react";
import { useState } from "react";
import { useShallow } from "zustand/react/shallow";
import { confirmAction } from "../platform/storage";
import { useBoardStore } from "../state/boardStore";
import { Icon } from "../ui/Icon";
import { menuMotion, useDismiss } from "../ui/menu";

const tabTones = ["lilac", "peach", "sage", "periwinkle", "butter"];

async function deleteBoard(id: string) {
  const store = useBoardStore.getState();
  const board = store.workspace.boards[id];
  if (!board) return;
  if (store.workspace.manifest.boards.length <= 1) {
    store.showToast("Son pano silinemez.", "error");
    return;
  }
  if (board.items.length > 0 && !(await confirmAction(`"${board.title}" panosu silinsin mi?`))) {
    return;
  }
  const removed = useBoardStore.getState().deleteBoard(id);
  if (!removed) return;
  store.showToast(`"${board.title}" silindi.`, "ok", {
    label: "Geri al",
    run: () => useBoardStore.getState().restoreBoard(removed),
  });
}

function RenameInput({ id, title, done }: { id: string; title: string; done: () => void }) {
  const renameBoard = useBoardStore((s) => s.renameBoard);
  const [value, setValue] = useState(title);
  const finish = (save: boolean) => {
    if (save) renameBoard(id, value);
    done();
  };
  return (
    <input
      className="board-tab-input"
      value={value}
      maxLength={120}
      // biome-ignore lint/a11y/noAutofocus: the field appears because the user asked to rename.
      autoFocus
      onFocus={(e) => e.currentTarget.select()}
      onChange={(e) => setValue(e.target.value)}
      onBlur={() => finish(true)}
      onKeyDown={(e) => {
        if (e.key === "Enter") finish(true);
        else if (e.key === "Escape") finish(false);
      }}
      aria-label="Pano adı"
    />
  );
}

function TabMenu({ id, close, rename }: { id: string; close: () => void; rename: () => void }) {
  const ref = useDismiss(true, close);
  const duplicateBoard = useBoardStore((s) => s.duplicateBoard);
  const only = useBoardStore((s) => s.workspace.manifest.boards.length <= 1);
  const run = (action: () => void) => () => {
    close();
    action();
  };
  return (
    <motion.div ref={ref} className="popover-menu down tab-menu" role="menu" {...menuMotion}>
      <button type="button" role="menuitem" className="menu-item" onClick={run(rename)}>
        <Icon name="pencil" size={16} /> Yeniden adlandır
      </button>
      <button
        type="button"
        role="menuitem"
        className="menu-item"
        onClick={run(() => duplicateBoard(id))}
      >
        <Icon name="copy" size={16} /> Çoğalt
      </button>
      <button
        type="button"
        role="menuitem"
        className="menu-item is-danger"
        disabled={only}
        onClick={run(() => void deleteBoard(id))}
      >
        <Icon name="trash" size={16} /> Sil
      </button>
    </motion.div>
  );
}

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
  const [editing, setEditing] = useState<string | null>(null);
  const [menuFor, setMenuFor] = useState<string | null>(null);

  return (
    <nav className="board-tabs" aria-label="Panolar">
      {boards.map((board, index) => {
        const active = board.id === activeId;
        const tone = `tone-${tabTones[index % tabTones.length]}`;
        return (
          <div key={board.id} className="menu-anchor">
            {editing === board.id ? (
              <div className={`board-tab ${tone} is-editing${active ? " is-active" : ""}`}>
                <RenameInput id={board.id} title={titles[index]} done={() => setEditing(null)} />
              </div>
            ) : (
              <button
                type="button"
                className={`board-tab ${tone}${active ? " is-active" : ""}`}
                onClick={() => selectBoard(board.id)}
                onDoubleClick={() => setEditing(board.id)}
                onContextMenu={(e) => {
                  e.preventDefault();
                  setMenuFor(board.id);
                }}
                onKeyDown={(e) => {
                  if (e.key === "F2") setEditing(board.id);
                }}
                aria-current={active ? "page" : undefined}
                title="Çift tıkla: yeniden adlandır · Sağ tık: diğer işlemler"
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
            )}
            <AnimatePresence>
              {menuFor === board.id && (
                <TabMenu
                  id={board.id}
                  close={() => setMenuFor(null)}
                  rename={() => setEditing(board.id)}
                />
              )}
            </AnimatePresence>
          </div>
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
