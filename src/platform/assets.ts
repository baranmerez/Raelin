import { newId } from "../model/ids";
import type { AssetData } from "../model/serialize";
import type { Workspace } from "../model/types";

/**
 * Picture bytes for image items, kept in memory for the open workspace. The `.rli`
 * file carries them as base64: loaded on open, written back on every save.
 */

export const maxAssetBytes = 10 * 1024 * 1024;

const extensions: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
  "image/gif": "gif",
};
const mimeOf: Record<string, string> = Object.fromEntries(
  Object.entries(extensions).map(([mime, ext]) => [ext, mime]),
);

const blobs = new Map<string, Blob>();
const urls = new Map<string, string>();

export function assetExtension(type: string): string | null {
  return extensions[type] ?? null;
}

/** Keeps a new picture and returns its asset name. */
export function addAsset(blob: Blob): string {
  const ext = assetExtension(blob.type);
  if (!ext) throw new Error("Desteklenmeyen resim türü.");
  if (blob.size > maxAssetBytes) throw new Error("Resim 10 MB'tan büyük olamaz.");
  const name = `${newId("img")}.${ext}`;
  blobs.set(name, blob);
  return name;
}

/** Display URL for a picture, or null when the workspace does not have it. */
export function assetUrl(name: string): string | null {
  const cached = urls.get(name);
  if (cached) return cached;
  const blob = blobs.get(name);
  if (!blob) return null;
  const url = URL.createObjectURL(blob);
  urls.set(name, url);
  return url;
}

function fromBase64(text: string, type: string): Blob {
  const binary = atob(text);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new Blob([bytes], { type });
}

function toBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const url = String(reader.result);
      resolve(url.slice(url.indexOf(",") + 1));
    };
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

/**
 * Pictures from an opened file. They are added to what is in memory: an undo may bring
 * back an image from the workspace that was open before.
 */
export function loadAssets(assets: AssetData): void {
  for (const [name, data] of Object.entries(assets)) {
    if (blobs.has(name)) continue;
    const ext = name.slice(name.lastIndexOf(".") + 1);
    blobs.set(name, fromBase64(data, mimeOf[ext] ?? "application/octet-stream"));
  }
}

/**
 * Base64 of every picture the workspace uses, for writing the file. Pictures no board
 * uses any more are left out; names that are used but unknown come back as `missing`.
 */
export async function encodeAssets(
  workspace: Workspace,
): Promise<{ assets: AssetData; missing: string[] }> {
  const names = new Set<string>();
  for (const board of Object.values(workspace.boards)) {
    for (const item of board.items) if (item.kind === "image") names.add(item.src);
  }
  const assets: AssetData = {};
  const missing: string[] = [];
  for (const name of [...names].sort()) {
    const blob = blobs.get(name);
    if (blob) assets[name] = await toBase64(blob);
    else missing.push(name);
  }
  return { assets, missing };
}
