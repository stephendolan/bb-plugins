import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";
import {
  definePluginApp,
  experimental_useSidebarThreadActions,
  useRpc,
} from "@get-bb/plugin-sdk/app";

import type { rpcContract } from "./server";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";

type Project = { id: string; name: string; isPersonal: boolean };

const PALETTE_EVENT = "project-palette:open";

function ProjectPalette() {
  const rpc = useRpc<typeof rpcContract>();
  const actions = experimental_useSidebarThreadActions();
  const inputRef = useRef<HTMLInputElement>(null);
  const rpcRef = useRef(rpc);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const [projects, setProjects] = useState<Project[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  rpcRef.current = rpc;

  const openPalette = useCallback(() => {
    setQuery("");
    setActiveIndex(0);
    setLoadError(null);
    setOpen(true);
    window.requestAnimationFrame(() => inputRef.current?.focus());
  }, []);

  useEffect(() => {
    const onOpen = (event: Event) => {
      event.preventDefault();
      openPalette();
    };
    window.addEventListener(PALETTE_EVENT, onOpen);
    return () => window.removeEventListener(PALETTE_EVENT, onOpen);
  }, [openPalette]);

  useEffect(() => {
    if (!open || projects.length > 0) return;
    let cancelled = false;
    const client = rpcRef.current;
    setIsLoading(true);
    setLoadError(null);
    void client
      .call("listProjects")
      .then(
        ({ projects: nextProjects }) => {
          if (!cancelled) setProjects(nextProjects);
        },
        (error) => {
          if (!cancelled) {
            setLoadError(
              error instanceof Error
                ? error.message
                : "Could not load projects.",
            );
          }
        },
      )
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, projects.length]);

  const matchingProjects = projects.filter((project) =>
    project.name
      .toLocaleLowerCase()
      .includes(query.trim().toLocaleLowerCase()),
  );

  useEffect(() => {
    setActiveIndex((current) =>
      Math.min(current, Math.max(matchingProjects.length - 1, 0)),
    );
  }, [matchingProjects.length]);

  const selectProject = useCallback(
    (project: Project) => {
      setOpen(false);
      actions.openNewThread({ projectId: project.id, focusPrompt: true });
    },
    [actions],
  );

  function onKeyDown(event: ReactKeyboardEvent<HTMLInputElement>) {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActiveIndex((index) =>
        Math.min(index + 1, matchingProjects.length - 1),
      );
      return;
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      setActiveIndex((index) => Math.max(index - 1, 0));
      return;
    }
    if (event.key === "Enter") {
      event.preventDefault();
      const project = matchingProjects[activeIndex];
      if (project) selectProject(project);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="gap-0 overflow-hidden p-0 sm:max-w-lg">
        <DialogHeader className="border-b border-border px-4 py-3">
          <DialogTitle className="text-base font-semibold">
            Choose a project
          </DialogTitle>
          <DialogDescription className="text-base text-muted-foreground sm:text-sm">
            Search every project, or start without one.
          </DialogDescription>
        </DialogHeader>
        <div className="p-3">
          <Input
            ref={inputRef}
            name="project-search"
            type="search"
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setActiveIndex(0);
            }}
            onKeyDown={onKeyDown}
            placeholder="Search projects…"
            aria-label="Search projects"
            className="h-11 text-base sm:h-9 sm:text-sm"
          />
        </div>
        <div className="max-h-[50dvh] overflow-y-auto border-t border-border p-1.5 sm:max-h-80">
          {loadError ? (
            <p className="px-2 py-6 text-center text-base text-destructive sm:text-sm">
              {loadError}
            </p>
          ) : isLoading ? (
            <p className="px-2 py-6 text-center text-base text-muted-foreground sm:text-sm">
              Loading projects…
            </p>
          ) : matchingProjects.length === 0 ? (
            <p className="px-2 py-6 text-center text-base text-muted-foreground sm:text-sm">
              No projects match “{query}”.
            </p>
          ) : (
            <ul role="list">
              {matchingProjects.map((project, index) => {
                const active = index === activeIndex;
                return (
                  <li key={project.id}>
                    <button
                      type="button"
                      className="flex w-full min-w-0 items-center justify-between gap-3 rounded-md px-2 py-2.5 text-left text-base outline-none hover:bg-state-hover focus-visible:ring-1 focus-visible:ring-ring data-active:bg-state-active sm:py-1.5 sm:text-sm"
                      aria-current={active || undefined}
                      data-active={active || undefined}
                      onMouseMove={() => setActiveIndex(index)}
                      onClick={() => selectProject(project)}
                    >
                      <span className="min-w-0 truncate font-medium">
                        {project.name}
                      </span>
                      {project.isPersonal ? (
                        <span className="shrink-0 text-muted-foreground">
                          No workspace
                        </span>
                      ) : null}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
        <div className="border-t border-border px-4 py-2 text-base text-muted-foreground sm:text-sm">
          <span>↑↓ Navigate</span>
          <span aria-hidden="true"> · </span>
          <span>↵ Choose</span>
          <span aria-hidden="true"> · </span>
          <span>Esc Close</span>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export default definePluginApp((app) => {
  app.contentScripts.register({
    id: "project-palette-shortcut",
    mount({ signal }) {
      const onKeyDown = (event: KeyboardEvent) => {
        const isShortcut =
          (event.metaKey || event.ctrlKey) &&
          event.shiftKey &&
          !event.altKey &&
          event.key.toLowerCase() === "p";
        if (!isShortcut) return;
        const handled = !window.dispatchEvent(
          new CustomEvent(PALETTE_EVENT, { cancelable: true }),
        );
        if (handled) event.preventDefault();
      };
      document.addEventListener("keydown", onKeyDown, { signal });
    },
  });

  app.composer.customize({
    id: "project-palette",
    scopes: ["new-thread"],
    banners: [
      {
        id: "project-palette-dialog",
        chrome: "bare",
        component: ProjectPalette,
      },
    ],
  });
});
