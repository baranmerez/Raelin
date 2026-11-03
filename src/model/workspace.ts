import { emptyBoard } from "./factory";
import type { Workspace } from "./types";
import { formatVersion } from "./types";

export const untitledName = "Adsız";

/** A fresh workspace with one empty board, as "Yeni" opens it. */
export function emptyWorkspace(title = untitledName): Workspace {
  const board = emptyBoard("Pano 1");
  return {
    manifest: { formatVersion, title, boards: [{ id: board.id, title: board.title }] },
    boards: { [board.id]: board },
  };
}

/** "C:\\x\\Plan v2.rli" → "Plan v2"; the file name is the workspace's name. */
export function fileTitle(path: string): string {
  const name = path.slice(Math.max(path.lastIndexOf("\\"), path.lastIndexOf("/")) + 1);
  return name.replace(/\.rli$/i, "");
}
