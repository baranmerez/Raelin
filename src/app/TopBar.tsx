import { AnimatePresence, motion } from "motion/react";
import { useEffect, useRef, useState } from "react";
import type { BackgroundKind } from "../model/types";
import { isDesktop } from "../platform/storage";
import { useActiveBoard, useBoardStore } from "../state/boardStore";
import { Icon } from "../ui/Icon";
import { copyMarkdown, openNow, saveMarkdown, saveNow } from "./actions";

const backgroundLabel: Record<BackgroundKind, string> = {
  dots: "Noktalı",
  grid: "Kareli",
  plain: "Boş",
};

function useDismiss(open: boolean, close: () => void) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) close();
    };
    window.addEventListener("pointerdown", onDown);
    return () => window.removeEventListener("pointerdown", onDown);
  }, [open, close]);
  return ref;
}

const menuMotion = {
  initial: { opacity: 0, y: -6, scale: 0.97 },
  animate: { opacity: 1, y: 0, scale: 1 },
  exit: { opacity: 0, y: -4, scale: 0.98 },
  transition: { duration: 0.15 },
};

export function TopBar() {
  const board = useActiveBoard();
  const title = useBoardStore((s) => s.workspace.manifest.title);
  const workspaceDir = useBoardStore((s) => s.workspaceDir);
  const canUndo = useBoardStore((s) => (s.history[s.activeBoardId]?.past.length ?? 0) > 0);
  const canRedo = useBoardStore((s) => (s.history[s.activeBoardId]?.future.length ?? 0) > 0);
  const undo = useBoardStore((s) => s.undo);
  const redo = useBoardStore((s) => s.redo);
  const commit = useBoardStore((s) => s.commit);
  const [themeOpen, setThemeOpen] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const themeRef = useDismiss(themeOpen, () => setThemeOpen(false));
  const exportRef = useDismiss(exportOpen, () => setExportOpen(false));

  return (
    <header className="top-bar">
      <div className="brand" role="img" aria-label="Raelin">
        <span className="brand-dot a" />
        <span className="brand-dot b" />
      </div>
      <span className="top-divider" />
      <h1 className="workspace-title">{title}</h1>
      <Icon name="chevron" size={16} />
      <span className="board-crumb" title={workspaceDir ?? "Henüz kaydedilmedi"}>
        {board?.title}
      </span>

      <div className="top-spacer" />

      <button
        type="button"
        className="icon-button"
        onClick={undo}
        disabled={!canUndo}
        title="Geri al (Ctrl+Z)"
      >
        <Icon name="undo" />
      </button>
      <button
        type="button"
        className="icon-button"
        onClick={redo}
        disabled={!canRedo}
        title="Yinele (Ctrl+Y)"
      >
        <Icon name="redo" />
      </button>
      <span className="top-divider" />

      <div className="menu-anchor" ref={themeRef}>
        <button
          type="button"
          className="ghost-button"
          onClick={() => setThemeOpen((o) => !o)}
          aria-expanded={themeOpen}
        >
          <Icon name="palette" />
          Zemin · {board ? backgroundLabel[board.background] : ""}
          <Icon name="chevron" size={16} />
        </button>
        <AnimatePresence>
          {themeOpen && (
            <motion.div className="popover-menu down" {...menuMotion}>
              {(Object.keys(backgroundLabel) as BackgroundKind[]).map((kind) => (
                <button
                  key={kind}
                  type="button"
                  className={`menu-item${board?.background === kind ? " is-checked" : ""}`}
                  onClick={() => {
                    commit((b) => (b.background === kind ? b : { ...b, background: kind }));
                    setThemeOpen(false);
                  }}
                >
                  <span className={`bg-swatch bg-${kind}`} />
                  {backgroundLabel[kind]}
                </button>
              ))}
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      <button
        type="button"
        className="ghost-button"
        onClick={openNow}
        disabled={!isDesktop}
        title="Aç (Ctrl+O)"
      >
        <Icon name="folder" />
        Aç
      </button>
      <button type="button" className="ghost-button" onClick={saveNow} title="Kaydet (Ctrl+S)">
        <Icon name="save" />
        Kaydet
      </button>

      <div className="menu-anchor" ref={exportRef}>
        <button
          type="button"
          className="primary-button"
          onClick={() => setExportOpen((o) => !o)}
          aria-expanded={exportOpen}
        >
          <Icon name="export" />
          Dışa aktar
        </button>
        <AnimatePresence>
          {exportOpen && (
            <motion.div className="popover-menu down align-right" {...menuMotion}>
              <button
                type="button"
                className="menu-item"
                onClick={() => {
                  setExportOpen(false);
                  void copyMarkdown();
                }}
              >
                <Icon name="copy" size={18} />
                Markdown olarak kopyala
              </button>
              <button
                type="button"
                className="menu-item"
                onClick={() => {
                  setExportOpen(false);
                  void saveMarkdown();
                }}
              >
                <Icon name="file" size={18} />
                Markdown dosyası kaydet
              </button>
              <p className="menu-hint">Seçim varsa yalnız seçili öğeler aktarılır.</p>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </header>
  );
}
