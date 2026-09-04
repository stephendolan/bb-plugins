// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen } from "@testing-library/react";
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
          curationSnapshot: () => ({
            categories: [],
            status: "idle",
            updatedAt: null,
            model: "codex/gpt-5.6-luna",
            error: null,
          }),
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
    fireEvent.click(await screen.findByText("Settle"));

    expect(settleMany).toHaveBeenCalledWith({ threadIds: ["thr_1"] });
  });
});
