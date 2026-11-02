import { boardToMarkdown } from "../model/markdown";
import { FormatError } from "../model/serialize";
import {
  clearRecovery,
  isDesktop,
  openWorkspace,
  saveMarkdownFile,
  saveWorkspace,
} from "../platform/storage";
import { useBoardStore } from "../state/boardStore";

function errorText(error: unknown): string {
  if (error instanceof FormatError) return error.message;
  if (error instanceof Error) return error.message;
  return String(error);
}

export async function saveNow(): Promise<void> {
  const { workspace, workspaceDir, setWorkspaceDir, showToast } = useBoardStore.getState();
  if (!isDesktop) {
    showToast("Tarayıcıda yalnız kurtarma kopyası tutuluyor; klasöre kaydetme masaüstünde.");
    return;
  }
  try {
    const dir = await saveWorkspace(workspace, workspaceDir);
    if (!dir) return;
    setWorkspaceDir(dir);
    clearRecovery();
    showToast("Çalışma alanı kaydedildi.");
  } catch (error) {
    showToast(`Kaydedilemedi: ${errorText(error)}`, "error");
  }
}

export async function openNow(): Promise<void> {
  const { loadWorkspace, showToast } = useBoardStore.getState();
  try {
    const result = await openWorkspace();
    if (!result) return;
    loadWorkspace(result.workspace, result.dir);
    showToast("Çalışma alanı açıldı.");
  } catch (error) {
    showToast(`Açılamadı: ${errorText(error)}`, "error");
  }
}

function currentMarkdown(): { markdown: string; title: string; scoped: boolean } {
  const { workspace, activeBoardId, selectedIds } = useBoardStore.getState();
  const board = workspace.boards[activeBoardId];
  const selected = new Set(selectedIds);
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
