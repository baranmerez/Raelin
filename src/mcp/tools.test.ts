import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { emptyBoard, makeFlowNode, makeRegion } from "../model/factory";
import type { BoardDoc, FlowNodeItem, Workspace } from "../model/types";
import { useBoardStore } from "../state/boardStore";

const confirm = vi.hoisted(() => vi.fn(async (_message: string) => true));
vi.mock("../platform/storage", () => ({ confirmAction: confirm, isDesktop: false }));

import { createRaelinServer } from "./tools";

const state = () => useBoardStore.getState();
const revision = (id: string) => state().revisions[id] ?? 0;
const boardIds = () => state().workspace.manifest.boards.map((b) => b.id);

function load(boards: BoardDoc[]) {
  const workspace: Workspace = {
    manifest: {
      formatVersion: 1,
      title: "T",
      boards: boards.map((b) => ({ id: b.id, title: b.title })),
    },
    boards: Object.fromEntries(boards.map((b) => [b.id, b])),
  };
  state().loadWorkspace(workspace, null, true);
  state().selectBoard(boards[0].id);
}

async function connect() {
  const [serverSide, clientSide] = InMemoryTransport.createLinkedPair();
  await createRaelinServer().connect(serverSide);
  const client = new Client({ name: "claude-code", version: "1" });
  await client.connect(clientSide);
  return async (name: string, args: Record<string, unknown> = {}) => {
    const result = (await client.callTool({ name, arguments: args })) as {
      content: { type: string; text?: string }[];
      isError?: boolean;
    };
    const text = result.content[0]?.text;
    return { ...(text ? JSON.parse(text) : {}), isError: result.isError ?? false };
  };
}

let one: BoardDoc;
let two: BoardDoc;
let call: Awaited<ReturnType<typeof connect>>;

beforeEach(async () => {
  confirm.mockReset();
  confirm.mockResolvedValue(true);
  one = emptyBoard("Bir");
  const region = makeRegion(0, 0, "Bölge", "sage");
  one.items = [region, makeFlowNode("process", region.x + 200, region.y + 160, "Adım")];
  two = emptyBoard("İki");
  load([one, two]);
  call = await connect();
});

describe("board tools", () => {
  it("renames with the read revision only, as a labelled undo step", async () => {
    const stale = await call("rename_board", {
      boardId: one.id,
      expectedRevision: revision(one.id) - 1,
      title: "Yeni",
    });
    expect(stale.error).toBe("STALE_REVISION");
    const done = await call("rename_board", {
      boardId: one.id,
      expectedRevision: revision(one.id),
      title: "Yeni",
    });
    expect(done.revision).toBe(revision(one.id));
    expect(state().workspace.boards[one.id].title).toBe("Yeni");
    expect(state().history[one.id].past.at(-1)?.label).toMatch(/^Claude Code: /);
  });

  it("duplicates without switching the view and answers a retried opId once", async () => {
    const first = await call("duplicate_board", { boardId: one.id, opId: "d1" });
    const again = await call("duplicate_board", { boardId: one.id, opId: "d1" });
    expect(again.id).toBe(first.id);
    expect(boardIds()).toEqual([one.id, first.id, two.id]);
    expect(state().activeBoardId).toBe(one.id);
  });

  it("deletes after confirmation, offers a restore and never deletes the last board", async () => {
    const rejected = await (async () => {
      confirm.mockResolvedValueOnce(false);
      return call("delete_board", { boardId: two.id, expectedRevision: revision(two.id) });
    })();
    expect(rejected.error).toBe("REJECTED");
    expect(boardIds()).toContain(two.id);

    const done = await call("delete_board", {
      boardId: two.id,
      expectedRevision: revision(two.id),
    });
    expect(done.deleted).toBe(two.id);
    expect(boardIds()).toEqual([one.id]);
    state().toast?.action?.run();
    expect(boardIds()).toEqual([one.id, two.id]);

    state().deleteBoard(two.id);
    confirm.mockClear();
    const last = await call("delete_board", {
      boardId: one.id,
      expectedRevision: revision(one.id),
    });
    expect(last.error).toBe("INVALID");
    expect(confirm).not.toHaveBeenCalled();
  });

  it("re-checks the revision after the confirm dialog", async () => {
    confirm.mockImplementationOnce(async () => {
      state().renameBoard(two.id, "Kullanıcı değiştirdi");
      return true;
    });
    const result = await call("delete_board", {
      boardId: two.id,
      expectedRevision: revision(two.id),
    });
    expect(result.error).toBe("STALE_REVISION");
    expect(boardIds()).toContain(two.id);
  });
});

