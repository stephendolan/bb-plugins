import { describe, expect, test } from "vitest";
import { createFakePluginHost } from "@get-bb/plugin-sdk/testing";

import plugin from "./server";

describe("listProjects", () => {
  test("includes the personal project first and sorts named projects", async () => {
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
      },
    });

    await plugin(bb);
    await expect(harness.behavior.callRpc("listProjects", null)).resolves.toEqual({
      projects: [
        {
          id: "proj_personal",
          name: "Don’t work in a project",
          isPersonal: true,
        },
        { id: "proj_a", name: "Alpha", isPersonal: false },
        { id: "proj_z", name: "Zulu", isPersonal: false },
      ],
    });
    expect(harness.inspection.sdk.callsTo("projects.list")[0]).toEqual([
      { includePersonal: true },
    ]);
  });
});
