import { boardToMarkdown } from "../model/markdown";
import { FormatError } from "../model/serialize";
import {
  clearRecovery,
  confirmAction,
  isDesktop,
  openWorkspace,
  readWorkspaceFile,
  saveMarkdownFile,
  saveWorkspace,
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

export async function saveNow(options: { saveAs?: boolean } = {}): Promise<void> {
  const { workspace, origin, markSaved, showToast } = useBoardStore.getState();
  if (!isDesktop) {
    showToast("Tarayıcıda yalnız kurtarma kopyası tutuluyor; dosyaya kaydetme masaüstünde.");
    return;
  }
  try {
    const saved = await saveWorkspace(workspace, origin, options);
    if (!saved) return;
    markSaved(saved.origin, workspace);
    if (!isDirty()) clearRecovery();
    if (saved.missingAssets.length > 0) {
      showToast(`Kaydedildi, ancak ${saved.missingAssets.length} resim dosyada yok.`, "error");
    } else {
      showToast("Çalışma alanı kaydedildi.");
    }
  } catch (error) {
    showToast(`Kaydedilemedi: ${errorText(error)}`, "error");
  }
}

/** Opens a workspace file: the given (already approved) path, or one picked in a dialog. */
export async function openNow(path?: string): Promise<void> {
  const { loadWorkspace, showToast } = useBoardStore.getState();
  if (
    isDirty() &&
    !(await confirmAction("Kaydedilmemiş değişiklikler kaybolacak. Yine de açılsın mı?"))
  ) {
    return;
  }
  try {
    const result = path ? await readWorkspaceFile(path) : await openWorkspace();
    if (!result) return;
    loadWorkspace(result.workspace, result.origin, true);
    clearRecovery();
    showToast("Çalışma alanı açıldı.");
  } catch (error) {
    showToast(`Açılamadı: ${errorText(error)}`, "error");
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
