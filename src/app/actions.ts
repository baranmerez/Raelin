import { boardToMarkdown } from "../model/markdown";
import { FormatError } from "../model/serialize";
import type { Workspace } from "../model/types";
import { emptyWorkspace, fileTitle } from "../model/workspace";
import {
  askUnsaved,
  clearRecovery,
  isDesktop,
  openWorkspace,
  readWorkspaceFile,
  renameWorkspaceFile,
  saveMarkdownFile,
  saveWorkspace,
  type WorkspaceOrigin,
} from "../platform/storage";
import { useBoardStore } from "../state/boardStore";

function errorText(error: unknown): string {
  if (error instanceof FormatError) return error.message;
  if (error instanceof Error) return error.message;
  return String(error);
}

export function isDirty(): boolean {
  const { workspace, savedWorkspace } = useBoardStore.getState();
  return workspace !== savedWorkspace;
}

/** True once the workspace was saved; false when the user cancelled or saving failed. */
export async function saveNow(options: { saveAs?: boolean } = {}): Promise<boolean> {
  const { workspace, origin, markSaved, showToast } = useBoardStore.getState();
  if (!isDesktop) {
    showToast("Tarayıcıda yalnız kurtarma kopyası tutuluyor; dosyaya kaydetme masaüstünde.");
    return false;
  }
  try {
    const saved = await saveWorkspace(workspace, origin, options);
    if (!saved) return false;
    if (saved.written !== workspace) {
      // The title now follows the file name. Edits made while saving stay unsaved.
      const title = saved.written.manifest.title;
      useBoardStore.setState((s) => ({
        workspace:
          s.workspace === workspace
            ? saved.written
            : { ...s.workspace, manifest: { ...s.workspace.manifest, title } },
      }));
    }
    markSaved(saved.origin, saved.written);
    if (!isDirty()) clearRecovery();
    if (saved.missingAssets.length > 0) {
      showToast(`Kaydedildi, ancak ${saved.missingAssets.length} resim dosyada yok.`, "error");
    } else {
      showToast("Çalışma alanı kaydedildi.");
    }
    return true;
  } catch (error) {
    showToast(`Kaydedilemedi: ${errorText(error)}`, "error");
    return false;
  }
}

/**
 * Before the open workspace is replaced: nothing to ask when it is saved; otherwise
 * Kaydet / Kaydetme / Vazgeç. Returns whether it is fine to go on.
 */
export async function leaveWorkspace(): Promise<boolean> {
  if (!isDirty()) return true;
  const choice = await askUnsaved("Kaydedilmemiş değişiklikler var. Önce kaydedilsin mi?");
  if (choice === "cancel") return false;
  if (choice === "discard") return true;
  return (await saveNow()) && !isDirty();
}

function load(workspace: Workspace, origin: WorkspaceOrigin | null, notice: string) {
  const { loadWorkspace, showToast } = useBoardStore.getState();
  loadWorkspace(workspace, origin, true);
  clearRecovery();
  showToast(notice);
}

/** Opens a workspace file: the given (already approved) path, or one picked in a dialog. */
export async function openNow(path?: string): Promise<void> {
  if (!(await leaveWorkspace())) return;
  try {
    const result = path ? await readWorkspaceFile(path) : await openWorkspace();
    if (result) load(result.workspace, result.origin, `"${fileTitle(result.origin.path)}" açıldı.`);
  } catch (error) {
    useBoardStore.getState().showToast(`Açılamadı: ${errorText(error)}`, "error");
  }
}

/** A fresh, unsaved workspace with one empty board. */
export async function newNow(): Promise<void> {
  if (!(await leaveWorkspace())) return;
  load(emptyWorkspace(), null, "Yeni çalışma alanı açıldı.");
}

/**
 * Renames the workspace: the file on disk when there is one (never over another file),
 * otherwise just the name it will be saved under.
 */
export async function renameNow(name: string): Promise<void> {
  const { origin, showToast } = useBoardStore.getState();
  const clean = name.trim();
  if (!clean) return;
  try {
    const path = origin ? await renameWorkspaceFile(origin.path, clean) : null;
    const title = path ? fileTitle(path) : clean;
    useBoardStore.setState((s) => {
      const workspace = { ...s.workspace, manifest: { ...s.workspace.manifest, title } };
      // Renaming a saved file changes nothing inside it that needs saving again.
      const wasSaved = s.workspace === s.savedWorkspace;
      return {
        workspace,
        savedWorkspace: wasSaved && path ? workspace : s.savedWorkspace,
        origin: path && s.origin ? { ...s.origin, path } : s.origin,
      };
    });
    if (path) showToast(`Dosya "${title}" olarak yeniden adlandırıldı.`);
  } catch (error) {
    showToast(`Yeniden adlandırılamadı: ${errorText(error)}`, "error");
  }
}

function currentMarkdown(): { markdown: string; title: string; scoped: boolean } {
  const { workspace, activeBoardId, selectedIds } = useBoardStore.getState();
  const board = workspace.boards[activeBoardId];
  // Only ids that still exist count as a selection.
  const present = new Set(board.items.map((i) => i.id));
  const selected = new Set(selectedIds.filter((id) => present.has(id)));
  return {
    markdown: boardToMarkdown(board, selected),
    title: board.title,
    scoped: selected.size > 0,
  };
}

export async function copyMarkdown(): Promise<void> {
  const { showToast } = useBoardStore.getState();
  const { markdown, scoped } = currentMarkdown();
  try {
    await navigator.clipboard.writeText(markdown);
    showToast(scoped ? "Seçim Markdown olarak kopyalandı." : "Pano Markdown olarak kopyalandı.");
  } catch (error) {
    showToast(`Kopyalanamadı: ${errorText(error)}`, "error");
  }
}

export async function saveMarkdown(): Promise<void> {
  const { showToast } = useBoardStore.getState();
  const { markdown, title } = currentMarkdown();
  try {
    if (await saveMarkdownFile(markdown, title)) showToast("Markdown dosyası kaydedildi.");
  } catch (error) {
    showToast(`Kaydedilemedi: ${errorText(error)}`, "error");
  }
}
