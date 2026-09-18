import { useEffect, useMemo, useState, type ReactNode } from "react";
import {
  experimental_useSidebarThreads as useSidebarThreads,
  type PluginSidebarThread,
  type PluginThreadListProps,
} from "@get-bb/plugin-sdk/app";
import { Icon } from "./components/Icon";
import { cn } from "./lib/utils";
import { ThreadCard } from "./ThreadCard";
import { SlimRow } from "./SlimRow";
import { isWorking, useLifecycle } from "./useLifecycle";
import { TRAILING_GLYPH_BOX_CLASS } from "./StatusSlot";
import {
  descendantsOf,
  familyOf,
  nestChildrenUnderParents,
  partitionPinned,
  searchThreadsByTitle,
  visibleInboxThreads,
  type NestedThread,
} from "./inbox";

export function ThreadInbox({
  activeThreadId,
  onNavigate,
  searchQuery,
}: PluginThreadListProps) {
  const { status, threads, projects } = useSidebarThreads();
  const lifecycle = useLifecycle(threads);
  const [nowMinute, setNowMinute] = useState(() => Math.floor(Date.now() / 60_000));
  const [showSnoozed, setShowSnoozed] = useState(false);
  const [showSettled, setShowSettled] = useState(false);
  const [expandedParents, setExpandedParents] = useState<Set<string>>(() => new Set());
  const [collapsedProjects, setCollapsedProjects] = useState<Set<string>>(
    () => new Set(),
  );
  const activeThread = useMemo(
    () => threads.find((thread) => thread.id === activeThreadId),
    [activeThreadId, threads],
  );

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const isSettleShortcut =
        (event.metaKey || event.ctrlKey) &&
        !event.shiftKey &&
        !event.altKey &&
        !event.repeat &&
        event.key.toLowerCase() === "s";
      if (!isSettleShortcut || activeThread === undefined) return;

      event.preventDefault();
      event.stopPropagation();
      if (!lifecycle.canPark(activeThread)) return;

      lifecycle.settleMany(
        familyOf(threads, activeThread).map((thread) => thread.id),
      );
    };
    document.addEventListener("keydown", onKeyDown, { capture: true });
    return () => document.removeEventListener("keydown", onKeyDown, true);
  }, [activeThread, lifecycle, threads]);

  useEffect(() => {
    const timer = setInterval(() => setNowMinute(Math.floor(Date.now() / 60_000)), 60_000);
    return () => clearInterval(timer);
  }, []);
  const now = nowMinute * 60_000;
  const projectById = useMemo(
    () => new Map(projects.map((project) => [project.id, project])),
    [projects],
  );

  const grouped = useMemo(() => {
    const matched = searchThreadsByTitle(visibleInboxThreads(threads), searchQuery);
    const active: PluginSidebarThread[] = [];
    const snoozed: PluginSidebarThread[] = [];
    const settled: PluginSidebarThread[] = [];
    for (const thread of matched) {
      const shelf = lifecycle.shelfFor(thread);
      if (shelf === "snoozed") snoozed.push(thread);
      else if (shelf === "settled") settled.push(thread);
      else active.push(thread);
    }

    const { pinned, inbox } = partitionPinned(active);
    return {
      pinned: nestChildrenUnderParents(pinned),
      projects: groupByProject(inbox, projectById),
      snoozed: [...snoozed].sort(
        (left, right) =>
          (lifecycle.wakeAtFor(left) ?? 0) - (lifecycle.wakeAtFor(right) ?? 0),
      ),
      settled: [...settled].sort((left, right) => {
        const bySettledAt =
          (lifecycle.settledAtFor(right) ?? 0) -
          (lifecycle.settledAtFor(left) ?? 0);
        return bySettledAt || right.createdAt - left.createdAt;
      }),
    };
  }, [lifecycle, projectById, searchQuery, threads]);

  const toggleChildren = (parentId: string) => {
    setExpandedParents((current) => toggleSet(current, parentId));
  };
  const toggleProject = (projectId: string) => {
    setCollapsedProjects((current) => toggleSet(current, projectId));
  };
  const total =
    grouped.pinned.length +
    grouped.projects.reduce((count, group) => count + group.rows.length, 0) +
    grouped.snoozed.length +
    grouped.settled.length;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="min-h-0 flex-1 overflow-y-auto px-1.5 pb-2">
        {status === "loading" ? null : status === "error" ? (
          <EmptyState>Could not load threads.</EmptyState>
        ) : total === 0 ? (
          <EmptyState>{searchQuery.trim() ? "No threads found" : "No threads yet"}</EmptyState>
        ) : (
          <>
            {grouped.pinned.length > 0 ? (
              <Shelf label="Pinned">
                <ActiveRows
                  rows={grouped.pinned}
                  allThreads={threads}
                  activeThreadId={activeThreadId}
                  lifecycle={lifecycle}
                  now={now}
                  expandedParents={expandedParents}
                  onToggleChildren={toggleChildren}
                  onNavigate={onNavigate}
                />
              </Shelf>
            ) : null}
            {grouped.projects.map((group) => (
              <ProjectShelf
                key={group.id}
                label={group.label}
                count={group.rows.filter((row) => !row.isNested).length}
                collapsed={collapsedProjects.has(group.id)}
                working={group.rows.some((row) => isWorking(row.thread))}
                onToggle={() => toggleProject(group.id)}
              >
                <ActiveRows
                  rows={group.rows}
                  allThreads={threads}
                  activeThreadId={activeThreadId}
                  lifecycle={lifecycle}
                  now={now}
                  expandedParents={expandedParents}
                  onToggleChildren={toggleChildren}
                  onNavigate={onNavigate}
                />
              </ProjectShelf>
            ))}
            <ParkedShelf
              label="Snoozed"
              threads={grouped.snoozed}
              expanded={showSnoozed}
              onToggle={() => setShowSnoozed((open) => !open)}
              shelf="snoozed"
              activeThreadId={activeThreadId}
              lifecycle={lifecycle}
              onNavigate={onNavigate}
            />
            <ParkedShelf
              label="Settled"
              threads={grouped.settled}
              expanded={showSettled}
              onToggle={() => setShowSettled((open) => !open)}
              shelf="settled"
              activeThreadId={activeThreadId}
              lifecycle={lifecycle}
              onNavigate={onNavigate}
            />
          </>
        )}
      </div>
    </div>
  );
}

