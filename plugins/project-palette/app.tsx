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
import { matchThreads, type Thread } from "@/lib/match-threads";

type Project = { id: string; name: string; isPersonal: boolean };
type Machine = { id: string; name: string; isConnected: boolean };
type PaletteTarget =
  | { kind: "project"; project: Project }
  | { kind: "machine"; machine: Machine }
  | { kind: "thread"; thread: Thread };

const PALETTE_EVENT = "project-palette:open";
const OPEN_ON_COMPOSE_KEY = "project-palette:open-on-compose";
function isSelectable(target: PaletteTarget) {
  return target.kind !== "machine" || target.machine.isConnected;
}


function moveActiveIndex(
  targets: PaletteTarget[],
  current: number,
  direction: -1 | 1,
) {
  let next = current + direction;
  while (next >= 0 && next < targets.length) {
    const target = targets[next];
    if (target && isSelectable(target)) return next;
    next += direction;
  }
  return current;
}

function openNewThreadScreen() {
  const currentIndex =
    typeof window.history.state?.idx === "number"
      ? window.history.state.idx
      : 0;
  const state = {
    usr: null,
    key: `project-palette-${Date.now()}`,
    idx: currentIndex + 1,
  };
  window.history.pushState(state, "", "/");
  window.dispatchEvent(new PopStateEvent("popstate", { state }));
}

