import { useEffect, useRef, useState } from "react";

const POLL_INTERVAL_MS = 3_000;
const DISCOVERY_EVERY_POLLS = 5;

interface WorkflowActiveRunsResponse {
  ok: boolean;
  result?: { runs?: unknown[] };
}

/** Thread ids whose durable BB workflow is queued or running. */
export function useDurableWorkflowThreadIds(
  threadIds: readonly string[],
): ReadonlySet<string> {
  const [active, setActive] = useState<ReadonlySet<string>>(() => new Set());
  const activeRef = useRef<ReadonlySet<string>>(active);
  const key = threadIds.join("\0");

  useEffect(() => {
    let cancelled = false;
    let refreshing = false;
    let polls = 0;

    const refresh = async (ids: readonly string[]) => {
      if (refreshing) return;
      refreshing = true;
      const results = await Promise.all(
        ids.map(async (threadId) => {
          try {
            const response = await fetch(
              "/api/v1/plugins/workflows/rpc/workflowActiveRuns",
              {
                method: "POST",
                headers: { "content-type": "application/json" },
                body: JSON.stringify({ threadId }),
              },
            );
            if (!response.ok) return null;
            const envelope = (await response.json()) as WorkflowActiveRunsResponse;
            return envelope.ok && (envelope.result?.runs?.length ?? 0) > 0
              ? threadId
              : null;
          } catch {
            return null;
          }
        }),
      );
      if (!cancelled) {
        const next = new Set(results.filter((id): id is string => id !== null));
        activeRef.current = next;
        setActive(next);
      }
      refreshing = false;
    };

    void refresh(threadIds);
    const activeTimer = setInterval(() => {
      polls += 1;
      const activeIds = [...activeRef.current];
      void refresh(
        polls % DISCOVERY_EVERY_POLLS === 0 || activeIds.length === 0
          ? threadIds
          : activeIds,
      );
    }, POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(activeTimer);
    };
  }, [key]);

  return active;
}