function ActiveRows({
  rows,
  allThreads,
  activeThreadId,
  lifecycle,
  now,
  expandedParents,
  onToggleChildren,
  onNavigate,
}: {
  rows: readonly NestedThread[];
  allThreads: readonly PluginSidebarThread[];
  activeThreadId: string | null;
  lifecycle: ReturnType<typeof useLifecycle>;
  now: number;
  expandedParents: ReadonlySet<string>;
  onToggleChildren: (threadId: string) => void;
  onNavigate: () => void;
}) {
  return (
    <>
      {rows.map(({
        thread,
        isNested,
        depth,
        ancestorIds,
      }) => {
        const childThreads = rows
          .filter((row) => row.thread.parentThreadId === thread.id)
          .map((row) => row.thread);
        if (ancestorIds.some((ancestorId) => !expandedParents.has(ancestorId))) {
          return null;
        }
        return (
          <ThreadCard
            key={thread.id}
            thread={thread}
            isActive={thread.id === activeThreadId}
            canPark={lifecycle.canPark(thread)}
            onNavigate={onNavigate}
            onSettle={() => lifecycle.settleMany(familyOf(allThreads, thread).map(({ id }) => id))}
            onSnooze={(until) => lifecycle.snooze(thread.id, until)}
            now={now}
            isNested={isNested}
            nestingDepth={depth}
            childThreads={childThreads}
            childrenCollapsed={childThreads.length > 0 && !expandedParents.has(thread.id)}
            onToggleChildren={
              childThreads.length > 0
                ? () => onToggleChildren(thread.id)
                : undefined
            }
          />
        );
      })}
    </>
  );
}

const NO_PROJECT_LABEL = "No project";

/**
 * Active threads by project, personal first and the rest alphabetical, so the
 * sections hold still as work comes and goes. Children keep nesting under
 * their parent inside the parent's project.
 */
function groupByProject(
  threads: readonly PluginSidebarThread[],
  projectById: ReadonlyMap<string, { name: string; isPersonal: boolean }>,
): { id: string; label: string; rows: NestedThread[] }[] {
  const byProject = new Map<string, PluginSidebarThread[]>();
  for (const thread of threads) {
    const rows = byProject.get(thread.projectId) ?? [];
    rows.push(thread);
    byProject.set(thread.projectId, rows);
  }
  return [...byProject.entries()]
    .map(([id, rows]) => {
      const project = projectById.get(id);
      return {
        id,
        label: project?.isPersonal ? NO_PROJECT_LABEL : project?.name ?? NO_PROJECT_LABEL,
        isPersonal: project?.isPersonal ?? false,
        rows: nestChildrenUnderParents(rows),
      };
    })
    .sort((left, right) => {
      if (left.isPersonal !== right.isPersonal) return left.isPersonal ? -1 : 1;
      return left.label.localeCompare(right.label);
    });
}

