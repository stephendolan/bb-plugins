import { useRef, useState } from "react";
import type { PluginFileOpenerProps } from "@get-bb/plugin-sdk/app";
import { definePluginApp } from "@get-bb/plugin-sdk/app";
import { Copy01Icon, Tick02Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { toast } from "sonner";

const IMAGE_EXTENSIONS = [
  "avif",
  "bmp",
  "gif",
  "jpeg",
  "jpg",
  "png",
  "svg",
  "webp",
] as const;

async function pngBlobFromImage(image: HTMLImageElement): Promise<Blob> {
  const response = await fetch(image.currentSrc || image.src);
  if (!response.ok) throw new Error("Could not load this image.");

  const source = await response.blob();
  if (source.type === "image/png") return source;

  const bitmap = await createImageBitmap(source);
  try {
    const canvas = document.createElement("canvas");
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    canvas.getContext("2d")?.drawImage(bitmap, 0, 0);

    return await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob(
        (blob) =>
          blob ? resolve(blob) : reject(new Error("Could not convert this image.")),
        "image/png",
      );
    });
  } finally {
    bitmap.close();
  }
}

async function copyRenderedImage(container: HTMLElement): Promise<void> {
  const image = container.querySelector("img");
  if (!image || !image.complete || image.naturalWidth === 0) {
    throw new Error("The image is still loading.");
  }
  if (!navigator.clipboard?.write || typeof ClipboardItem === "undefined") {
    throw new Error("Image copying is not available in this window.");
  }

  const png = await pngBlobFromImage(image);
  await navigator.clipboard.write([new ClipboardItem({ "image/png": png })]);
}

const LIGHTBOX_COPY_BUTTON_ATTRIBUTE = "data-image-copy-lightbox-button";

function installLightboxCopyButtons(signal: AbortSignal): () => void {
  const timers = new Set<number>();

  function decorateLightboxes() {
    for (const closeButton of Array.from(
      document.querySelectorAll<HTMLButtonElement>(
        'button[aria-label="Close image preview"]',
      ),
    )) {
      const lightbox = closeButton.closest('[role="dialog"]') as HTMLElement | null;
      if (
        !lightbox ||
        !lightbox.querySelector("img") ||
        lightbox.querySelector(`[${LIGHTBOX_COPY_BUTTON_ATTRIBUTE}]`)
      ) {
        continue;
      }

      const button = document.createElement("button");
      button.type = "button";
      button.ariaLabel = "Copy image";
      button.title = "Copy image";
      button.textContent = "Copy";
      button.setAttribute(LIGHTBOX_COPY_BUTTON_ATTRIBUTE, "");
      button.className =
        "absolute right-14 top-2 z-10 inline-flex h-9 cursor-pointer items-center justify-center rounded-full bg-black/45 px-3 text-sm font-medium text-white transition-colors hover:bg-black/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white disabled:pointer-events-none disabled:opacity-50";
      button.addEventListener("click", () => {
        if (button.disabled) return;

        button.disabled = true;
        void copyRenderedImage(lightbox)
          .then(() => {
            button.textContent = "Copied";
            button.ariaLabel = "Image copied";
            toast.success("Image copied");
            const timer = window.setTimeout(() => {
              timers.delete(timer);
              if (!button.isConnected) return;
              button.textContent = "Copy";
              button.ariaLabel = "Copy image";
            }, 1_500);
            timers.add(timer);
          })
          .catch((error) => {
            toast.error(
              error instanceof Error ? error.message : "Could not copy image.",
            );
          })
          .finally(() => {
            button.disabled = false;
          });
      });
      lightbox.append(button);
    }
  }

  decorateLightboxes();
  const observer = new MutationObserver(decorateLightboxes);
  observer.observe(document.body, { childList: true, subtree: true });

  const dispose = () => {
    observer.disconnect();
    for (const timer of timers) window.clearTimeout(timer);
    timers.clear();
    document
      .querySelectorAll(`[${LIGHTBOX_COPY_BUTTON_ATTRIBUTE}]`)
      .forEach((button) => button.remove());
  };
  signal.addEventListener("abort", dispose, { once: true });
  return () => {
    signal.removeEventListener("abort", dispose);
    dispose();
  };
}

function ImageCopyPreview({ Original }: PluginFileOpenerProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [copied, setCopied] = useState(false);
  const [copying, setCopying] = useState(false);

  async function copyImage() {
    if (!containerRef.current || copying) return;

    setCopying(true);
    try {
      await copyRenderedImage(containerRef.current);
      setCopied(true);
      toast.success("Image copied");
      window.setTimeout(() => setCopied(false), 1_500);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not copy image.");
    } finally {
      setCopying(false);
    }
  }

  return (
    <div ref={containerRef} className="relative h-full min-h-0">
      <Original />
      <button
        aria-label={copied ? "Image copied" : "Copy image"}
        className="absolute right-2 top-2 z-10 inline-flex size-9 cursor-pointer items-center justify-center rounded-md border border-input bg-background/80 text-foreground shadow-sm backdrop-blur-sm transition-colors hover:bg-state-hover focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50"
        disabled={copying}
        onClick={() => void copyImage()}
        type="button"
      >
        <HugeiconsIcon
          aria-hidden="true"
          className="size-4"
          icon={copied ? Tick02Icon : Copy01Icon}
        />
      </button>
    </div>
  );
}

export default definePluginApp((app) => {
  app.contentScripts.register({
    id: "image-lightbox-copy",
    mount: ({ signal }) => installLightboxCopyButtons(signal),
  });

  app.slots.fileOpener({
    id: "image-copy",
    title: "Image Copy",
    extensions: IMAGE_EXTENSIONS,
    component: ImageCopyPreview,
  });
});
