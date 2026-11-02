import { invoke, isTauri } from "@tauri-apps/api/core";
import { ask, open, save } from "@tauri-apps/plugin-dialog";
import { parseWorkspace, serializeBoard, serializeManifest } from "../model/serialize";
import type { Workspace } from "../model/types";

export const isDesktop = isTauri();

interface WorkspaceFiles {
  manifest: string;
  boards: { id: string; content: string }[];
}

/** Where a workspace lives and what its files looked like when we last read or wrote them. */
export interface WorkspaceOrigin {
  dir: string;
  fingerprint: string;
}

/** Text identity of a workspace folder; equal fingerprints mean nobody changed the files. */
export function fingerprintFiles(files: WorkspaceFiles): string {
  const boards = [...files.boards].sort((a, b) => (a.id < b.id ? -1 : 1));
  return [files.manifest, ...boards.map((b) => `${b.id}\n${b.content}`)].join("\u0000");
}

function toFiles(workspace: Workspace): WorkspaceFiles {
  const manifest = {
    ...workspace.manifest,
    boards: workspace.manifest.boards.map((b) => ({
      id: b.id,
      title: workspace.boards[b.id]?.title ?? b.title,
    })),
  };
  return {
    manifest: serializeManifest(manifest),
    boards: manifest.boards.map(({ id }) => ({
      id,
      content: serializeBoard(workspace.boards[id]),
    })),
  };
}

export async function confirmAction(message: string): Promise<boolean> {
  if (!isDesktop) return window.confirm(message);
  return ask(message, {
    title: "Raelin",
    kind: "warning",
    okLabel: "Devam",
    cancelLabel: "Vazgeç",
  });
}

/**
 * Writes the workspace folder; asks for a folder when none is known yet. Before writing it
 * checks what is on disk: another workspace in a newly picked folder, or files changed
 * outside the app since `origin` was recorded, both need an explicit overwrite.
 * Returns null if the user cancelled.
 */
export async function saveWorkspace(
  workspace: Workspace,
  origin: WorkspaceOrigin | null,
): Promise<WorkspaceOrigin | null> {
  if (!isDesktop) throw new Error("Klasöre kaydetme yalnız masaüstü uygulamasında çalışır.");
  const dir =
    origin?.dir ?? (await open({ directory: true, title: "Çalışma alanı klasörünü seç" }));
  if (typeof dir !== "string") return null;

  const onDisk = await invoke<WorkspaceFiles | null>("probe_workspace", { dir });
  if (onDisk) {
    const known = origin?.dir === dir ? origin.fingerprint : null;
    if (fingerprintFiles(onDisk) !== known) {
      const message = known
        ? "Klasördeki dosyalar Raelin dışında değişmiş (ör. git pull). Üzerine yazılsın mı?"
        : "Bu klasörde zaten bir çalışma alanı var. Üzerine yazılsın mı?";
      if (!(await confirmAction(message))) return null;
    }
  }

  const files = toFiles(workspace);
  await invoke("write_workspace", { dir, manifest: files.manifest, boards: files.boards });
  rememberLastDir(dir);
  return { dir, fingerprint: fingerprintFiles(files) };
}

export async function readWorkspaceAt(
  dir: string,
): Promise<{ workspace: Workspace; origin: WorkspaceOrigin }> {
  const files = await invoke<WorkspaceFiles>("read_workspace", { dir });
  const boards = Object.fromEntries(files.boards.map((b) => [b.id, b.content]));
  rememberLastDir(dir);
  return {
    workspace: parseWorkspace(files.manifest, boards),
    origin: { dir, fingerprint: fingerprintFiles(files) },
  };
}

export async function openWorkspace(): Promise<{
  workspace: Workspace;
  origin: WorkspaceOrigin;
} | null> {
  if (!isDesktop) throw new Error("Klasör açma yalnız masaüstü uygulamasında çalışır.");
  const dir = await open({ directory: true, title: "Çalışma alanı klasörünü aç" });
  if (typeof dir !== "string") return null;
  return readWorkspaceAt(dir);
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
const lastDirKey = "raelin.lastDir";

interface Recovery {
  workspace: Workspace;
  origin: WorkspaceOrigin | null;
}

/**
 * Crash-recovery copy of unsaved edits only; the workspace folder stays the real record.
 * Written while the workspace is dirty and cleared once it is saved.
 */
export function writeRecovery(workspace: Workspace, origin: WorkspaceOrigin | null): void {
  try {
    localStorage.setItem(recoveryKey, JSON.stringify({ workspace, origin, savedAt: Date.now() }));
  } catch {
    // Storage can be full or blocked; recovery is best effort.
  }
}

export function readRecovery(): Recovery | null {
  try {
    const raw = localStorage.getItem(recoveryKey);
    if (!raw) return null;
    const data = JSON.parse(raw) as Recovery;
    return data.workspace?.manifest
      ? { workspace: data.workspace, origin: data.origin ?? null }
      : null;
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

function rememberLastDir(dir: string): void {
  try {
    localStorage.setItem(lastDirKey, dir);
  } catch {
    // ignore
  }
}

export function readLastDir(): string | null {
  try {
    return localStorage.getItem(lastDirKey);
  } catch {
    return null;
  }
}