function toggleSet(current: ReadonlySet<string>, value: string): Set<string> {
  const next = new Set(current);
  if (next.has(value)) next.delete(value);
  else next.add(value);
  return next;
}

function EmptyState({ children }: { children: ReactNode }) {
  return (
    <p role="status" className="px-2 py-6 text-center text-xs text-muted-foreground">
      {children}
    </p>
  );
}

function Shelf({ label, children }: { label: string; children: ReactNode }) {
  return (
    <section aria-label={label}>
      <h2 className="px-2.5 pb-1 pt-3 text-2xs font-medium text-muted-foreground/70 first:pt-1">
        {label}
      </h2>
      <ul className="flex flex-col gap-px">{children}</ul>
    </section>
  );
}

function ProjectShelf({
  label,
  count,
  collapsed,
  working,
  onToggle,
  children,
}: {
  label: string;
  count: number;
  collapsed: boolean;
  working: boolean;
  onToggle: () => void;
  children: ReactNode;
}) {
  return (
    <section aria-label={label} className="pt-3 first:pt-1">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={!collapsed}
        aria-label={`${collapsed ? "Expand" : "Collapse"} ${label} project`}
        className="group/project flex w-full items-center gap-1.5 rounded px-1.5 py-1 text-left hover:bg-sidebar-accent/60 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
      >
        <span className={TRAILING_GLYPH_BOX_CLASS}>
          <Icon
            name="ChevronDown"
            className={cn(
              "size-3 text-muted-foreground/60 transition-transform group-hover/project:text-muted-foreground",
              !collapsed && "rotate-180",
            )}
          />
        </span>
        <span className="flex min-w-0 items-baseline gap-1.5">
          <span className="truncate text-2xs font-semibold uppercase tracking-[0.06em] text-muted-foreground/85">
            {label}
          </span>
          {collapsed ? (
            <span className="shrink-0 font-mono text-2xs tabular-nums text-muted-foreground/50">
              {count}
            </span>
          ) : null}
        </span>
        <span className="h-px flex-1 bg-sidebar-border/70" />
        {collapsed && working ? (
          <span className={TRAILING_GLYPH_BOX_CLASS}>
            <Icon
              name="Loading"
              aria-label={`${label} has active work`}
              className="size-3 animate-spin text-muted-foreground/60"
            />
          </span>
        ) : null}
      </button>
      {collapsed ? null : (
        <ul className="ml-2 mt-0.5 flex flex-col gap-px pl-1">{children}</ul>
      )}
    </section>
  );
}

function ParkedShelf({
  label,
  threads,
  expanded,
  onToggle,
  shelf,
  activeThreadId,
  lifecycle,
  onNavigate,
}: {
  label: string;
  threads: readonly PluginSidebarThread[];
  expanded: boolean;
  onToggle: () => void;
  shelf: "snoozed" | "settled";
  activeThreadId: string | null;
  lifecycle: ReturnType<typeof useLifecycle>;
  onNavigate: () => void;
}) {
  if (threads.length === 0) return null;
  const now = Date.now();
  return (
    <section aria-label={label}>
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={expanded}
        className="mt-3 flex w-full items-center gap-1.5 rounded-md px-2.5 py-1 text-left hover:bg-sidebar-accent/60 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
      >
        <span className="text-2xs font-medium text-muted-foreground/70">{label}</span>
        <span className="flex-1 font-mono text-2xs tabular-nums text-muted-foreground/50">
          {threads.length}
        </span>
        <span className={TRAILING_GLYPH_BOX_CLASS}>
          <Icon
            name="ChevronDown"
            className={cn("size-3 text-muted-foreground/70 transition-transform", expanded && "rotate-180")}
          />
        </span>
      </button>
      {expanded ? (
        <ul className="flex flex-col gap-px">
          {threads.map((thread) => (
            <SlimRow
              key={thread.id}
              thread={thread}
              isActive={thread.id === activeThreadId}
              shelf={shelf}
              wakeAt={lifecycle.wakeAtFor(thread)}
              now={now}
              onNavigate={onNavigate}
              onRestore={() =>
                shelf === "snoozed"
                  ? lifecycle.unsnooze(thread.id)
                  : lifecycle.unsettleMany(familyOf(threads, thread).map(({ id }) => id))
              }
              childThreads={shelf === "settled" ? descendantsOf(threads, thread.id) : []}
            />
          ))}
        </ul>
      ) : null}
    </section>
  );
}
