import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import {
  experimental_useSidebarThreads as useSidebarThreads,
  type PluginSidebarThread,
  type PluginThreadListProps,
  useRealtime,
  useRpc,
} from "@get-bb/plugin-sdk/app";
import type { rpcContract } from "./server";
import { Icon } from "./components/Icon";
import { cn } from "./lib/utils";
import { ThreadCard } from "./ThreadCard";
import { SlimRow } from "./SlimRow";
import { useLifecycle } from "./useLifecycle";
import { TRAILING_GLYPH_BOX_CLASS } from "./StatusSlot";
import {
  descendantsOf,
  familyOf,
  nestChildrenUnderParents,
  partitionPinned,
  searchThreadsByTitle,
  sortByCreatedAtDescending,
  visibleInboxThreads,
  type NestedThread,
} from "./inbox";

interface CuratorState {
  categories: { id: string; label: string; threadIds: string[] }[];
  status: "idle" | "organizing" | "error";
  updatedAt: number | null;
  model: string;
  error: string | null;
}

function useCuration() {
  const rpc = useRpc<typeof rpcContract>();
  const [state, setState] = useState<CuratorState | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const refresh = useCallback(() => {
    rpc.call("curationSnapshot").then(
      (next) => {
        setState(next);
        setLoadError(null);
      },
      (error: unknown) =>
        setLoadError(error instanceof Error ? error.message : String(error)),
    );
  }, [rpc]);
  useEffect(refresh, [refresh]);
  useRealtime("curation", refresh);
  const run = useCallback(() => {
    setState((current) =>
      current === null ? current : { ...current, status: "organizing", error: null },
    );
    void rpc.call("refreshCuration").then(refresh, (error: unknown) => {
      setLoadError(error instanceof Error ? error.message : String(error));
    });
  }, [refresh, rpc]);
  return { state, error: loadError, run };
}

