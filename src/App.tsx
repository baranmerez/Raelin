import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { ReactFlowProvider } from "@xyflow/react";
import { useEffect, useState } from "react";
import { newNow, openNow, saveNow } from "./app/actions";
import { BoardTabs } from "./app/BoardTabs";
import { LeftToolbar, toolList } from "./app/LeftToolbar";
import { RightPanel } from "./app/RightPanel";
import { Toast } from "./app/Toast";
import { TopBar } from "./app/TopBar";
import { Canvas } from "./canvas/Canvas";
import { startMcpHost } from "./mcp/connection";
import { seedWorkspace, stressBoard } from "./model/seed";
import { parseWorkspaceFile, serializeWorkspaceFile } from "./model/serialize";
import type { Workspace } from "./model/types";
import { formatVersion } from "./model/types";
import { emptyWorkspace } from "./model/workspace";
import {
  askUnsaved,
  clearRecovery,
  confirmAction,
  isDesktop,
  readLastPath,
  readLaunchPath,
  readRecovery,
  readWorkspaceFile,
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
    const { workspace } = parseWorkspaceFile(serializeWorkspaceFile(recovery.workspace, {}));
    return {
      workspace,
      // The stored stamp lets the next save notice if the file changed meanwhile.
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
 * then the last workspace file, then the example workspace.
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
  const launchPath = await readLaunchPath();
  if (launchPath) {
    // A double-clicked file wins, but never silently over unsaved edits.
    const name = launchPath.slice(launchPath.lastIndexOf("\\") + 1);
    const leave =
      !recovered ||
      (await confirmAction(
        `Kaydedilmemiş değişiklikler var. Bunları bırakıp "${name}" açılsın mı?`,
      ));
    if (leave) {
      try {
        const { workspace, origin } = await readWorkspaceFile(launchPath);
        // The user chose to leave the recovered edits; they must not come back next start.
        if (recovered) clearRecovery();
        return { workspace, origin, saved: true };
      } catch (error) {
        const fallback = recovered ?? { workspace: firstWorkspace(), origin: null, saved: true };
        return { ...fallback, notice: `"${name}" açılamadı: ${String(error)}` };
      }
    }
  }
  const lastPath = await readLastPath();
  if (recovered) {
    // The recovery copy holds no pictures; take the saved ones from the file it came from.
    if (recovered.origin && recovered.origin.path === lastPath) {
      await readWorkspaceFile(lastPath).catch(() => undefined);
    }
    return recovered;
  }
  if (lastPath) {
    try {
      const { workspace, origin } = await readWorkspaceFile(lastPath);
      return { workspace, origin, saved: true };
    } catch {
      // File moved or broken: fall back to the example instead of failing to start.
    }
  }
  return { workspace: firstWorkspace(), origin: null, saved: true };
}

const welcomedKey = "raelin.welcomed.v1";

/** The example workspace on the very first start, an empty one after that. */
function firstWorkspace(): Workspace {
  try {
    if (localStorage.getItem(welcomedKey)) return emptyWorkspace();
    localStorage.setItem(welcomedKey, "1");
  } catch {
    // Storage blocked: showing the example again is harmless.
  }
  return seedWorkspace();
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
        void saveNow({ saveAs: e.shiftKey });
        return;
      }
      if (mod && !e.shiftKey && e.key.toLowerCase() === "n") {
        e.preventDefault();
        void newNow();
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
        // First Escape leaves a tool, the next one clears the selection.
        if (s.tool === "select") s.setSelection([]);
        else s.setTool("select");
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

/**
 * Closing with unsaved edits asks first. The recovery copy is written right away (the
 * autosave waits 800 ms), but it holds no pictures, so the question says so.
 */
function useCloseGuard(enabled: boolean) {
  useEffect(() => {
    if (!enabled || !isDesktop) return;
    let unlisten: (() => void) | undefined;
    let disposed = false;
    void getCurrentWindow()
      .onCloseRequested(async (event) => {
        const s = useBoardStore.getState();
        if (s.workspace === s.savedWorkspace) return;
        // Written now in case the app is killed while the question is open.
        writeRecovery(s.workspace, s.origin);
        const choice = await askUnsaved(
          "Kaydedilmemiş değişiklikler var. Kapatmadan önce kaydedilsin mi?",
        );
        if (choice === "cancel") event.preventDefault();
        else if (choice === "discard") clearRecovery();
        else if (
          !(await saveNow()) ||
          useBoardStore.getState().workspace !== useBoardStore.getState().savedWorkspace
        ) {
          // Not saved, or changed while saving (e.g. by an AI client): stay open.
          const latest = useBoardStore.getState();
          writeRecovery(latest.workspace, latest.origin);
          event.preventDefault();
        }
      })
      .then((fn) => {
        if (disposed) fn();
        else unlisten = fn;
      });
    return () => {
      disposed = true;
      unlisten?.();
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
      // A .rli file double-clicked while Raelin runs arrives from the second launch.
      if (isDesktop) {
        void listen<string>("workspace:open", (e) => void openNow(e.payload));
      }
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
  useCloseGuard(ready && stressCount === 0);

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
