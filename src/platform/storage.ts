import { invoke, isTauri } from "@tauri-apps/api/core";
import { ask } from "@tauri-apps/plugin-dialog";
import { parseWorkspace, serializeBoard, serializeManifest } from "../model/serialize";
import type { Workspace } from "../model/types";
import { flushAssets } from "./assets";

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

export interface SaveResult {
  origin: WorkspaceOrigin;
  /** Pictures the boards use that were found neither in memory nor in the old folder. */
  missingAssets: string[];
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
 * Pictures are written first, so a board on disk never names a file that is not there.
 * Returns null if the user cancelled.
 */
export async function saveWorkspace(
  workspace: Workspace,
  origin: WorkspaceOrigin | null,
): Promise<SaveResult | null> {
  if (!isDesktop) throw new Error("Klasöre kaydetme yalnız masaüstü uygulamasında çalışır.");
  // A remembered folder is reused only while Rust still holds it on its allowlist.
  const known =
    origin && (await invoke<boolean>("is_dir_allowed", { dir: origin.dir })) ? origin : null;
  const dir = known?.dir ?? (await pickWorkspaceDir("Çalışma alanı klasörünü seç"));
  if (!dir) return null;

  const onDisk = await invoke<WorkspaceFiles | null>("probe_workspace", { dir });
  if (onDisk) {
    // Re-picking the remembered folder still compares against what we last saw there.
    const expected = origin?.dir === dir ? origin.fingerprint : null;
    if (fingerprintFiles(onDisk) !== expected) {
      const message = expected
        ? "Klasördeki dosyalar Raelin dışında değişmiş (ör. git pull). Üzerine yazılsın mı?"
        : "Bu klasörde zaten bir çalışma alanı var. Üzerine yazılsın mı?";
      if (!(await confirmAction(message))) return null;
    }
  }

  const missingAssets = await flushAssets(workspace, origin?.dir ?? null, dir);
  const files = toFiles(workspace);
  await invoke("write_workspace", { dir, manifest: files.manifest, boards: files.boards });
  return { origin: { dir, fingerprint: fingerprintFiles(files) }, missingAssets };
}

export async function readWorkspaceAt(
  dir: string,
): Promise<{ workspace: Workspace; origin: WorkspaceOrigin }> {
  const files = await invoke<WorkspaceFiles>("read_workspace", { dir });
  const boards = Object.fromEntries(files.boards.map((b) => [b.id, b.content]));
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
  const dir = await pickWorkspaceDir("Çalışma alanı klasörünü aç");
  if (!dir) return null;
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
  const path = await invoke<string | null>("pick_markdown_file", { defaultName: fileName });
  if (!path) return false;
  await invoke("write_markdown", { path, content: markdown });
  return true;
}

const recoveryKey = "raelin.recovery.v1";

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

/** Native folder picker in Rust; the picked folder joins Rust's allowlist for this run. */
async function pickWorkspaceDir(title: string): Promise<string | null> {
  return invoke<string | null>("pick_workspace_dir", { title });
}

/** Last folder Raelin itself read or wrote (stored by Rust, not by the page). */
export async function readLastDir(): Promise<string | null> {
  if (!isDesktop) return null;
  try {
    return await invoke<string | null>("last_workspace_dir");
  } catch {
    return null;
  }
}
