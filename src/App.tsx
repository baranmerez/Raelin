import { ReactFlowProvider } from "@xyflow/react";
import { useEffect, useState } from "react";
import { openNow, saveNow } from "./app/actions";
import { BoardTabs } from "./app/BoardTabs";
import { LeftToolbar, toolList } from "./app/LeftToolbar";
import { RightPanel } from "./app/RightPanel";
import { Toast } from "./app/Toast";
import { TopBar } from "./app/TopBar";
import { Canvas } from "./canvas/Canvas";
import { startMcpHost } from "./mcp/connection";
import { seedWorkspace, stressBoard } from "./model/seed";
import { parseWorkspace, serializeBoard, serializeManifest } from "./model/serialize";
import type { Workspace } from "./model/types";
import { formatVersion } from "./model/types";
import {
  clearRecovery,
  readLastDir,
  readRecovery,
  readWorkspaceAt,
  type WorkspaceOrigin,
  writeRecovery,
} from "./platform/storage";
import { useBoardStore } from "./state/boardStore";

const stressCount = Number(new URLSearchParams(window.location.search).get("stress") ?? 0);

interface Startup {
  workspace: Workspace;
  origin: WorkspaceOrigin | null;
  saved: boolean;
  notice?: string;
}

/** Recovery data goes through the same parser as files, so a bad copy is never loaded blindly. */
function validRecovery(): Startup | null {
  const recovery = readRecovery();
  if (!recovery) return null;
  try {
    const boards = Object.fromEntries(
      Object.values(recovery.workspace.boards).map((b) => [b.id, serializeBoard(b)]),
    );
    return {
      workspace: parseWorkspace(serializeManifest(recovery.workspace.manifest), boards),
      // The stored fingerprint lets the next save notice if the folder changed meanwhile.
      origin: recovery.origin,
      saved: false,
      notice: "Kaydedilmemiş değişiklikler kurtarıldı. Kaydetmeyi unutma.",
    };
  } catch {
    return null;
  }
}

/**
 * Startup order: unsaved edits from a crash first (kept dirty, never written silently),
 * then the last folder from disk, then the example workspace.
 */
async function initialWorkspace(): Promise<Startup> {
  if (stressCount > 0) {
    const board = stressBoard(stressCount);
    return {
      workspace: {
        manifest: {
          formatVersion,
          title: "Performans",
          boards: [{ id: board.id, title: board.title }],
        },
        boards: { [board.id]: board },
      },
      origin: null,
      saved: true,
    };
  }
  const recovered = validRecovery();
  if (recovered) return recovered;
  const lastDir = await readLastDir();
  if (lastDir) {
    try {
      const { workspace, origin } = await readWorkspaceAt(lastDir);
      return { workspace, origin, saved: true };
    } catch {
      // Folder moved or broken: fall back to the example instead of failing to start.
    }
  }
  return { workspace: seedWorkspace(), origin: null, saved: true };
}

function isTyping(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  return !!el && (el.isContentEditable || el.tagName === "INPUT" || el.tagName === "TEXTAREA");
}

function useShortcuts() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const s = useBoardStore.getState();
      const mod = e.ctrlKey || e.metaKey;
      if (mod && e.key.toLowerCase() === "s") {
        e.preventDefault();
        void saveNow();
        return;
      }
      if (mod && e.key.toLowerCase() === "o") {
        e.preventDefault();
        void openNow();
        return;
      }
      if (isTyping(e.target)) return;
      if (mod && e.key.toLowerCase() === "z") {
        e.preventDefault();
        if (e.shiftKey) s.redo();
        else s.undo();
      } else if (mod && e.key.toLowerCase() === "y") {
        e.preventDefault();
        s.redo();
      } else if (e.key === "Escape") {
        s.setTool("select");
      } else if (!mod && !e.altKey) {
        const entry = toolList.find((t) => t.key === e.key.toUpperCase());
        if (entry) s.setTool(entry.tool);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
}

function useRecoveryAutosave(enabled: boolean) {
  useEffect(() => {
    if (!enabled) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    // Only unsaved edits are mirrored; loading or saving a workspace never writes a copy.
    const unsubscribe = useBoardStore.subscribe((state, previous) => {
      if (
        state.workspace === previous.workspace &&
        state.savedWorkspace === previous.savedWorkspace
      ) {
        return;
      }
      clearTimeout(timer);
      if (state.workspace === state.savedWorkspace) return;
      timer = setTimeout(() => {
        const latest = useBoardStore.getState();
        if (latest.workspace === latest.savedWorkspace) clearRecovery();
        else writeRecovery(latest.workspace, latest.origin);
      }, 800);
    });
    return () => {
      clearTimeout(timer);
      unsubscribe();
    };
  }, [enabled]);
}

export default function App() {
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void initialWorkspace().then(({ workspace, origin, saved, notice }) => {
      if (cancelled) return;
      const store = useBoardStore.getState();
      store.loadWorkspace(workspace, origin, saved);
      if (notice) store.showToast(notice);
      setReady(true);
      // Accept AI clients only once a workspace is loaded.
      void startMcpHost().catch((error) =>
        store.showToast(`MCP başlatılamadı: ${String(error)}`, "error"),
      );
    });
    return () => {
      cancelled = true;
    };
  }, []);

  useShortcuts();
  useRecoveryAutosave(ready && stressCount === 0);

  if (!ready) return null;

  return (
    <div className="app">
      {/* Panel and top bar read canvas state (node sizes, export), so the provider wraps all. */}
      <ReactFlowProvider>
        <TopBar />
        <BoardTabs />
        <div className="workbench">
          <LeftToolbar />
          <Canvas stress={stressCount > 0} />
          <RightPanel />
        </div>
      </ReactFlowProvider>
      <Toast />
    </div>
  );
}
