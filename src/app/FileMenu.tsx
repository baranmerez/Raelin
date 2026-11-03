import { AnimatePresence, motion } from "motion/react";
import { useState } from "react";
import { fileTitle } from "../model/workspace";
import { isDesktop, readRecentPaths } from "../platform/storage";
import { useBoardStore } from "../state/boardStore";
import { Icon } from "../ui/Icon";
import { menuMotion, useDismiss } from "../ui/menu";
import { newNow, openNow, renameNow, saveNow } from "./actions";

function folderOf(path: string): string {
  return path.slice(0, Math.max(path.lastIndexOf("\\"), path.lastIndexOf("/")));
}

function RenameField({ name, done }: { name: string; done: () => void }) {
  const [value, setValue] = useState(name);
  const finish = (save: boolean) => {
    if (save && value.trim() && value.trim() !== name) void renameNow(value);
    done();
  };
  return (
    <input
      className="workspace-title-input"
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
      aria-label="Çalışma alanının adı"
    />
  );
}

/** The workspace name in the top bar, and the file menu behind it. */
export function FileMenu() {
  const path = useBoardStore((s) => s.origin?.path ?? null);
  const manifestTitle = useBoardStore((s) => s.workspace.manifest.title);
  const name = path ? fileTitle(path) : manifestTitle;
  const [open, setOpen] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [recent, setRecent] = useState<string[]>([]);
  const ref = useDismiss(open, () => setOpen(false));

  const toggle = () => {
    if (!open) void readRecentPaths().then((paths) => setRecent(paths.filter((p) => p !== path)));
    setOpen((o) => !o);
  };
  const run = (action: () => void) => () => {
    setOpen(false);
    action();
  };

  if (renaming) return <RenameField name={name} done={() => setRenaming(false)} />;

  return (
    <div className="menu-anchor" ref={ref}>
      <button
        type="button"
        className="workspace-title"
        onClick={toggle}
        onDoubleClick={() => setRenaming(true)}
        aria-expanded={open}
        title={path ?? "Henüz kaydedilmedi"}
      >
        <span className="workspace-title-text">{name}</span>
        <Icon name="chevron" size={16} />
      </button>
      <AnimatePresence>
        {open && (
          <motion.div className="popover-menu down file-menu" role="menu" {...menuMotion}>
            <button type="button" role="menuitem" className="menu-item" onClick={run(newNow)}>
              <Icon name="file" size={18} /> Yeni <kbd className="menu-kbd">Ctrl+N</kbd>
            </button>
            <button
              type="button"
              role="menuitem"
              className="menu-item"
              disabled={!isDesktop}
              onClick={run(() => void openNow())}
            >
              <Icon name="folder" size={18} /> Aç… <kbd className="menu-kbd">Ctrl+O</kbd>
            </button>
            {recent.length > 0 && (
              <>
                <p className="menu-section">Son açılanlar</p>
                {recent.map((p) => (
                  <button
                    key={p}
                    type="button"
                    role="menuitem"
                    className="menu-item recent-item"
                    title={p}
                    onClick={run(() => void openNow(p))}
                  >
                    <span className="recent-name">{fileTitle(p)}</span>
                    <span className="recent-folder">{folderOf(p)}</span>
                  </button>
                ))}
              </>
            )}
            <div className="menu-divider" />
            <button
              type="button"
              role="menuitem"
              className="menu-item"
              onClick={run(() => void saveNow())}
            >
              <Icon name="save" size={18} /> Kaydet <kbd className="menu-kbd">Ctrl+S</kbd>
            </button>
            <button
              type="button"
              role="menuitem"
              className="menu-item"
              onClick={run(() => void saveNow({ saveAs: true }))}
            >
              <Icon name="save" size={18} /> Farklı kaydet…{" "}
              <kbd className="menu-kbd">Ctrl+Shift+S</kbd>
            </button>
            <button
              type="button"
              role="menuitem"
              className="menu-item"
              onClick={run(() => setRenaming(true))}
            >
              <Icon name="pencil" size={18} /> Yeniden adlandır…
            </button>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
