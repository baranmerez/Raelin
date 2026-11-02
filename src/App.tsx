import { ReactFlowProvider } from "@xyflow/react";
import { useEffect, useState } from "react";
import { openNow, saveNow } from "./app/actions";
import { BoardTabs } from "./app/BoardTabs";
import { LeftToolbar, toolList } from "./app/LeftToolbar";
import { RightPanel } from "./app/RightPanel";
import { Toast } from "./app/Toast";
import { TopBar } from "./app/TopBar";
import { Canvas } from "./canvas/Canvas";
import { seedWorkspace, stressBoard } from "./model/seed";
import { parseWorkspace, serializeBoard, serializeManifest } from "./model/serialize";
import type { Workspace } from "./model/types";
import { formatVersion } from "./model/types";
import { readRecovery, writeRecovery } from "./platform/storage";
import { useBoardStore } from "./state/boardStore";

const stressCount = Number(new URLSearchParams(window.location.search).get("stress") ?? 0);

/** Recovery data goes through the same parser as files, so a bad copy is never loaded blindly. */
function validRecovery(): { workspace: Workspace; dir: string | null } | null {
  const recovery = readRecovery();
  if (!recovery) return null;
  try {
    const boards = Object.fromEntries(
      Object.values(recovery.workspace.boards).map((b) => [b.id, serializeBoard(b)]),
    );
    return {
      workspace: parseWorkspace(serializeManifest(recovery.workspace.manifest), boards),
      dir: recovery.dir,
    };
  } catch {
    return null;
  }
}

function initialWorkspace(): { workspace: Workspace; dir: string | null } {
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
      dir: null,
    };
  }
  return validRecovery() ?? { workspace: seedWorkspace(), dir: null };
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
    const unsubscribe = useBoardStore.subscribe((state, previous) => {
      if (state.workspace === previous.workspace) return;
      clearTimeout(timer);
      timer = setTimeout(() => writeRecovery(state.workspace, state.workspaceDir), 800);
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
    const { workspace, dir } = initialWorkspace();
    useBoardStore.getState().loadWorkspace(workspace, dir);
    setReady(true);
  }, []);

  useShortcuts();
  useRecoveryAutosave(ready && stressCount === 0);

  if (!ready) return null;

  return (
    <div className="app">
      <TopBar />
      <BoardTabs />
      <div className="workbench">
        <LeftToolbar />
        <ReactFlowProvider>
          <Canvas stress={stressCount > 0} />
        </ReactFlowProvider>
        <RightPanel />
      </div>
      <Toast />
    </div>
  );
}