export function ThreadInbox({
  activeThreadId,
  onNavigate,
  searchQuery,
}: PluginThreadListProps) {
  const { status, threads, projects } = useSidebarThreads();
  const lifecycle = useLifecycle(threads);
  const curation = useCuration();
  const [nowMinute, setNowMinute] = useState(() => Math.floor(Date.now() / 60_000));
  const [showSnoozed, setShowSnoozed] = useState(false);
  const [showSettled, setShowSettled] = useState(false);
  const [expandedParents, setExpandedParents] = useState<Set<string>>(() => new Set());
  const [collapsedCategories, setCollapsedCategories] = useState<Set<string>>(
    () => new Set(),
  );
  const [highlightedParent, setHighlightedParent] = useState<string | null>(null);

  useEffect(() => {
    const timer = setInterval(() => setNowMinute(Math.floor(Date.now() / 60_000)), 60_000);
    return () => clearInterval(timer);
  }, []);
  const now = nowMinute * 60_000;
  const projectNameById = useMemo(
    () => new Map(projects.map((project) => [project.id, project.name])),
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
    const assignment = new Map<string, string>();
    for (const category of curation.state?.categories ?? []) {
      for (const threadId of category.threadIds) assignment.set(threadId, category.id);
    }
    const allById = new Map(threads.map((thread) => [thread.id, thread]));
    const roots = new Map<string, PluginSidebarThread[]>();
    for (const thread of inbox) {
      const rootId = rootThreadId(thread, allById);
      const categoryId = assignment.get(rootId) ?? "uncategorized";
      const rows = roots.get(categoryId) ?? [];
      rows.push(thread);
      roots.set(categoryId, rows);
    }

    const categories: { id: string; label: string; rows: NestedThread[] }[] = [];
    for (const category of curation.state?.categories ?? []) {
      const categoryThreads = roots.get(category.id);
      if (!categoryThreads?.length) continue;
      categories.push({
        id: category.id,
        label: category.label,
        rows: nestChildrenUnderParents(categoryThreads),
      });
      roots.delete(category.id);
    }
    const leftovers = [...roots.values()].flat();
    if (leftovers.length > 0) {
      categories.push({
        id: "uncategorized",
        label: curation.state === null ? "Recent" : "Unsorted",
        rows: nestChildrenUnderParents(leftovers),
      });
    }
    return {
      pinned: nestChildrenUnderParents(pinned),
      categories,
      snoozed: [...snoozed].sort(
        (left, right) =>
          (lifecycle.wakeAtFor(left) ?? 0) - (lifecycle.wakeAtFor(right) ?? 0),
      ),
      settled: sortByCreatedAtDescending(settled),
    };
  }, [curation.state, lifecycle, searchQuery, threads]);

  const toggleChildren = (parentId: string) => {
    setExpandedParents((current) => toggleSet(current, parentId));
  };
  const toggleCategory = (categoryId: string) => {
    setCollapsedCategories((current) => toggleSet(current, categoryId));
  };
  const total =
    grouped.pinned.length +
    grouped.categories.reduce((count, category) => count + category.rows.length, 0) +
    grouped.snoozed.length +
    grouped.settled.length;
  const organizing = curation.state?.status === "organizing";
  const curationError = curation.error ?? curation.state?.error ?? null;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex shrink-0 items-center gap-2 px-2 pb-1">
        <span className="flex min-w-0 flex-1 items-center gap-1.5 px-1 text-xs font-medium text-muted-foreground">
          <Icon
            name={organizing ? "Loading" : "Workflow"}
            className={cn("size-3.5", organizing && "animate-spin")}
          />
          <span className="truncate">
            {organizing ? "Luna is organizing…" : "Curated work"}
          </span>
        </span>
        <button
          type="button"
          onClick={curation.run}
          disabled={organizing}
          title={curationError ?? "Refresh categories"}
          aria-label={curationError ? `Refresh categories. Last error: ${curationError}` : "Refresh categories"}
          className="rounded-md p-1 text-muted-foreground transition-colors hover:bg-sidebar-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:opacity-50"
        >
          <Icon name="ArrowTurnBackward" className="size-3.5" />
        </button>
      </div>

      {curationError ? (
        <p role="status" className="mx-2 mb-1 truncate text-2xs text-destructive-text">
          Kept the last layout · refresh to retry
        </p>
      ) : null}

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
                  projectNameById={projectNameById}
                  lifecycle={lifecycle}
                  now={now}
                  expandedParents={expandedParents}
                  highlightedParent={highlightedParent}
                  onToggleChildren={toggleChildren}
                  onHighlightParent={setHighlightedParent}
                  onNavigate={onNavigate}
                />
              </Shelf>
            ) : null}
            {grouped.categories.map((category) => (
              <CategoryShelf
                key={category.id}
                label={category.label}
                count={category.rows.filter((row) => !row.isNested).length}
                collapsed={collapsedCategories.has(category.id)}
                onToggle={() => toggleCategory(category.id)}
              >
                <ActiveRows
                  rows={category.rows}
                  allThreads={threads}
                  activeThreadId={activeThreadId}
                  projectNameById={projectNameById}
                  lifecycle={lifecycle}
                  now={now}
                  expandedParents={expandedParents}
                  highlightedParent={highlightedParent}
                  onToggleChildren={toggleChildren}
                  onHighlightParent={setHighlightedParent}
                  onNavigate={onNavigate}
                />
              </CategoryShelf>
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
  projectNameById,
  lifecycle,
  now,
  expandedParents,
  highlightedParent,
  onToggleChildren,
  onHighlightParent,
  onNavigate,
}: {
  rows: readonly NestedThread[];
  allThreads: readonly PluginSidebarThread[];
  activeThreadId: string | null;
  projectNameById: ReadonlyMap<string, string>;
  lifecycle: ReturnType<typeof useLifecycle>;
  now: number;
  expandedParents: ReadonlySet<string>;
  highlightedParent: string | null;
  onToggleChildren: (threadId: string) => void;
  onHighlightParent: (threadId: string | null) => void;
  onNavigate: () => void;
}) {
  return (
    <>
      {rows.map(({ thread, isNested, isLastSibling }) => {
        const childThreads = rows
          .filter((row) => row.thread.parentThreadId === thread.id)
          .map((row) => row.thread);
        const parentId = thread.parentThreadId;
        const parentInShelf = parentId !== null && rows.some((row) => row.thread.id === parentId);
        if (parentInShelf && !expandedParents.has(parentId)) return null;
        return (
          <ThreadCard
            key={thread.id}
            thread={thread}
            projectName={projectNameById.get(thread.projectId) ?? null}
            isActive={thread.id === activeThreadId}
            canPark={lifecycle.canPark(thread)}
            onNavigate={onNavigate}
            onSettle={() => lifecycle.settleMany(familyOf(allThreads, thread).map(({ id }) => id))}
            onSnooze={(until) => lifecycle.snooze(thread.id, until)}
            now={now}
            isNested={isNested}
            isLastSibling={isLastSibling}
            childThreads={childThreads}
            childrenCollapsed={childThreads.length > 0 && !expandedParents.has(thread.id)}
            onToggleChildren={
              childThreads.length > 0
                ? () => onToggleChildren(thread.id)
                : parentInShelf
                  ? () => onToggleChildren(parentId)
                  : undefined
            }
            connectorHighlighted={parentId === highlightedParent}
            onConnectorHighlight={
              parentInShelf
                ? (highlighted) => onHighlightParent(highlighted ? parentId : null)
                : undefined
            }
          />
        );
      })}
    </>
  );
}

function rootThreadId(
  thread: PluginSidebarThread,
  byId: ReadonlyMap<string, PluginSidebarThread>,
): string {
  let current = thread;
  const visited = new Set([thread.id]);
  while (current.parentThreadId !== null) {
    const parent = byId.get(current.parentThreadId);
    if (!parent || visited.has(parent.id)) break;
    visited.add(parent.id);
    current = parent;
  }
  return current.id;
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

function CategoryShelf({
  label,
  count,
  collapsed,
  onToggle,
  children,
}: {
  label: string;
  count: number;
  collapsed: boolean;
  onToggle: () => void;
  children: ReactNode;
}) {
  return (
    <section aria-label={label}>
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={!collapsed}
        className="mt-2.5 flex w-full items-center gap-2 rounded px-2.5 pb-1 pt-0.5 text-left focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
      >
        <span className="min-w-0 truncate text-2xs font-semibold text-muted-foreground/80">
          {label}
        </span>
        <span className="font-mono text-2xs tabular-nums text-muted-foreground/55">{count}</span>
        <span className="h-px flex-1 bg-sidebar-border" />
        <Icon
          name="ChevronDown"
          className={cn(
            "size-3 text-muted-foreground/60 transition-transform",
            !collapsed && "rotate-180",
          )}
        />
      </button>
      {collapsed ? null : <ul className="flex flex-col gap-px">{children}</ul>}
    </section>
  );
}

function Shelf({ label, children }: { label: string; children: ReactNode }) {
  return (
    <section aria-label={label}>
      <h2 className="flex items-center gap-2 px-2.5 pb-1 pt-3">
        <span className="text-2xs font-medium text-muted-foreground/70">{label}</span>
        <span className="h-px flex-1 bg-sidebar-border" />
      </h2>
      <ul className="flex flex-col gap-px">{children}</ul>
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
        className="mt-3 flex w-full items-center gap-2 px-2.5 pb-1 text-left"
      >
        <span className="text-2xs font-medium text-muted-foreground/70">
          {expanded ? label : `${label} (${threads.length})`}
        </span>
        <span className="h-px flex-1 bg-sidebar-border" />
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