function ProjectPalette() {
  const rpc = useRpc<typeof rpcContract>();
  const actions = experimental_useSidebarThreadActions();
  const inputRef = useRef<HTMLInputElement>(null);
  const rpcRef = useRef(rpc);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const [projects, setProjects] = useState<Project[]>([]);
  const [machines, setMachines] = useState<Machine[]>([]);
  const [threads, setThreads] = useState<Thread[]>([]);
  const [personalProjectId, setPersonalProjectId] = useState<string | null>(
    null,
  );
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
      if (event.defaultPrevented) return;
      event.preventDefault();
      openPalette();
    };
    window.addEventListener(PALETTE_EVENT, onOpen);
    return () => window.removeEventListener(PALETTE_EVENT, onOpen);
  }, [openPalette]);

  useEffect(() => {
    if (window.sessionStorage.getItem(OPEN_ON_COMPOSE_KEY) !== "1") return;
    window.sessionStorage.removeItem(OPEN_ON_COMPOSE_KEY);
    openPalette();
  }, [openPalette]);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    const client = rpcRef.current;
    setIsLoading(true);
    setLoadError(null);
    void client
      .call("listTargets")
      .then(
        ({
          projects: nextProjects,
          machines: nextMachines,
          threads: nextThreads,
          personalProjectId: nextPersonalProjectId,
        }) => {
          if (!cancelled) {
            setProjects(nextProjects);
            setMachines(nextMachines);
            setThreads(nextThreads);
            setPersonalProjectId(nextPersonalProjectId);
          }
        },
        (error) => {
          if (!cancelled) {
            setLoadError(
              error instanceof Error
                ? error.message
                : "Could not load projects, machines, and threads.",
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
  }, [open]);

  const normalizedQuery = query.trim().toLocaleLowerCase();
  const matchingProjects = projects.filter((project) =>
    project.name.toLocaleLowerCase().includes(normalizedQuery),
  );
  const matchingMachines = machines.filter((machine) =>
    machine.name.toLocaleLowerCase().includes(normalizedQuery),
  );
  const matchingThreads = matchThreads(threads, normalizedQuery);
  const matchingTargets: PaletteTarget[] = [
    ...matchingProjects.map((project) => ({
      kind: "project" as const,
      project,
    })),
    ...matchingMachines.map((machine) => ({
      kind: "machine" as const,
      machine,
    })),
    ...matchingThreads.map((thread) => ({
      kind: "thread" as const,
      thread,
    })),
  ];

  useEffect(() => {
    setActiveIndex((current) => {
      const clamped = Math.min(
        current,
        Math.max(matchingTargets.length - 1, 0),
      );
      const currentTarget = matchingTargets[clamped];
      if (currentTarget && isSelectable(currentTarget)) return clamped;
      const firstSelectable = matchingTargets.findIndex(isSelectable);
      return firstSelectable === -1 ? 0 : firstSelectable;
    });
  }, [matchingTargets.length, normalizedQuery]);

  const selectProject = useCallback(
    (project: Project) => {
      setOpen(false);
      actions.openNewThread({ projectId: project.id, focusPrompt: true });
    },
    [actions],
  );

  const selectMachine = useCallback(
    (machine: Machine) => {
      if (!machine.isConnected || !personalProjectId) return;
      setOpen(false);
      actions.openNewThread({
        projectId: personalProjectId,
        hostId: machine.id,
        focusPrompt: true,
      });
    },
    [actions, personalProjectId],
  );

  const selectThread = useCallback(
    (thread: Thread) => {
      setOpen(false);
      actions.open(thread.id);
    },
    [actions],
  );

  const selectTarget = useCallback(
    (target: PaletteTarget) => {
      if (target.kind === "project") {
        selectProject(target.project);
      } else if (target.kind === "machine") {
        selectMachine(target.machine);
      } else {
        selectThread(target.thread);
      }
    },
    [selectMachine, selectProject, selectThread],
  );

  function onKeyDown(event: ReactKeyboardEvent<HTMLInputElement>) {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActiveIndex((index) => moveActiveIndex(matchingTargets, index, 1));
      return;
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      setActiveIndex((index) => moveActiveIndex(matchingTargets, index, -1));
      return;
    }
    if (event.key === "Enter") {
      event.preventDefault();
      const target = matchingTargets[activeIndex];
      if (target) selectTarget(target);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="gap-0 overflow-hidden p-0 sm:max-w-lg">
        <DialogHeader className="border-b border-border px-4 py-3">
          <DialogTitle className="text-base font-semibold">
            Go to a project, machine, or thread
          </DialogTitle>
          <DialogDescription className="text-base text-muted-foreground sm:text-sm">
            Projects and machines start a new thread. Threads open in place.
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
            placeholder="Search projects, machines, and threads…"
            aria-label="Search projects, machines, and threads"
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
              Loading projects, machines, and threads…
            </p>
          ) : matchingTargets.length === 0 ? (
            <p className="px-2 py-6 text-center text-base text-muted-foreground sm:text-sm">
              Nothing matches “{query}”.
            </p>
          ) : (
            <ul role="list">
              {matchingProjects.length > 0 ? (
                <li className="px-2 pb-1 pt-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  Projects
                </li>
              ) : null}
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
              {matchingMachines.length > 0 ? (
                <li className="px-2 pb-1 pt-3 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  Machines
                </li>
              ) : null}
              {matchingMachines.map((machine, machineIndex) => {
                const index = matchingProjects.length + machineIndex;
                const active = index === activeIndex && machine.isConnected;
                return (
                  <li key={machine.id}>
                    <button
                      type="button"
                      disabled={!machine.isConnected}
                      className="flex w-full min-w-0 items-center justify-between gap-3 rounded-md px-2 py-2.5 text-left text-base outline-none hover:bg-state-hover focus-visible:ring-1 focus-visible:ring-ring data-active:bg-state-active disabled:cursor-not-allowed disabled:opacity-60 sm:py-1.5 sm:text-sm"
                      aria-current={active || undefined}
                      data-active={active || undefined}
                      onMouseMove={() => setActiveIndex(index)}
                      onClick={() => selectMachine(machine)}
                    >
                      <span className="min-w-0 truncate font-medium">
                        {machine.name}
                      </span>
                      <span className="shrink-0 text-muted-foreground">
                        {machine.isConnected ? "No project" : "Offline"}
                      </span>
                    </button>
                  </li>
                );
              })}
              {matchingThreads.length > 0 ? (
                <li className="px-2 pb-1 pt-3 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  {normalizedQuery === "" ? "Recent threads" : "Threads"}
                </li>
              ) : null}
              {matchingThreads.map((thread, threadIndex) => {
                const index =
                  matchingProjects.length +
                  matchingMachines.length +
                  threadIndex;
                const active = index === activeIndex;
                return (
                  <li key={thread.id}>
                    <button
                      type="button"
                      className="flex w-full min-w-0 items-center justify-between gap-3 rounded-md px-2 py-2.5 text-left text-base outline-none hover:bg-state-hover focus-visible:ring-1 focus-visible:ring-ring data-active:bg-state-active sm:py-1.5 sm:text-sm"
                      aria-current={active || undefined}
                      data-active={active || undefined}
                      onMouseMove={() => setActiveIndex(index)}
                      onClick={() => selectThread(thread)}
                    >
                      <span className="min-w-0 truncate font-medium">
                        {thread.title}
                      </span>
                      {thread.projectName ? (
                        <span className="shrink-0 truncate text-muted-foreground">
                          {thread.projectName}
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
          !event.shiftKey &&
          !event.altKey &&
          !event.repeat &&
          event.key.toLowerCase() === "k";
        if (!isShortcut) return;
        event.preventDefault();
        event.stopPropagation();
        const handled = !window.dispatchEvent(
          new CustomEvent(PALETTE_EVENT, { cancelable: true }),
        );
        if (handled) return;
        window.sessionStorage.setItem(OPEN_ON_COMPOSE_KEY, "1");
        openNewThreadScreen();
      };
      document.addEventListener("keydown", onKeyDown, {
        signal,
        capture: true,
      });
    },
  });

  app.composer.customize({
    id: "project-palette",
    scopes: ["new-thread", "thread"],
    banners: [
      {
        id: "project-palette-dialog",
        chrome: "bare",
        component: ProjectPalette,
      },
    ],
  });
});
