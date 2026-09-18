// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen, within } from "@testing-library/react";
import { loadPluginApp, renderSlot } from "@get-bb/plugin-sdk/testing/app";
import type { PluginSidebarThread } from "@get-bb/plugin-sdk";

const app = await loadPluginApp(() => import("../app"));
const threadList = app.threadLists.find((slot) => slot.id === "curated")!;

function thread(
  overrides: Partial<PluginSidebarThread> = {},
): PluginSidebarThread {
  return {
    id: "thr_1",
    projectId: "proj_1",
    title: "A thread",
    titleFallback: null,
    parentThreadId: null,
    sectionId: null,
    originKind: null,
    originPluginId: null,
    providerId: "codex",
    hasPendingInteraction: false,
    activity: {
      workflows: 0,
      backgroundAgents: 0,
      backgroundCommands: 0,
      planMode: 0,
      goals: 0,
    },
    indicator: "none",
    indicatorLabel: null,
    isUnread: false,
    isPinned: false,
    isArchived: false,
    environment: null,
    host: null,
    createdAt: 100,
    updatedAt: 100,
    lastReadAt: 100,
    latestAttentionAt: 100,
    ...overrides,
  };
}

afterEach(cleanup);

describe("ThreadInbox", () => {
  it("collapses one project without hiding another project's threads", async () => {
    renderSlot(
      threadList,
      {
        activeThreadId: null,
        activeProjectId: "proj_1",
        isCompactViewport: false,
        onNavigate: vi.fn(),
        searchQuery: "",
        Original: () => null,
      },
      {
        rpc: { listLifecycle: () => ({ rows: [] }) },
        sidebarThreads: {
          status: "ready",
          threads: [
            thread({
              title: "Alpha thread",
              indicator: "runtime",
              indicatorLabel: "Thread working",
            }),
            thread({ id: "thr_2", projectId: "proj_2", title: "Beta thread" }),
          ],
          projects: [
            { id: "proj_1", name: "Alpha", isPersonal: false },
            { id: "proj_2", name: "Beta", isPersonal: false },
          ],
        },
      },
    );

    const alphaHeader = await screen.findByRole("button", {
      name: "Collapse Alpha project",
    });
    const alphaSection = screen.getByRole("region", { name: "Alpha" });
    expect(alphaHeader.getAttribute("aria-expanded")).toBe("true");
    expect(within(alphaSection).queryByText("1")).toBeNull();
    expect(screen.queryByLabelText("Alpha has active work")).toBeNull();
    expect(screen.getByRole("link", { name: "Alpha thread" })).not.toBeNull();
    expect(screen.getByRole("link", { name: "Beta thread" })).not.toBeNull();

    fireEvent.click(alphaHeader);

    expect(alphaHeader.getAttribute("aria-expanded")).toBe("false");
    expect(alphaHeader.getAttribute("aria-label")).toBe("Expand Alpha project");
    expect(within(alphaSection).getByText("1")).not.toBeNull();
    expect(screen.getByLabelText("Alpha has active work")).not.toBeNull();
    expect(screen.queryByRole("link", { name: "Alpha thread" })).toBeNull();
    expect(screen.getByRole("link", { name: "Beta thread" })).not.toBeNull();
  });

  it("expands grandchildren at their own tree level and hides them with an ancestor", async () => {
    renderSlot(
      threadList,
      {
        activeThreadId: null,
        activeProjectId: "proj_1",
        isCompactViewport: false,
        onNavigate: vi.fn(),
        searchQuery: "",
        Original: () => null,
      },
      {
        rpc: { listLifecycle: () => ({ rows: [] }) },
        sidebarThreads: {
          status: "ready",
          threads: [
            thread({ title: "Parent" }),
            thread({ id: "thr_child", title: "Child", parentThreadId: "thr_1" }),
            thread({
              id: "thr_grandchild",
              title: "Grandchild",
              parentThreadId: "thr_child",
            }),
          ],
          projects: [{ id: "proj_1", name: "bb", isPersonal: false }],
        },
      },
    );

    fireEvent.click(await screen.findByRole("button", { name: "Expand 1 child thread" }));
    const childRow = (await screen.findByRole("link", { name: "Child" })).closest("li")!;
    expect(childRow.textContent).toBe("Child");
    fireEvent.click(screen.getByRole("button", { name: "Expand 1 child thread" }));
    const grandchildRow = (await screen.findByRole("link", { name: "Grandchild" })).closest("li")!;
    expect(grandchildRow.textContent).toBe("Grandchild");

    fireEvent.click(screen.getAllByRole("button", { name: "Collapse 1 child thread" })[0]!);
    expect(screen.queryByRole("link", { name: "Child" })).toBeNull();
    expect(screen.queryByRole("link", { name: "Grandchild" })).toBeNull();
  });

  it("settles the active thread and its descendants with Command-S", async () => {
    const settleMany = vi.fn(() => ({ ok: true }));
    renderSlot(
      threadList,
      {
        activeThreadId: "thr_1",
        activeProjectId: "proj_1",
        isCompactViewport: false,
        onNavigate: vi.fn(),
        searchQuery: "",
        Original: () => null,
      },
      {
        rpc: {
          listLifecycle: () => ({ rows: [] }),
          settleMany,
        },
        sidebarThreads: {
          status: "ready",
          threads: [
            thread(),
            thread({ id: "thr_child", parentThreadId: "thr_1" }),
          ],
          projects: [{ id: "proj_1", name: "bb", isPersonal: false }],
        },
      },
    );
    await screen.findByRole("link", { name: "A thread" });

    const shortcut = new KeyboardEvent("keydown", {
      key: "s",
      metaKey: true,
      bubbles: true,
      cancelable: true,
    });
    document.dispatchEvent(shortcut);

    expect(shortcut.defaultPrevented).toBe(true);
    expect(settleMany).toHaveBeenCalledWith({
      threadIds: ["thr_1", "thr_child"],
    });
  });

  it("settles an idle thread from its long-press menu", async () => {
    const settleMany = vi.fn(() => ({ ok: true }));
    renderSlot(
      threadList,
      {
        activeThreadId: null,
        activeProjectId: null,
        isCompactViewport: true,
        onNavigate: vi.fn(),
        searchQuery: "",
        Original: () => null,
      },
      {
        rpc: {
          listLifecycle: () => ({ rows: [] }),
          settleMany,
        },
        sidebarThreads: {
          status: "ready",
          threads: [thread()],
          projects: [{ id: "proj_1", name: "bb", isPersonal: false }],
        },
      },
    );

    const row = await screen.findByRole("link", { name: "A thread" });
    fireEvent.contextMenu(row.closest("li")!);
    expect(screen.queryByText("Archive")).toBeNull();
    fireEvent.click(await screen.findByText("Settle"));

    expect(settleMany).toHaveBeenCalledWith({ threadIds: ["thr_1"] });
  });

  it("shows most recently settled threads first", async () => {
    renderSlot(
      threadList,
      {
        activeThreadId: null,
        activeProjectId: "proj_1",
        isCompactViewport: false,
        onNavigate: vi.fn(),
        searchQuery: "",
        Original: () => null,
      },
      {
        rpc: {
          listLifecycle: () => ({
            rows: [
              {
                threadId: "thr_older_settle",
                settledAt: 200,
                snoozedUntil: null,
                snoozedAt: null,
              },
              {
                threadId: "thr_newer_settle",
                settledAt: 300,
                snoozedUntil: null,
                snoozedAt: null,
              },
            ],
          }),
        },
        sidebarThreads: {
          status: "ready",
          threads: [
            thread({
              id: "thr_older_settle",
              title: "Older settle",
              createdAt: 200,
              latestAttentionAt: 100,
            }),
            thread({
              id: "thr_newer_settle",
              title: "Newer settle",
              createdAt: 100,
              latestAttentionAt: 100,
            }),
          ],
          projects: [{ id: "proj_1", name: "bb", isPersonal: false }],
        },
      },
    );

    fireEvent.click(await screen.findByRole("button", { name: /Settled/ }));

    expect(screen.getAllByRole("link").map((link) => link.getAttribute("aria-label"))).toEqual([
      "Newer settle",
      "Older settle",
    ]);
  });
});
