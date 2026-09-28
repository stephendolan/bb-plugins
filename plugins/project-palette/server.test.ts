import { describe, expect, test } from "vitest";
import { createFakePluginHost } from "@get-bb/plugin-sdk/testing";

import plugin from "./server";

describe("listTargets", () => {
  test("sorts projects, machines, and recent threads", async () => {
    const { bb, harness } = createFakePluginHost({
      pluginId: "project-palette",
      sdk: {
        projects: {
          list: async () => [
            { id: "proj_z", name: "Zulu", kind: "ordinary" },
            { id: "proj_personal", name: "Personal", kind: "personal" },
            { id: "proj_a", name: "Alpha", kind: "ordinary" },
          ],
        },
        threads: {
          list: async () => [
            {
              id: "thr_old",
              title: "Older thread",
              titleFallback: null,
              projectId: "proj_a",
              updatedAt: 1,
            },
            {
              id: "thr_new",
              title: null,
              titleFallback: "Fallback title",
              projectId: "proj_personal",
              updatedAt: 5,
            },
          ],
        },
        hosts: {
          list: async () => [
            {
              id: "host_z",
              name: "Zulu",
              status: "connected",
              type: "persistent",
              maxPermissionMode: "full",
              lastSeenAt: 3,
              lastRejectedProtocolVersion: null,
              createdAt: 1,
              updatedAt: 3,
            },
            {
              id: "host_offline",
              name: "Alpha",
              status: "disconnected",
              type: "persistent",
              maxPermissionMode: "full",
              lastSeenAt: 2,
              lastRejectedProtocolVersion: null,
              createdAt: 1,
              updatedAt: 2,
            },
            {
              id: "host_a",
              name: "Alpha",
              status: "connected",
              type: "persistent",
              maxPermissionMode: "full",
              lastSeenAt: 3,
              lastRejectedProtocolVersion: null,
              createdAt: 1,
              updatedAt: 3,
            },
          ],
        },
      },
    });

    await plugin(bb);
    await expect(harness.behavior.callRpc("listTargets", null)).resolves.toEqual(
      {
        projects: [
          {
            id: "proj_personal",
            name: "Don’t work in a project",
            isPersonal: true,
          },
          { id: "proj_a", name: "Alpha", isPersonal: false },
          { id: "proj_z", name: "Zulu", isPersonal: false },
        ],
        machines: [
          { id: "host_a", name: "Alpha", isConnected: true },
          { id: "host_z", name: "Zulu", isConnected: true },
          { id: "host_offline", name: "Alpha", isConnected: false },
        ],
        threads: [
          {
            id: "thr_new",
            title: "Fallback title",
            projectName: null,
            updatedAt: 5,
          },
          {
            id: "thr_old",
            title: "Older thread",
            projectName: "Alpha",
            updatedAt: 1,
          },
        ],
        personalProjectId: "proj_personal",
      },
    );
    expect(harness.inspection.sdk.callsTo("threads.list")[0]).toEqual([
      { archived: false, limit: 300 },
    ]);
    expect(harness.inspection.sdk.callsTo("projects.list")[0]).toEqual([
      { includePersonal: true },
    ]);
    expect(harness.inspection.sdk.callsTo("hosts.list")[0]).toEqual([]);
  });
});
