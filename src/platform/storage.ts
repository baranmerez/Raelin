import { invoke, isTauri } from "@tauri-apps/api/core";
import { ask, message } from "@tauri-apps/plugin-dialog";
import { parseWorkspaceFile, serializeWorkspaceFile } from "../model/serialize";
import type { Workspace } from "../model/types";
import { fileTitle } from "../model/workspace";
import { encodeAssets, loadAssets } from "./assets";

export const isDesktop = isTauri();

/** The workspace file and its stamp (size + modification time) when last read or written. */
export interface WorkspaceOrigin {
  path: string;
  stamp: string;
}

export interface SaveResult {
  origin: WorkspaceOrigin;
  /** The workspace as written: its title follows the file name. */
  written: Workspace;
  /** Pictures the boards use that are not in memory (e.g. lost with unsaved edits). */
  missingAssets: string[];
}

export async function confirmAction(text: string): Promise<boolean> {
  if (!isDesktop) return window.confirm(text);
  return ask(text, {
    title: "Raelin",
    kind: "warning",
    okLabel: "Devam",
    cancelLabel: "Vazgeç",
  });
}

export type UnsavedChoice = "save" | "discard" | "cancel";

/** Kaydet / Kaydetme / Vazgeç before unsaved work would be replaced or closed. */
export async function askUnsaved(text: string): Promise<UnsavedChoice> {
  if (!isDesktop) {
    return window.confirm(`${text} Kaydetmeden devam edilsin mi?`) ? "discard" : "cancel";
  }
  const labels = { yes: "Kaydet", no: "Kaydetme", cancel: "Vazgeç" };
  const answer = await message(text, { title: "Raelin", kind: "warning", buttons: labels });
  // Custom buttons answer with their label; keep the default names as a fallback.
  if (answer === labels.yes || answer === "Yes") return "save";
  if (answer === labels.no || answer === "No") return "discard";
  return "cancel";
}

function suggestedName(workspace: Workspace): string {
  return `${workspace.manifest.title.replace(/[\\/:*?"<>|]+/g, "-").trim() || "Raelin"}.rli`;
}

/**
 * Writes the workspace as one `.rli` file; asks where when there is no file yet or for
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

  // The file name is the workspace's name, also inside the file.
  const title = fileTitle(path);
  const written =
    workspace.manifest.title === title
      ? workspace
      : { ...workspace, manifest: { ...workspace.manifest, title } };
  const { assets, missing } = await encodeAssets(written);
  const bytes = new TextEncoder().encode(serializeWorkspaceFile(written, assets));
  const stamp = await invoke<string>("write_workspace_file", bytes, {
    headers: { "x-path": encodeURIComponent(path) },
  });
  return { origin: { path, stamp }, written, missingAssets: missing };
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

/** The `.rli` file Raelin was started with (double-click), once; null otherwise. */
export async function readLaunchPath(): Promise<string | null> {
  if (!isDesktop) return null;
  try {
    return await invoke<string | null>("launch_file");
  } catch {
    return null;
  }
}

/** Recent workspace files, newest first, approved by Rust for this run. */
export async function readRecentPaths(): Promise<string[]> {
  if (!isDesktop) return [];
  try {
    return await invoke<string[]>("recent_workspaces");
  } catch {
    return [];
  }
}

/** Renames the workspace file in its folder; returns the new path. */
export function renameWorkspaceFile(path: string, name: string): Promise<string> {
  return invoke<string>("rename_workspace_file", { path, name });
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
