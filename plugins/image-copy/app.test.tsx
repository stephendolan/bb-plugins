// @vitest-environment jsdom
import { afterEach, expect, test, vi } from "vitest";
import {
  loadPluginApp,
  mountPluginContentScripts,
  renderSlot,
} from "@get-bb/plugin-sdk/testing/app";

afterEach(() => {
  document.body.replaceChildren();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

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
    Original: () => <div>Native image preview</div>,
  });

  expect(slot.getByText("Native image preview")).toBeTruthy();
  expect(slot.getByRole("button", { name: "Copy image" })).toBeTruthy();
  slot.lifecycle.unmount();
});

test("adds a copy button to the native image lightbox and removes it on dispose", async () => {
  const write = vi.fn().mockResolvedValue(undefined);
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: { write },
  });
  vi.stubGlobal(
    "ClipboardItem",
    class ClipboardItem {
      constructor(public items: Record<string, Blob>) {}
    },
  );
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({
      ok: true,
      blob: async () => new Blob(["png"], { type: "image/png" }),
    }),
  );

  const dialog = document.createElement("div");
  dialog.role = "dialog";
  const image = document.createElement("img");
  image.src = "/api/image.png";
  Object.defineProperties(image, {
    complete: { value: true },
    naturalWidth: { value: 100 },
  });
  const close = document.createElement("button");
  close.ariaLabel = "Close image preview";
  dialog.append(image, close);
  document.body.append(dialog);

  const app = await loadPluginApp(() => import("./app"));
  const contentScripts = await mountPluginContentScripts(app, {
    pluginId: "image-copy",
    generation: 1,
  });

  const copy = document.querySelector<HTMLButtonElement>(
    'button[aria-label="Copy image"]',
  );
  expect(copy).toBeTruthy();
  copy?.click();
  await vi.waitFor(() => expect(write).toHaveBeenCalledOnce());

  await contentScripts.lifecycle.dispose();
  expect(document.querySelector('button[aria-label="Image copied"]')).toBeNull();
});

test("decorates a lightbox mounted after the content script", async () => {
  const app = await loadPluginApp(() => import("./app"));
  const contentScripts = await mountPluginContentScripts(app, {
    pluginId: "image-copy",
    generation: 1,
  });

  const dialog = document.createElement("div");
  dialog.role = "dialog";
  dialog.innerHTML =
    '<img src="/image.png"><button aria-label="Close image preview"></button>';
  document.body.append(dialog);

  await vi.waitFor(() => {
    expect(document.querySelector('button[aria-label="Copy image"]')).toBeTruthy();
  });
  await contentScripts.lifecycle.dispose();
});
