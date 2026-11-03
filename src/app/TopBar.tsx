import { useReactFlow } from "@xyflow/react";
import { AnimatePresence, motion } from "motion/react";
import { useState } from "react";
import type { BackgroundKind } from "../model/types";
import { isDesktop } from "../platform/storage";
import { useBoardStore } from "../state/boardStore";
import { Icon } from "../ui/Icon";
import { menuMotion, useDismiss } from "../ui/menu";
import { copyMarkdown, openNow, saveMarkdown, saveNow } from "./actions";
import { exportBoardImage, type ImageKind } from "./exportImage";
import { FileMenu } from "./FileMenu";

const backgroundLabel: Record<BackgroundKind, string> = {
  dots: "Noktalı",
  grid: "Kareli",
  plain: "Boş",
};

export function TopBar() {
  // Narrow selectors: the top bar must not re-render on every drag frame.
  const boardTitle = useBoardStore((s) => s.workspace.boards[s.activeBoardId]?.title);
  const background = useBoardStore((s) => s.workspace.boards[s.activeBoardId]?.background);
  const workspacePath = useBoardStore((s) => s.origin?.path ?? null);
  const dirty = useBoardStore((s) => s.workspace !== s.savedWorkspace);
  const canUndo = useBoardStore((s) => (s.history[s.activeBoardId]?.past.length ?? 0) > 0);
  const canRedo = useBoardStore((s) => (s.history[s.activeBoardId]?.future.length ?? 0) > 0);
  const undo = useBoardStore((s) => s.undo);
  const redo = useBoardStore((s) => s.redo);
  const commit = useBoardStore((s) => s.commit);
  const [themeOpen, setThemeOpen] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const themeRef = useDismiss(themeOpen, () => setThemeOpen(false));
  const exportRef = useDismiss(exportOpen, () => setExportOpen(false));
  const { getNodes } = useReactFlow();
  const exportImage = (kind: ImageKind) => {
    setExportOpen(false);
    void exportBoardImage(kind, getNodes());
  };

  return (
    <header className="top-bar">
      <div className="brand" role="img" aria-label="Raelin">
        <span className="brand-dot a" />
        <span className="brand-dot b" />
      </div>
      {import.meta.env.DEV && (
        <span className="dev-badge" title="Geliştirme sürümü: kurulu Raelin'den ayrı çalışır">
          DEV
        </span>
      )}
      <span className="top-divider" />
      <FileMenu />
      <Icon name="chevron" size={14} />
      <span className="board-crumb" title={workspacePath ?? "Henüz kaydedilmedi"}>
        {boardTitle}
      </span>
      {dirty && (
        <span className="dirty-dot" role="status" title="Kaydedilmemiş değişiklikler var">
          <span className="collapsible-label">Kaydedilmedi</span>
        </span>
      )}

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
          title="Zemin"
        >
          <Icon name="palette" />
          <span className="collapsible-label">
            Zemin · {background ? backgroundLabel[background] : ""}
          </span>
          <Icon name="chevron" size={16} />
        </button>
        <AnimatePresence>
          {themeOpen && (
            <motion.div className="popover-menu down" {...menuMotion}>
              {(Object.keys(backgroundLabel) as BackgroundKind[]).map((kind) => (
                <button
                  key={kind}
                  type="button"
                  className={`menu-item${background === kind ? " is-checked" : ""}`}
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
        onClick={() => void openNow()}
        disabled={!isDesktop}
        title="Aç (Ctrl+O)"
      >
        <Icon name="folder" />
        Aç
      </button>
      <button
        type="button"
        className="ghost-button"
        onClick={() => void saveNow()}
        title="Kaydet (Ctrl+S) · Farklı kaydet: Ctrl+Shift+S"
      >
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
              <button type="button" className="menu-item" onClick={() => exportImage("png")}>
                <Icon name="image" size={18} />
                PNG resmi kaydet
              </button>
              <button type="button" className="menu-item" onClick={() => exportImage("svg")}>
                <Icon name="image" size={18} />
                SVG resmi kaydet
              </button>
              <p className="menu-hint">Seçim varsa yalnız seçili öğeler aktarılır.</p>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </header>
  );
}
