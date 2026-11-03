import { invoke } from "@tauri-apps/api/core";
import { newId } from "../model/ids";
import type { Workspace } from "../model/types";
import { isDesktop } from "./storage";

/**
 * Picture bytes for image items. A new picture stays in memory until the next save
 * writes it to `assets/` in the workspace folder; saved pictures are read lazily from
 * there. Object URLs are cached per file name for the whole run.
 */

export const maxAssetBytes = 10 * 1024 * 1024;

const extensions: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
  "image/gif": "gif",
};

const pending = new Map<string, Blob>();
const urls = new Map<string, Promise<string | null>>();

export function assetExtension(type: string): string | null {
  return extensions[type] ?? null;
}

/** Keeps a new picture in memory and returns its asset file name. */
export function addAsset(blob: Blob): string {
  const ext = assetExtension(blob.type);
  if (!ext) throw new Error("Desteklenmeyen resim türü.");
  if (blob.size > maxAssetBytes) throw new Error("Resim 10 MB'tan büyük olamaz.");
  const name = `${newId("img")}.${ext}`;
  pending.set(name, blob);
  urls.set(name, Promise.resolve(URL.createObjectURL(blob)));
  return name;
}

/** Display URL for a picture, or null when it cannot be found. */
export function assetUrl(name: string, dir: string | null): Promise<string | null> {
  const cached = urls.get(name);
  if (cached) return cached;
  if (!isDesktop || !dir) return Promise.resolve(null);
  const loading = invoke<ArrayBuffer>("read_asset", { dir, name })
    .then((bytes) => URL.createObjectURL(new Blob([bytes])))
    .catch(() => {
      // Let a later render retry, e.g. after the file was restored.
      urls.delete(name);
      return null;
    });
  urls.set(name, loading);
  return loading;
}

function referencedAssets(workspace: Workspace): string[] {
  const names = new Set<string>();
  for (const board of Object.values(workspace.boards)) {
    for (const item of board.items) if (item.kind === "image") names.add(item.src);
  }
  return [...names];
}

/**
 * Makes sure every picture the workspace uses is in `toDir` before its boards are
 * written: new ones are written from memory, older ones are copied over from the folder
 * they were opened from. Returns the names that could not be found anywhere.
 */
export async function flushAssets(
  workspace: Workspace,
  fromDir: string | null,
  toDir: string,
): Promise<string[]> {
  const names = referencedAssets(workspace);
  const stored: string[] = [];
  for (const name of names) {
    const blob = pending.get(name);
    if (!blob) {
      stored.push(name);
      continue;
    }
    await invoke("write_asset", new Uint8Array(await blob.arrayBuffer()), {
      headers: { "x-dir": encodeURIComponent(toDir), "x-name": encodeURIComponent(name) },
    });
    pending.delete(name);
  }
  if (stored.length === 0) return [];
  if (!fromDir || fromDir === toDir) return [];
  return invoke<string[]>("copy_assets", { from: fromDir, to: toDir, names: stored });
}
