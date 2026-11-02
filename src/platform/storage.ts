import { invoke, isTauri } from "@tauri-apps/api/core";
import { open, save } from "@tauri-apps/plugin-dialog";
import { parseWorkspace, serializeBoard, serializeManifest } from "../model/serialize";
import type { Workspace } from "../model/types";

export const isDesktop = isTauri();

interface WorkspaceFiles {
  manifest: string;
  boards: { id: string; content: string }[];
}

/** Writes the workspace folder; asks for a folder when none is known yet. Returns null if cancelled. */
export async function saveWorkspace(
  workspace: Workspace,
  dir: string | null,
): Promise<string | null> {
  if (!isDesktop) throw new Error("Klasöre kaydetme yalnız masaüstü uygulamasında çalışır.");
  const target = dir ?? (await open({ directory: true, title: "Çalışma alanı klasörünü seç" }));
  if (typeof target !== "string") return null;
  const manifest = {
    ...workspace.manifest,
    boards: workspace.manifest.boards.map((b) => ({
      id: b.id,
      title: workspace.boards[b.id]?.title ?? b.title,
    })),
  };
  await invoke("write_workspace", {
    dir: target,
    manifest: serializeManifest(manifest),
    boards: manifest.boards.map(({ id }) => ({
      id,
      content: serializeBoard(workspace.boards[id]),
    })),
  });
  return target;
}

export async function openWorkspace(): Promise<{ workspace: Workspace; dir: string } | null> {
  if (!isDesktop) throw new Error("Klasör açma yalnız masaüstü uygulamasında çalışır.");
  const dir = await open({ directory: true, title: "Çalışma alanı klasörünü aç" });
  if (typeof dir !== "string") return null;
  const files = await invoke<WorkspaceFiles>("read_workspace", { dir });
  const boards = Object.fromEntries(files.boards.map((b) => [b.id, b.content]));
  return { workspace: parseWorkspace(files.manifest, boards), dir };
}

export async function saveMarkdownFile(markdown: string, suggestedName: string): Promise<boolean> {
  const fileName = `${suggestedName.replace(/[\\/:*?"<>|]+/g, "-").trim() || "raelin"}.md`;
  if (!isDesktop) {
    const url = URL.createObjectURL(new Blob([markdown], { type: "text/markdown" }));
    const link = Object.assign(document.createElement("a"), { href: url, download: fileName });
    link.click();
    URL.revokeObjectURL(url);
    return true;
  }
  const path = await save({
    defaultPath: fileName,
    filters: [{ name: "Markdown", extensions: ["md"] }],
  });
  if (!path) return false;
  await invoke("write_markdown", { path, content: markdown });
  return true;
}

const recoveryKey = "raelin.recovery.v1";

/** Crash-recovery copy only; the workspace folder stays the real record. */
export function writeRecovery(workspace: Workspace, dir: string | null): void {
  try {
    localStorage.setItem(recoveryKey, JSON.stringify({ workspace, dir, savedAt: Date.now() }));
  } catch {
    // Storage can be full or blocked; recovery is best effort.
  }
}

export function readRecovery(): { workspace: Workspace; dir: string | null } | null {
  try {
    const raw = localStorage.getItem(recoveryKey);
    if (!raw) return null;
    const data = JSON.parse(raw) as { workspace: Workspace; dir: string | null };
    return data.workspace?.manifest ? data : null;
  } catch {
    return null;
  }
}

export function clearRecovery(): void {
  try {
    localStorage.removeItem(recoveryKey);
  } catch {
    // ignore
  }
}
