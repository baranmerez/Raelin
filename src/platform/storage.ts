import { invoke, isTauri } from "@tauri-apps/api/core";
import { ask } from "@tauri-apps/plugin-dialog";
import { parseWorkspaceFile, serializeWorkspaceFile } from "../model/serialize";
import type { Workspace } from "../model/types";
import { encodeAssets, loadAssets } from "./assets";

export const isDesktop = isTauri();

/** The workspace file and its stamp (size + modification time) when last read or written. */
export interface WorkspaceOrigin {
  path: string;
  stamp: string;
}

export interface SaveResult {
  origin: WorkspaceOrigin;
  /** Pictures the boards use that are not in memory (e.g. lost with unsaved edits). */
  missingAssets: string[];
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

function suggestedName(workspace: Workspace): string {
  return `${workspace.manifest.title.replace(/[\\/:*?"<>|]+/g, "-").trim() || "Raelin"}.raelin`;
}

/**
 * Writes the workspace as one `.raelin` file; asks where when there is no file yet or for
 * "save as". A file that changed outside the app since `origin` was recorded needs an
 * explicit overwrite. Returns null if the user cancelled.
 */
export async function saveWorkspace(
  workspace: Workspace,
  origin: WorkspaceOrigin | null,
  options: { saveAs?: boolean } = {},
): Promise<SaveResult | null> {
  if (!isDesktop) throw new Error("Dosyaya kaydetme yalnız masaüstü uygulamasında çalışır.");
  // A remembered file is reused only while Rust still holds it on its allowlist.
  const known =
    !options.saveAs &&
    origin &&
    (await invoke<boolean>("is_workspace_allowed", { path: origin.path }))
      ? origin
      : null;
  const path =
    known?.path ??
    (await invoke<string | null>("pick_workspace_save", {
      defaultName: suggestedName(workspace),
    }));
  if (!path) return null;

  // A freshly picked file was already confirmed by the save dialog.
  if (known) {
    const onDisk = await invoke<string | null>("probe_workspace_file", { path });
    if (onDisk && onDisk !== known.stamp) {
      const message = "Dosya Raelin dışında değişmiş. Üzerine yazılsın mı?";
      if (!(await confirmAction(message))) return null;
    }
  }

  const { assets, missing } = await encodeAssets(workspace);
  const bytes = new TextEncoder().encode(serializeWorkspaceFile(workspace, assets));
  const stamp = await invoke<string>("write_workspace_file", bytes, {
    headers: { "x-path": encodeURIComponent(path) },
  });
  return { origin: { path, stamp }, missingAssets: missing };
}

/** Reads and validates a workspace file the user picked (or Raelin remembered). */
export async function readWorkspaceFile(
  path: string,
): Promise<{ workspace: Workspace; origin: WorkspaceOrigin }> {
  // Stamp first: if the file changes in between, the next save warns instead of not.
  const stamp = (await invoke<string | null>("probe_workspace_file", { path })) ?? "";
  const bytes = await invoke<ArrayBuffer>("read_workspace_file", { path });
  const { workspace, assets } = parseWorkspaceFile(new TextDecoder().decode(bytes));
  loadAssets(assets);
  return { workspace, origin: { path, stamp } };
}

export async function openWorkspace(): Promise<{
  workspace: Workspace;
  origin: WorkspaceOrigin;
} | null> {
  if (!isDesktop) throw new Error("Dosya açma yalnız masaüstü uygulamasında çalışır.");
  const path = await invoke<string | null>("pick_workspace_open");
  if (!path) return null;
  return readWorkspaceFile(path);
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
 * Crash-recovery copy of unsaved edits only (without pictures); the workspace file stays
 * the real record.
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
    if (!data.workspace?.manifest) return null;
    // Copies from the folder-based format carry no file path; keep the work, drop the origin.
    const origin = typeof data.origin?.path === "string" ? data.origin : null;
    return { workspace: data.workspace, origin };
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

/** The `.raelin` file Raelin was started with (double-click), once; null otherwise. */
export async function readLaunchPath(): Promise<string | null> {
  if (!isDesktop) return null;
  try {
    return await invoke<string | null>("launch_file");
  } catch {
    return null;
  }
}

/** Last workspace file Raelin itself read or wrote (stored by Rust, not by the page). */
export async function readLastPath(): Promise<string | null> {
  if (!isDesktop) return null;
  try {
    return await invoke<string | null>("last_workspace_file");
  } catch {
    return null;
  }
}
