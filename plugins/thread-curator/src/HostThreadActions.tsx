import { useEffect, useMemo, useRef } from "react";
import {
  experimental_useSidebarThreads as useSidebarThreads,
  useBbContext,
} from "@get-bb/plugin-sdk/app";
import { familyOf } from "./inbox";
import { useLifecycle } from "./useLifecycle";

const THREAD_ACTIONS_LABEL = "Thread actions";

function menuItemLabel(element: HTMLElement): string {
  return element.textContent?.trim() ?? "";
}

function replaceArchiveLabel(element: HTMLElement): void {
  const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
  let node = walker.nextNode();
  while (node !== null) {
    if (node.textContent?.trim() === "Archive") {
      node.textContent = node.textContent.replace("Archive", "Settle");
      return;
    }
    node = walker.nextNode();
  }
}

function threadIdFromTrigger(target: EventTarget | null): string | null {
  if (!(target instanceof Element)) return null;
  return (
    target.closest("[data-sidebar-thread-id]")?.getAttribute("data-sidebar-thread-id") ??
    null
  );
}

/**
 * Replaces BB's archive entry in the shared thread-actions menu. That one menu
 * implementation backs the header dropdown, sidebar menu, desktop context
 * menu, and compact long-press sheet.
 */
export function HostThreadActions() {
  const { threadId: routeThreadId } = useBbContext();
  const { threads } = useSidebarThreads();
  const lifecycle = useLifecycle(threads);
  const threadById = useMemo(
    () => new Map(threads.map((thread) => [thread.id, thread])),
    [threads],
  );
  const menuThreadId = useRef<string | null>(null);

  useEffect(() => {
    const rememberMenuTarget = (event: Event) => {
      const target = event.target;
      if (!(target instanceof Element)) return;
      if (target.closest(`[aria-label="${THREAD_ACTIONS_LABEL}"]`) === null) return;
      menuThreadId.current = threadIdFromTrigger(target) ?? routeThreadId;
    };
    document.addEventListener("pointerdown", rememberMenuTarget, true);
    document.addEventListener("contextmenu", rememberMenuTarget, true);
    return () => {
      document.removeEventListener("pointerdown", rememberMenuTarget, true);
      document.removeEventListener("contextmenu", rememberMenuTarget, true);
    };
  }, [routeThreadId]);

  useEffect(() => {
    const cleanups = new Map<HTMLElement, () => void>();

    const patchArchiveItems = () => {
      for (const candidate of Array.from(
        document.querySelectorAll<HTMLElement>('[role="menuitem"]'),
      )) {
        if (menuItemLabel(candidate) !== "Archive" || cleanups.has(candidate)) continue;

        const originalHtml = candidate.innerHTML;
        replaceArchiveLabel(candidate);

        let activated = false;
        const settle = (event: Event) => {
          if (
            event instanceof KeyboardEvent &&
            event.key !== "Enter" &&
            event.key !== " "
          ) {
            return;
          }
          const threadId = menuThreadId.current ?? routeThreadId;
          const thread = threadId === null ? undefined : threadById.get(threadId);
          event.preventDefault();
          event.stopImmediatePropagation();
          if (activated) return;
          activated = true;
          window.setTimeout(() => {
            activated = false;
          }, 0);
          if (!thread || !lifecycle.canPark(thread)) return;
          lifecycle.settleMany(familyOf(threads, thread).map(({ id }) => id));
          window.setTimeout(() => {
            document.dispatchEvent(
              new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
            );
          }, 0);
        };
        candidate.addEventListener("pointerdown", settle, true);
        candidate.addEventListener("pointerup", settle, true);
        candidate.addEventListener("click", settle, true);
        candidate.addEventListener("keydown", settle, true);
        cleanups.set(candidate, () => {
          candidate.removeEventListener("pointerdown", settle, true);
          candidate.removeEventListener("pointerup", settle, true);
          candidate.removeEventListener("click", settle, true);
          candidate.removeEventListener("keydown", settle, true);
          candidate.innerHTML = originalHtml;
        });
      }
    };

    const observer = new MutationObserver(patchArchiveItems);
    observer.observe(document.body, { childList: true, subtree: true });
    patchArchiveItems();
    return () => {
      observer.disconnect();
      for (const cleanup of cleanups.values()) cleanup();
    };
  }, [lifecycle, routeThreadId, threadById, threads]);

  return null;
}
