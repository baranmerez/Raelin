import { newId } from "../model/ids";
import type { ImageItem } from "../model/types";
import { addAsset, assetExtension, maxAssetBytes } from "../platform/assets";
import { useBoardStore } from "../state/boardStore";

/** Longest side of a newly placed picture; it can be resized afterwards. */
const placedSize = 480;

/**
 * Decodes a pasted or dropped picture, keeps its bytes as a pending asset and returns
 * an image item centred on (x, y). Throws with a readable message for bad input.
 */
async function imageItem(file: Blob, x: number, y: number): Promise<ImageItem> {
  if (!assetExtension(file.type)) throw new Error("Yalnız PNG, JPEG, WebP ve GIF eklenebilir.");
  if (file.size > maxAssetBytes) throw new Error("Resim 10 MB'tan büyük olamaz.");
  const bitmap = await createImageBitmap(file).catch(() => {
    throw new Error("Resim okunamadı.");
  });
  const scale = Math.min(1, placedSize / Math.max(bitmap.width, bitmap.height));
  const width = Math.max(48, Math.round(bitmap.width * scale));
  const height = Math.max(48, Math.round(bitmap.height * scale));
  bitmap.close();
  const name = file instanceof File ? file.name.replace(/\.[^.]+$/, "") : "";
  return {
    id: newId("img"),
    kind: "image",
    src: addAsset(file),
    alt: name.slice(0, 200),
    x: Math.round(x - width / 2),
    y: Math.round(y - height / 2),
    width,
    height,
  };
}

/** Adds pictures as one undo step, cascading them a little, and selects them. */
export async function insertImages(files: Blob[], x: number, y: number): Promise<void> {
  const store = useBoardStore.getState();
  const items: ImageItem[] = [];
  for (const [index, file] of files.entries()) {
    try {
      items.push(await imageItem(file, x + index * 32, y + index * 32));
    } catch (error) {
      store.showToast(error instanceof Error ? error.message : String(error), "error");
    }
  }
  if (items.length === 0) return;
  store.commit((b) => ({ ...b, items: [...b.items, ...items] }));
  store.setSelection(items.map((i) => i.id).sort());
}

export function imageFiles(data: DataTransfer): File[] {
  return [...data.files].filter((f) => f.type.startsWith("image/"));
}
