// @vitest-environment jsdom

import { act } from "react";
import { describe, expect, test } from "vitest";
import { matchThreads } from "./lib/match-threads";
import {
  loadPluginApp,
  mountPluginContentScripts,
  renderSlot,
} from "@get-bb/plugin-sdk/testing/app";

describe("project palette", () => {
  test.each(["click", "Enter"])("opens a projectless composer on the selected machine via %s", async (selection) => {
    window.localStorage.clear();
    window.sessionStorage.clear();
    const app = await loadPluginApp(() => import("./app"));
    const contentScripts = await mountPluginContentScripts(app, {
      pluginId: "project-palette",
    });
    const banner = app.composerCustomizations[0]?.banners?.[0];
    if (!banner) throw new Error("Project palette banner was not registered.");

    window.history.replaceState({ idx: 0 }, "", "/settings");
    const shortcut = new KeyboardEvent("keydown", {
      key: "k",
      metaKey: true,
      bubbles: true,
      cancelable: true,
    });
    document.dispatchEvent(shortcut);

    expect(shortcut.defaultPrevented).toBe(true);
    expect(window.location.pathname).toBe("/");
    expect(
      window.sessionStorage.getItem("project-palette:open-on-compose"),
    ).toBe("1");

    const slot = renderSlot(
      banner,
      {},
      {
        rpc: {
          listTargets: async () => ({
            projects: [
              {
                id: "proj_personal",
                name: "Don’t work in a project",
                isPersonal: true,
              },
            ],
            machines: [
              { id: "host_mac", name: "Mac Mini", isConnected: true },
              { id: "host_old", name: "Old Mac", isConnected: false },
            ],
            threads: [
              {
                id: "thr_recent",
                title: "Fix project switcher plugin",
                projectName: "bb-plugins",
                updatedAt: 2,
              },
            ],
            personalProjectId: "proj_personal",
          }),
        },
      },
    );

    const thread = await slot.findByRole("button", {
      name: /Fix project switcher plugin/,
    });
    expect(thread.textContent).toContain("bb-plugins");
    expect(
      window.sessionStorage.getItem("project-palette:open-on-compose"),
    ).toBeNull();

    await act(async () => {
      thread.click();
    });
    expect(slot.inspection.sidebarActionCalls).toEqual([
      { method: "open", threadId: "thr_recent", options: undefined },
    ]);

    await act(async () => {
      window.dispatchEvent(
        new CustomEvent("project-palette:open", { cancelable: true }),
      );
    });
    const machine = await slot.findByRole("button", { name: /Mac Mini/ });
    const offlineMachine = await slot.findByRole("button", { name: /Old Mac/ });
    expect((offlineMachine as HTMLButtonElement).disabled).toBe(true);

    if (selection === "Enter") {
      await act(async () => {
        slot.getByRole("searchbox").dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }));
      });
    }
    await act(async () => {
      if (selection === "click") {
        machine.click();
      } else {
        const input = slot.getByRole("searchbox");
        input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
      }
    });
    expect(slot.inspection.sidebarActionCalls.at(-1)).toEqual({
      method: "openNewThread",
      options: { projectId: "proj_personal", hostId: "host_mac", focusPrompt: true },
    });
    slot.lifecycle.unmount();
    await contentScripts.lifecycle.dispose();
  });
});

describe("matchThreads", () => {
  const threads = Array.from({ length: 30 }, (_, index) => ({
    id: `thr_${index}`,
    title: index % 2 === 0 ? `Deploy ${index}` : `Review ${index}`,
    projectName: null,
    updatedAt: 30 - index,
  }));

  test("shows the most recent threads when the query is empty", () => {
    expect(matchThreads(threads, "").map((thread) => thread.id)).toEqual(
      threads.slice(0, 8).map((thread) => thread.id),
    );
  });

  test("matches thread titles by substring, case-insensitively", () => {
    const matches = matchThreads(threads, "deploy 2");
    expect(matches.map((thread) => thread.title)).toEqual([
      "Deploy 2",
      "Deploy 20",
      "Deploy 22",
      "Deploy 24",
      "Deploy 26",
      "Deploy 28",
    ]);
  });
});
