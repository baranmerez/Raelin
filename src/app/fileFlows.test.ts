import { beforeEach, describe, expect, it, vi } from "vitest";
import { makeFlowNode } from "../model/factory";
import { emptyWorkspace, fileTitle } from "../model/workspace";
import { useBoardStore } from "../state/boardStore";

const answer = vi.hoisted(() => ({ choice: "cancel" as "save" | "discard" | "cancel" }));

vi.mock("../platform/storage", async (original) => ({
  ...(await original<typeof import("../platform/storage")>()),
  isDesktop: false,
  askUnsaved: vi.fn(async () => answer.choice),
  clearRecovery: vi.fn(),
}));

const { leaveWorkspace, newNow } = await import("./actions");

describe("workspace names", () => {
  it("come from the file name", () => {
    expect(fileTitle(String.raw`C:\example\Plan v2.rli`)).toBe("Plan v2");
    expect(fileTitle("C:/example/notes.RLI")).toBe("notes");
  });

  it("start a new workspace with one empty board", () => {
    const workspace = emptyWorkspace();
    expect(workspace.manifest.title).toBe("Adsız");
    expect(workspace.manifest.boards).toHaveLength(1);
    expect(Object.values(workspace.boards)[0].items).toHaveLength(0);
  });
});

describe("leaving unsaved work", () => {
  beforeEach(() => {
    useBoardStore.getState().loadWorkspace(emptyWorkspace("Deneme"), null, true);
  });

  const makeDirty = () =>
    useBoardStore
      .getState()
      .commit((b) => ({ ...b, items: [...b.items, makeFlowNode("process", 0, 0)] }));

  it("goes on without asking when everything is saved", async () => {
    answer.choice = "cancel";
    expect(await leaveWorkspace()).toBe(true);
  });

  it("stays on Vazgeç and goes on with Kaydetme", async () => {
    makeDirty();
    answer.choice = "cancel";
    expect(await leaveWorkspace()).toBe(false);
    answer.choice = "discard";
    expect(await leaveWorkspace()).toBe(true);
  });

  it("does not leave when saving is not possible", async () => {
    makeDirty();
    answer.choice = "save";
    // The browser build cannot save to a file, so the work must stay.
    expect(await leaveWorkspace()).toBe(false);
  });

  it("opens an empty, saved workspace with Yeni", async () => {
    makeDirty();
    answer.choice = "discard";
    await newNow();
    const s = useBoardStore.getState();
    expect(s.workspace.manifest.title).toBe("Adsız");
    expect(s.workspace).toBe(s.savedWorkspace);
    expect(s.origin).toBeNull();
  });
});