describe("copy_items", () => {
  it("copies a region to another board; move needs both revisions and a confirm", async () => {
    const regionId = one.items[0].id;
    const copied = await call("copy_items", {
      fromBoardId: one.id,
      toBoardId: two.id,
      ids: [regionId],
      expectedRevision: revision(two.id),
    });
    expect(Object.keys(copied.ids)).toHaveLength(2);
    expect(state().workspace.boards[two.id].items).toHaveLength(2);
    expect(state().workspace.boards[one.id].items).toHaveLength(2);
    expect(confirm).not.toHaveBeenCalled();

    const noSource = await call("copy_items", {
      fromBoardId: one.id,
      toBoardId: two.id,
      ids: [regionId],
      expectedRevision: revision(two.id),
      move: true,
    });
    expect(noSource.error).toBe("INVALID");

    const moved = await call("copy_items", {
      fromBoardId: one.id,
      toBoardId: two.id,
      ids: [regionId],
      expectedRevision: revision(two.id),
      sourceRevision: revision(one.id),
      move: true,
    });
    expect(confirm).toHaveBeenCalledOnce();
    expect(moved.sourceRevision).toBe(revision(one.id));
    expect(state().workspace.boards[one.id].items).toHaveLength(0);
    expect(state().workspace.boards[two.id].items).toHaveLength(4);
  });
});

describe("find_replace", () => {
  it("previews with dryRun and asks before changing more than 20 items", async () => {
    const many = Array.from({ length: 21 }, (_, i) =>
      makeFlowNode("process", i * 300, 0, `Eski ${i}`),
    );
    useBoardStore.getState().commitTo(two.id, { ...two, items: many });
    const preview = await call("find_replace", {
      boardId: two.id,
      find: "eski",
      replace: "Yeni",
      dryRun: true,
    });
    expect(preview.items).toBe(21);
    expect(state().workspace.boards[two.id].items[0]).toMatchObject({ text: "Eski 0" });

    const noRevision = await call("find_replace", {
      boardId: two.id,
      find: "eski",
      replace: "Yeni",
    });
    expect(noRevision.error).toBe("INVALID");

    confirm.mockResolvedValueOnce(false);
    const rejected = await call("find_replace", {
      boardId: two.id,
      find: "eski",
      replace: "Yeni",
      expectedRevision: revision(two.id),
    });
    expect(rejected.error).toBe("REJECTED");

    const done = await call("find_replace", {
      boardId: two.id,
      find: "eski",
      replace: "Yeni",
      expectedRevision: revision(two.id),
    });
    expect(done.changed).toHaveLength(21);
    expect((state().workspace.boards[two.id].items[0] as FlowNodeItem).text).toBe("Yeni 0");
    state().undoBoard(two.id);
    expect((state().workspace.boards[two.id].items[0] as FlowNodeItem).text).toBe("Eski 0");
  });
});

describe("view tools", () => {
  it("view_board and select work only on the active board", async () => {
    const view = await call("view_board", { boardId: two.id });
    expect(view.error).toBe("NO_BOARD");
    expect(view.message).toMatch(/focus/);
    const stepId = one.items[1].id;
    const selected = await call("select", { ids: [stepId, "n-missing"] });
    expect(selected).toMatchObject({ selected: 1, missing: ["n-missing"] });
    expect(state().selectedIds).toEqual([stepId]);
  });

  it("focus switches the active board", async () => {
    const result = await call("focus", { boardId: two.id });
    expect(result).toMatchObject({ activeBoard: two.id, switched: true });
    expect(state().activeBoardId).toBe(two.id);
    expect((await call("focus", { boardId: one.id, ids: ["n-missing"] })).error).toBe("NOT_FOUND");
  });

  it("recent_changes labels AI and user steps", async () => {
    await call("rename_board", {
      boardId: one.id,
      expectedRevision: revision(one.id),
      title: "AI adı",
    });
    state().renameBoard(one.id, "Kullanıcı adı");
    const result = await call("recent_changes", { boardId: one.id });
    expect(result.changes.map((c: { label: string }) => c.label)).toEqual([
      "kullanıcı",
      expect.stringMatching(/^Claude Code: /),
    ]);
    expect(result.changes[0]).toMatchObject({ added: 0, removed: 0, changed: 0, board: true });
  });
});
