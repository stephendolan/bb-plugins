// @vitest-environment jsdom
import { expect, test } from "vitest";
import { loadPluginApp, renderSlot } from "@get-bb/plugin-sdk/testing/app";

test("registers an image opener that preserves the native preview", async () => {
  const app = await loadPluginApp(() => import("./app"));
  const opener = app.fileOpeners[0];

  expect(opener?.extensions).toEqual([
    "avif",
    "bmp",
    "gif",
    "jpeg",
    "jpg",
    "png",
    "svg",
    "webp",
  ]);

  const slot = renderSlot(opener!, {
    path: "artifacts/example.png",
    source: {
      kind: "workspace",
      threadId: "thr_test",
      environmentId: "env_test",
      projectId: "proj_test",
    },
    experimental_Original: () => <div>Native image preview</div>,
  });

  expect(slot.getByText("Native image preview")).toBeTruthy();
  expect(slot.getByRole("button", { name: "Copy image" })).toBeTruthy();
  slot.lifecycle.unmount();
});
