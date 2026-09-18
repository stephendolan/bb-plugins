import {
  experimental_useSidebarThreadPullRequest as useSidebarThreadPullRequest,
  experimental_useSidebarThreadSplit as useSidebarThreadSplit,
  experimental_useSidebarThreadActions as useSidebarThreadActions,
  type PluginSidebarThread,
} from "@get-bb/plugin-sdk/app";
import { Icon, type IconName } from "./components/Icon";
import { cn } from "./lib/utils";
import { RowContextMenu } from "./RowContextMenu";
import { providerLabel } from "./ProviderGlyph";
import { STATUS_SLOT_CLASS, StatusOrTime } from "./StatusSlot";
import { threadDisplayTitle } from "./inbox";
import { resolveSnoozePresets } from "./lifecycle";

/**
 * One thread as a two-line card: the title line carries status or age and
 * child disclosure; the line beneath names the agent and machine and carries
 * pull request and activity counts. Child rows use bb's compact indented
 * representation while parent rows keep the curator's metadata and lifecycle
 * controls.
 *
 * The row is a positioned container with a full-bleed anchor UNDER the
 * controls, the way bb's own thread row does it: a `<button>` inside an `<a>`
 * is invalid interactive nesting and breaks keyboard behaviour.
 */
export function ThreadCard({
  thread,
  isActive,
  canPark,
  onNavigate,
  onSettle,
  onSnooze,
  now,
  isNested = false,
  nestingDepth = 0,
  childThreads = [],
  childrenCollapsed = false,
  onToggleChildren,
}: {
  thread: PluginSidebarThread;
  isActive: boolean;
  /** False while the thread is working or blocked on the user. */
  canPark: boolean;
  onNavigate: () => void;
  onSettle: () => void;
  onSnooze: (snoozedUntil: number) => void;
  /** Quantized clock, so every card in one render agrees on "now". */
  now: number;
  /** A visible child rendered immediately after its parent. */
  isNested?: boolean;
  nestingDepth?: number;
  childThreads?: readonly PluginSidebarThread[];
  childrenCollapsed?: boolean;
  onToggleChildren?: () => void;
}) {
  const actions = useSidebarThreadActions();
  const { splitProps, layout } = useSidebarThreadSplit(thread.id);
  // Opt-in per row: this costs a git-host lookup, and threads sharing a
  // worktree share one.
  const { pullRequest } = useSidebarThreadPullRequest(thread.id);

  return (
    <RowContextMenu thread={thread} onSettle={canPark ? onSettle : undefined}>
      <li className="relative list-none">
        <div
          className={cn(
            "group/card relative rounded-md px-2.5 transition-colors",
            isNested ? "py-1" : "py-1.5",
            isActive ? "bg-sidebar-accent" : "hover:bg-sidebar-accent/60",
            // A thread open in another pane gets a weaker tint than the active
            // row, so the two states stay distinguishable.
            !isActive && layout !== null && "bg-sidebar-accent/30",
          )}
          style={{ marginLeft: isNested ? nestingDepth * 16 : 0 }}
        >
          <a
            // Both attributes, or bb's nine thread shortcuts stop finding rows.
            data-sidebar-thread-shortcut-target=""
            data-sidebar-thread-id={thread.id}
            href="#"
            aria-label={threadDisplayTitle(thread)}
            {...splitProps}
            onClick={(event) => {
              event.preventDefault();
              actions.open(thread.id, {
                split: event.metaKey || event.ctrlKey,
              });
              onNavigate();
            }}
            className="absolute inset-0 cursor-pointer rounded-md"
          />
          <div
            className={cn(
              // Weight alone carries unread. Fading the title — or the whole
              // card — makes a thread at rest read as disabled, and at rest is
              // what most of the list is most of the time.
              "pointer-events-none relative flex h-5 min-w-0 items-center gap-1.5 text-foreground",
              thread.isUnread && "font-medium",
            )}
          >
            <span className="min-w-0 flex-1 truncate text-sm">
              {threadDisplayTitle(thread)}
            </span>
            {/* Status at rest, park actions on hover. Only the slot yields, so
                the title never shifts. */}
            {!isNested && canPark ? (
              <span className="pointer-events-auto hidden items-center gap-0.5 group-hover/card:flex">
                <ParkButton
                  label="Snooze until tomorrow"
                  icon="Clock"
                  onActivate={() =>
                    onSnooze(resolveSnoozePresets(new Date())[2]!.snoozedUntil)
                  }
                />
                <ParkButton
                  label="Settle thread"
                  icon="Check"
                  onActivate={onSettle}
                />
              </span>
            ) : null}
            {!isNested ? (
              <span
                className={cn(
                  STATUS_SLOT_CLASS,
                  canPark && "group-hover/card:hidden",
                )}
              >
                <StatusOrTime thread={thread} now={now} />
              </span>
            ) : null}
            {childThreads.length > 0 && onToggleChildren ? (
              <button
                type="button"
                aria-expanded={!childrenCollapsed}
                aria-label={`${childrenCollapsed ? "Expand" : "Collapse"} ${childThreads.length} child ${childThreads.length === 1 ? "thread" : "threads"}`}
                onClick={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  onToggleChildren();
                }}
                className="pointer-events-auto relative -mr-1 rounded p-1 text-muted-foreground hover:text-foreground"
              >
                <Icon
                  name="ChevronDown"
                  className={cn(
                    "size-3 transition-transform",
                    childrenCollapsed && "-rotate-90",
                  )}
                />
              </button>
            ) : null}
          </div>
          {!isNested ? (
            <div className="pointer-events-none relative mt-0.5 flex h-4 items-center gap-1.5">
              <span className="flex min-w-0 flex-1 items-center gap-1 text-2xs text-muted-foreground">
                <span className="truncate">
                  {providerLabel(thread.providerId)}
                  {thread.host ? ` · ${thread.host.name}` : ""}
                </span>
                {thread.environment?.workspaceDisplayKind === "managed-worktree" ||
                thread.environment?.workspaceDisplayKind === "unmanaged-worktree" ? (
                  <span
                    role="img"
                    aria-label="Worktree"
                    className="flex shrink-0 items-center gap-1"
                  >
                    <span aria-hidden="true">·</span>
                    <Icon name="GitBranch" className="size-2.5" aria-hidden="true" />
                  </span>
                ) : null}
              </span>
              {thread.activity.workflows > 0 ? (
                <ActivityCount
                  label="workflows"
                  count={thread.activity.workflows}
                />
              ) : null}
              {thread.activity.backgroundAgents > 0 ? (
                <ActivityCount
                  label="background agents"
                  count={thread.activity.backgroundAgents}
                />
              ) : null}
              {pullRequest ? (
                <a
                  href={pullRequest.url}
                  target="_blank"
                  rel="noreferrer"
                  onClick={(event) => event.stopPropagation()}
                  title={pullRequest.title}
                  className={cn(
                    "pointer-events-auto relative shrink-0 font-mono text-2xs hover:underline",
                    pullRequest.state === "merged"
                      ? "text-[color:var(--pr-merged)]"
                      : pullRequest.attention === "checks_failed" ||
                          pullRequest.attention === "conflicts"
                        ? "text-destructive-text"
                        : pullRequest.attention === "ready_to_merge"
                          ? "text-success-foreground"
                          : "text-muted-foreground",
                  )}
                >
                  #{pullRequest.number}
                </a>
              ) : null}
            </div>
          ) : null}
        </div>
      </li>
    </RowContextMenu>
  );
}

function ParkButton({
  label,
  icon,
  onActivate,
}: {
  label: string;
  icon: Extract<IconName, "Clock" | "Check">;
  onActivate: () => void;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      onClick={(event) => {
        event.preventDefault();
        event.stopPropagation();
        onActivate();
      }}
      className="rounded p-0.5 text-muted-foreground hover:text-foreground"
    >
      <Icon name={icon} className="size-3.5" />
    </button>
  );
}

function ActivityCount({ label, count }: { label: string; count: number }) {
  return (
    <span
      aria-label={`${count} ${label}`}
      className="shrink-0 rounded bg-muted px-1 font-mono text-2xs text-muted-foreground"
    >
      {count}
    </span>
  );
}
