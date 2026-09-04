import { defineRpcContract, type BbPluginApi } from "@get-bb/plugin-sdk";
import { z } from "zod";
import {
  AUTO_ARCHIVE_OPTIONS,
  autoArchiveDelayMs,
  safeArchiveRoots,
  shouldAutoArchive,
} from "./auto-archive";
import {
  buildCuratorPrompt,
  normalizeCategories,
  parseCuratorAnswer,
  type CurationSnapshot,
  type CuratableThread,
  type NamingCandidate,
} from "./curation";
import {
  isNameable,
  shouldAutoRename,
  type NamingMode,
  type NamingRecord,
} from "./naming/policy";
import { cleanTitle, DEFAULT_INSTRUCTION } from "./naming/title";

const CURATION_KEY = "curation";
const RECORD_PREFIX = "named:";
export const CURATION_CHANNEL = "curation";
export const LIFECYCLE_CHANNEL = "lifecycle";

const MODE_OPTIONS: Record<string, NamingMode> = {
  "Name a thread once, after its first reply": "once",
  "Keep the name up to date as the thread grows": "always",
  "Never name threads automatically": "off",
};
const LENGTH_OPTIONS: Record<string, number> = {
  "Short — up to 32 characters": 32,
  "Medium — up to 48 characters": 48,
  "Long — up to 72 characters": 72,
};
const TIMEOUT_OPTIONS: Record<string, number> = {
  "30 seconds": 30_000,
  "1 minute": 60_000,
  "2 minutes": 120_000,
};
const MODEL_OPTIONS: Record<string, string> = {
  "Luna — efficient": "gpt-5.6-luna",
  "Sol — deeper": "gpt-5.6-sol",
};
const REASONING_OPTIONS = ["medium", "high", "xhigh"] as const;
type PermissionMode = "auto" | "accept-edits" | "full";
const PERMISSION_MODE_PREFERENCE: readonly PermissionMode[] = [
  "auto",
  "accept-edits",
  "full",
];

const lifecycleMigrations = [
  `CREATE TABLE IF NOT EXISTS thread_lifecycle (
     thread_id      TEXT PRIMARY KEY,
     settled_at     INTEGER,
     snoozed_until  INTEGER,
     snoozed_at     INTEGER
   )`,
];

export interface StoredLifecycleRow {
  threadId: string;
  settledAt: number | null;
  snoozedUntil: number | null;
  snoozedAt: number | null;
}

interface LifecycleDbRow {
  thread_id: string;
  settled_at: number | null;
  snoozed_until: number | null;
  snoozed_at: number | null;
}

const categorySchema = z.object({
  id: z.string(),
  label: z.string(),
  threadIds: z.array(z.string()),
});
const threadIdSchema = z.object({ threadId: z.string().trim().min(1) });
const threadIdsSchema = z.object({
  threadIds: z.array(z.string().trim().min(1)).min(1),
});

export const rpcContract = defineRpcContract({
  curationSnapshot: {
    input: z.null(),
    output: z.object({
      categories: z.array(categorySchema),
      status: z.enum(["idle", "organizing", "error"]),
      updatedAt: z.number().nullable(),
      model: z.string(),
      error: z.string().nullable(),
    }),
  },
  refreshCuration: {
    input: z.null(),
    output: z.object({ accepted: z.boolean() }),
  },
  rename: {
    input: threadIdSchema.strict(),
    output: z.union([
      z.object({ ok: z.literal(true), title: z.string() }),
      z.object({ ok: z.literal(false), error: z.string() }),
    ]),
  },
  listLifecycle: {
    input: z.object({}),
    output: z.object({
      rows: z.array(
        z.object({
          threadId: z.string(),
          settledAt: z.number().nullable(),
          snoozedUntil: z.number().nullable(),
          snoozedAt: z.number().nullable(),
        }),
      ),
    }),
  },
  settleMany: { input: threadIdsSchema, output: z.object({ ok: z.boolean() }) },
  unsettleMany: { input: threadIdsSchema, output: z.object({ ok: z.boolean() }) },
  snooze: {
    input: z.object({
      threadId: z.string().trim().min(1),
      snoozedUntil: z.number().int().positive(),
    }),
    output: z.object({ ok: z.boolean() }),
  },
  unsnooze: { input: threadIdSchema, output: z.object({ ok: z.boolean() }) },
});

export default function plugin(bb: BbPluginApi) {
  const settings = bb.settings.define({
    automaticCuration: {
      type: "boolean",
      label: "Automatic curation",
      description: "Reorganize the active sidebar after a new parent thread becomes useful.",
      default: true,
    },
    mode: {
      type: "select",
      label: "Automatic naming",
      description: "A title you typed yourself is never overwritten.",
      options: Object.keys(MODE_OPTIONS),
      default: "Keep the name up to date as the thread grows",
    },
    length: {
      type: "select",
      label: "Name length",
      options: Object.keys(LENGTH_OPTIONS),
      default: "Short — up to 32 characters",
    },
    instruction: {
      type: "string",
      label: "Naming instruction",
      default: DEFAULT_INSTRUCTION,
    },
    model: {
      type: "select",
      label: "Curator model",
      description: "One hidden worker names eligible threads and refreshes every category in a single pass.",
      options: Object.keys(MODEL_OPTIONS),
      default: "Luna — efficient",
    },
    reasoning: {
      type: "select",
      label: "Curator reasoning",
      options: [...REASONING_OPTIONS],
      default: "high",
    },
    timeout: {
      type: "select",
      label: "Worker timeout",
      options: Object.keys(TIMEOUT_OPTIONS),
      default: "1 minute",
    },
    autoArchiveSettledAfter: {
      type: "select",
      label: "Auto-archive settled threads after",
      options: [...AUTO_ARCHIVE_OPTIONS],
      default: "Never",
    },
  });

  const db = bb.storage.database();
  bb.storage.migrate(db, lifecycleMigrations);
  let status: "idle" | "organizing" | "error" = "idle";
  let lastError: string | null = null;
  let queue = Promise.resolve();
  const pendingAutomatic = new Set<string>();
  let batchTimer: ReturnType<typeof setTimeout> | null = null;
  let initialTimer: ReturnType<typeof setTimeout> | null = null;

  const publishCuration = () => {
    bb.realtime.publish(CURATION_CHANNEL, { status });
  };

  const readCuration = async (): Promise<CurationSnapshot | null> =>
    (await bb.storage.kv.get<CurationSnapshot>(CURATION_KEY)) ?? null;

  const enqueue = <T>(job: () => Promise<T>): Promise<T> => {
    const next = queue.then(job, job);
    queue = next.then(
      () => undefined,
      () => undefined,
    );
    return next;
  };

  async function listParentThreads(): Promise<Awaited<ReturnType<typeof bb.sdk.threads.list>>> {
    const all: Awaited<ReturnType<typeof bb.sdk.threads.list>> = [];
    const pageSize = 200;
    for (let offset = 0; ; offset += pageSize) {
      const page = await bb.sdk.threads.list({
        archived: false,
        hasParent: false,
        includeHidden: false,
        limit: pageSize,
        offset,
      });
      all.push(
        ...page.filter(
          (thread) =>
            thread.visibility === "visible" &&
            thread.originPluginId !== bb.pluginId,
        ),
      );
      if (page.length < pageSize) break;
    }
    return all.sort(
      (left, right) =>
        right.createdAt - left.createdAt || left.id.localeCompare(right.id),
    );
  }

  function activeParentThreads(
    threads: Awaited<ReturnType<typeof bb.sdk.threads.list>>,
    explicitlyIncludedIds: readonly string[] = [],
  ): Awaited<ReturnType<typeof bb.sdk.threads.list>> {
    const explicitlyIncluded = new Set(explicitlyIncludedIds);
    const parked = new Set(
      (
        db
          .prepare(
            `SELECT thread_id FROM thread_lifecycle
             WHERE settled_at IS NOT NULL OR snoozed_until > ?`,
          )
          .all(Date.now()) as { thread_id: string }[]
      ).map((row) => row.thread_id),
    );
    return threads.filter(
      (thread) => explicitlyIncluded.has(thread.id) || !parked.has(thread.id),
    );
  }

  async function namingCandidates(
    requestedIds: readonly string[],
    force: boolean,
    threads: Awaited<ReturnType<typeof bb.sdk.threads.list>>,
    maxChars: number,
    mode: NamingMode,
  ): Promise<{ candidates: NamingCandidate[]; maxSeqById: Map<string, number> }> {
    const indexById = new Map(threads.map((thread, index) => [thread.id, index]));
    const candidates: NamingCandidate[] = [];
    const maxSeqById = new Map<string, number>();
    for (const threadId of new Set(requestedIds)) {
      const threadIndex = indexById.get(threadId);
      if (threadIndex === undefined) continue;
      const thread = threads[threadIndex]!;
      const outline = await bb.sdk.threads
        .conversationOutline({ threadId })
        .catch(() => ({ items: [], maxSeq: 0 }));
      const record =
        (await bb.storage.kv.get<NamingRecord>(`${RECORD_PREFIX}${threadId}`)) ??
        null;
      const facts = {
        title: thread.title,
        visibility: thread.visibility,
        parentThreadId: thread.parentThreadId,
        archivedAt: thread.archivedAt,
        deletedAt: thread.deletedAt,
        originPluginId: thread.originPluginId,
      };
      const decision = force
        ? isNameable(facts, bb.pluginId)
        : shouldAutoRename(facts, record, mode, bb.pluginId, outline.maxSeq);
      if (!decision.rename) continue;
      const items = outline.items
        .slice(0, 8)
        .map((item) => ({
          role: item.role,
          preview: item.preview.replace(/\s+/g, " ").trim().slice(0, 500),
        }))
        .filter((item) => item.preview !== "");
      if (items.length === 0) continue;
      candidates.push({ threadIndex, maxChars, outline: items });
      maxSeqById.set(threadId, outline.maxSeq);
    }
    return { candidates, maxSeqById };
  }

  async function curate(
    requestedIds: readonly string[],
    forceName: boolean,
  ): Promise<Map<string, string>> {
    status = "organizing";
    lastError = null;
    publishCuration();
    let workerId: string | null = null;
    try {
      const configured = await settings.get();
      const mode = MODE_OPTIONS[configured.mode] ?? "once";
      const maxChars = LENGTH_OPTIONS[configured.length] ?? 48;
      const timeoutMs = TIMEOUT_OPTIONS[configured.timeout] ?? 60_000;
      const model = MODEL_OPTIONS[configured.model] ?? "gpt-5.6-luna";
      const reasoning = REASONING_OPTIONS.includes(
        configured.reasoning as (typeof REASONING_OPTIONS)[number],
      )
        ? (configured.reasoning as (typeof REASONING_OPTIONS)[number])
        : "high";
      const allParentThreads = await listParentThreads();
      const sourceThreads = activeParentThreads(
        allParentThreads,
        forceName ? requestedIds : [],
      );
      const projects = await bb.sdk.projects.list({ includePersonal: true });
      const projectNames = new Map(projects.map((project) => [project.id, project.name]));
      const curatable: CuratableThread[] = sourceThreads.map((thread) => ({
        id: thread.id,
        title: thread.title?.trim() || thread.titleFallback?.trim() || "Untitled thread",
        project: projectNames.get(thread.projectId) ?? "Personal",
        status: thread.status,
        updatedAt: thread.updatedAt,
      }));
      const prepared = await namingCandidates(
        requestedIds,
        forceName,
        sourceThreads,
        maxChars,
        mode,
      );
      if (curatable.length === 0) {
        await bb.storage.kv.set(CURATION_KEY, {
          categories: [],
          updatedAt: Date.now(),
          model,
        } satisfies CurationSnapshot);
        status = "idle";
        publishCuration();
        return new Map();
      }

      const previous = (await readCuration())?.categories ?? [];
      const prompt = buildCuratorPrompt({
        threads: curatable,
        namingCandidates: prepared.candidates,
        previous,
        namingInstruction: configured.instruction.trim() || DEFAULT_INSTRUCTION,
      });
      const target =
        sourceThreads.find((thread) => requestedIds.includes(thread.id)) ??
        sourceThreads[0]!;
      const permissionMode = await restrictedPermissionMode(bb, "codex");
      const worker = await bb.sdk.threads.spawn({
        projectId: target.projectId,
        environment:
          target.environmentId === null
            ? { type: "project-default" }
            : { type: "reuse", environmentId: target.environmentId },
        prompt,
        title: "Curate threads",
        visibility: "hidden",
        providerId: "codex",
        model,
        reasoningLevel: reasoning,
        ...(permissionMode ? { permissionMode } : {}),
        executionInputSources: {
          providerId: "explicit",
          model: "explicit",
          reasoningLevel: "explicit",
          ...(permissionMode ? { permissionMode: "explicit" as const } : {}),
        },
      });
      workerId = worker.id;
      await waitForWorker(bb, worker.id, timeoutMs);
      const { output } = await bb.sdk.threads.output({ threadId: worker.id });
      if (!output) throw new Error("Luna returned an empty response.");
      const answer = parseCuratorAnswer(output);
      const categories = normalizeCategories(answer, curatable);
      const writtenNames = new Map<string, string>();
      const candidateIndexes = new Set(
        prepared.candidates.map((candidate) => candidate.threadIndex),
      );
      for (const proposed of answer.names) {
        if (!candidateIndexes.has(proposed.threadIndex)) continue;
        const thread = sourceThreads[proposed.threadIndex];
        if (!thread) continue;
        const title = cleanTitle(proposed.title, maxChars);
        if (!title) continue;
        await bb.sdk.threads.update({ threadId: thread.id, title });
        await bb.storage.kv.set(`${RECORD_PREFIX}${thread.id}`, {
          title,
          at: Date.now(),
          maxSeq: prepared.maxSeqById.get(thread.id) ?? 0,
        } satisfies NamingRecord);
        writtenNames.set(thread.id, title);
      }
      await bb.storage.kv.set(CURATION_KEY, {
        categories,
        updatedAt: Date.now(),
        model,
      } satisfies CurationSnapshot);
      status = "idle";
      bb.log.info(
        `curated ${curatable.length} threads into ${categories.length} categories with ${model}`,
      );
      publishCuration();
      return writtenNames;
    } catch (error) {
      lastError = describeError(error);
      status = "error";
      bb.log.warn(`curation failed: ${lastError}`);
      publishCuration();
      throw error;
    } finally {
      if (workerId !== null) await cleanUpWorker(bb, workerId);
    }
  }

  const queueAutomatic = (threadId: string) => {
    pendingAutomatic.add(threadId);
    if (batchTimer !== null) clearTimeout(batchTimer);
    batchTimer = setTimeout(() => {
      batchTimer = null;
      const threadIds = [...pendingAutomatic];
      pendingAutomatic.clear();
      void enqueue(() => curate(threadIds, false)).catch(() => {});
    }, 1_500);
  };

  const readAllLifecycle = (): StoredLifecycleRow[] =>
    (
      db
        .prepare(
          `SELECT thread_id, settled_at, snoozed_until, snoozed_at FROM thread_lifecycle`,
        )
        .all() as LifecycleDbRow[]
    ).map((row) => ({
      threadId: row.thread_id,
      settledAt: row.settled_at,
      snoozedUntil: row.snoozed_until,
      snoozedAt: row.snoozed_at,
    }));
  const clearLifecycle = (threadId: string) => {
    db.prepare(`DELETE FROM thread_lifecycle WHERE thread_id = ?`).run(threadId);
    bb.realtime.publish(LIFECYCLE_CHANNEL, { threadId });
  };
  const settleMany = db.transaction((threadIds: readonly string[]) => {
    const settledAt = Date.now();
    const statement = db.prepare(
      `INSERT INTO thread_lifecycle (thread_id, settled_at, snoozed_until, snoozed_at)
       VALUES (?, ?, NULL, NULL)
       ON CONFLICT(thread_id) DO UPDATE SET settled_at = excluded.settled_at, snoozed_until = NULL, snoozed_at = NULL`,
    );
    for (const threadId of new Set(threadIds)) statement.run(threadId, settledAt);
  });
  const unsettleMany = db.transaction((threadIds: readonly string[]) => {
    const statement = db.prepare(`DELETE FROM thread_lifecycle WHERE thread_id = ?`);
    for (const threadId of new Set(threadIds)) statement.run(threadId);
  });

  bb.rpc.register(rpcContract, {
    async curationSnapshot() {
      const snapshot = await readCuration();
      return {
        categories: snapshot?.categories ?? [],
        status,
        updatedAt: snapshot?.updatedAt ?? null,
        model: snapshot?.model ?? "gpt-5.6-luna",
        error: lastError,
      };
    },
    refreshCuration() {
      void enqueue(() => curate([], false)).catch(() => {});
      return { accepted: true };
    },
    async rename({ threadId }) {
      try {
        const names = await enqueue(() => curate([threadId], true));
        const title = names.get(threadId);
        return title
          ? { ok: true as const, title }
          : { ok: false as const, error: "This thread did not need a generated name." };
      } catch (error) {
        return { ok: false as const, error: describeError(error) };
      }
    },
    listLifecycle() {
      return { rows: readAllLifecycle() };
    },
    settleMany({ threadIds }) {
      settleMany(threadIds);
      bb.realtime.publish(LIFECYCLE_CHANNEL, { threadIds });
      return { ok: true };
    },
    unsettleMany({ threadIds }) {
      unsettleMany(threadIds);
      bb.realtime.publish(LIFECYCLE_CHANNEL, { threadIds });
      return { ok: true };
    },
    snooze({ threadId, snoozedUntil }) {
      const now = Date.now();
      db.prepare(
        `INSERT INTO thread_lifecycle (thread_id, settled_at, snoozed_until, snoozed_at)
         VALUES (?, NULL, ?, ?)
         ON CONFLICT(thread_id) DO UPDATE SET settled_at = NULL, snoozed_until = excluded.snoozed_until, snoozed_at = excluded.snoozed_at`,
      ).run(threadId, snoozedUntil, now);
      bb.realtime.publish(LIFECYCLE_CHANNEL, { threadId });
      return { ok: true };
    },
    unsnooze({ threadId }) {
      clearLifecycle(threadId);
      return { ok: true };
    },
  });

  bb.events.on("thread.idle", ({ thread }) => {
    if (!isNameable(thread, bb.pluginId).rename) return;
    void (async () => {
      const configured = await settings.get();
      if (!configured.automaticCuration && MODE_OPTIONS[configured.mode] === "off") return;
      const snapshot = await readCuration();
      const isAssigned =
        snapshot?.categories.some((category) => category.threadIds.includes(thread.id)) ??
        false;
      if (configured.automaticCuration && !isAssigned) {
        queueAutomatic(thread.id);
        return;
      }
      const outline = await bb.sdk.threads
        .conversationOutline({ threadId: thread.id })
        .catch(() => ({ maxSeq: 0 }));
      const record =
        (await bb.storage.kv.get<NamingRecord>(`${RECORD_PREFIX}${thread.id}`)) ??
        null;
      const decision = shouldAutoRename(
        thread,
        record,
        MODE_OPTIONS[configured.mode] ?? "once",
        bb.pluginId,
        outline.maxSeq,
      );
      if (decision.rename) queueAutomatic(thread.id);
    })().catch((error: unknown) =>
      bb.log.debug(`could not queue ${thread.id}: ${describeError(error)}`),
    );
  });

  for (const event of ["thread.archived", "thread.deleted"] as const) {
    bb.events.on(event, ({ thread }) => {
      if (thread.originPluginId === bb.pluginId) return;
      clearLifecycle(thread.id);
      void bb.storage.kv.delete(`${RECORD_PREFIX}${thread.id}`).catch(() => {});
      void (async () => {
        const configured = await settings.get();
        if (configured.automaticCuration) queueAutomatic(thread.id);
      })();
    });
  }

  bb.background.schedule("auto-archive-settled", "17 * * * *", async () => {
    const delayMs = autoArchiveDelayMs(
      (await settings.get()).autoArchiveSettledAfter,
    );
    if (delayMs === null) return;
    const now = Date.now();
    const candidates = readAllLifecycle().filter(
      (row): row is StoredLifecycleRow & { settledAt: number } =>
        row.settledAt !== null && row.settledAt + delayMs <= now,
    );
    if (candidates.length === 0) return;
    const liveThreads = new Map<string, Awaited<ReturnType<typeof bb.sdk.threads.list>>[number]>();
    const pageSize = 200;
    for (let offset = 0; ; offset += pageSize) {
      const page = await bb.sdk.threads.list({ archived: false, includeHidden: true, limit: pageSize, offset });
      for (const thread of page) liveThreads.set(thread.id, thread);
      if (page.length < pageSize) break;
    }
    const eligibleIds = new Set<string>();
    for (const row of candidates) {
      const thread = liveThreads.get(row.threadId);
      if (thread && shouldAutoArchive(row.settledAt, delayMs, now, thread)) {
        eligibleIds.add(row.threadId);
      }
    }
    for (const threadId of safeArchiveRoots([...liveThreads.values()], eligibleIds)) {
      await bb.sdk.threads.archive({ threadId });
    }
  });

  initialTimer = setTimeout(() => {
    void (async () => {
      const configured = await settings.get();
      if (!configured.automaticCuration) return;
      const [snapshot, allParentThreads] = await Promise.all([
        readCuration(),
        listParentThreads(),
      ]);
      const threads = activeParentThreads(allParentThreads);
      const assigned = new Set(snapshot?.categories.flatMap((category) => category.threadIds) ?? []);
      if (snapshot === null || threads.some((thread) => !assigned.has(thread.id))) {
        await enqueue(() => curate([], false));
      }
    })().catch((error: unknown) =>
      bb.log.warn(`initial curation failed: ${describeError(error)}`),
    );
  }, 2_000);

  bb.cli.register({
    name: "thread-curator",
    summary: "Refresh thread categories or rename a thread with the shared Luna worker",
    commands: [
      { name: "refresh", summary: "Rebuild the live category map", usage: "bb thread-curator refresh" },
      { name: "rename", summary: "Rename a thread and refresh categories", usage: "bb thread-curator rename [<threadId>]" },
      { name: "status", summary: "Show the current curator state", usage: "bb thread-curator status" },
    ],
    async run(argv, ctx) {
      const [command, threadIdArg] = argv;
      if (command === "refresh") {
        await enqueue(() => curate([], false));
        return { exitCode: 0, stdout: "Thread categories refreshed.\n" };
      }
      if (command === "rename") {
        const threadId = threadIdArg ?? ctx.threadId;
        if (!threadId) return { exitCode: 2, stderr: "Pass a thread id or run this inside a thread.\n" };
        const names = await enqueue(() => curate([threadId], true));
        const title = names.get(threadId);
        return title
          ? { exitCode: 0, stdout: `${title}\n` }
          : { exitCode: 1, stderr: "The worker did not return a usable title.\n" };
      }
      if (command === "status" || command === undefined) {
        const snapshot = await readCuration();
        return {
          exitCode: 0,
          stdout: [
            `Status: ${status}`,
            `Model: ${snapshot?.model ?? "gpt-5.6-luna"}`,
            `Categories: ${snapshot?.categories.length ?? 0}`,
            ...(lastError ? [`Error: ${lastError}`] : []),
            "",
          ].join("\n"),
        };
      }
      return { exitCode: 2, stderr: "Try: refresh, rename, status\n" };
    },
  });

  bb.onDispose(() => {
    if (batchTimer !== null) clearTimeout(batchTimer);
    if (initialTimer !== null) clearTimeout(initialTimer);
  });
}

async function restrictedPermissionMode(
  bb: BbPluginApi,
  providerId: string,
): Promise<PermissionMode | null> {
  const providers = await bb.sdk.providers.list().catch(() => []);
  const supported = providers.find((provider) => provider.id === providerId)
    ?.capabilities.permissionModes;
  if (!supported) return null;
  return PERMISSION_MODE_PREFERENCE.find((mode) => supported.includes(mode)) ?? null;
}

async function waitForWorker(bb: BbPluginApi, threadId: string, timeoutMs: number) {
  try {
    const completed = await bb.sdk.threads.wait({
      threadId,
      event: "turn/completed",
      timeoutMs,
    });
    const event = "event" in completed ? completed.event : null;
    if (event?.type === "turn/completed" && event.data.status !== "completed") {
      throw new Error(event.data.error?.message ?? "Luna stopped without answering.");
    }
  } catch (error) {
    const state = await bb.sdk.threads.get({ threadId }).catch(() => null);
    throw state?.status === "error"
      ? new Error("Luna stopped with an error.")
      : new Error(`Luna did not answer in time: ${describeError(error)}`);
  }
}

async function cleanUpWorker(bb: BbPluginApi, threadId: string) {
  await bb.sdk.threads.stop({ threadId }).catch((error: unknown) =>
    bb.log.warn(`could not stop ${threadId}: ${describeError(error)}`),
  );
  await bb.sdk.threads
    .delete({ threadId, childThreadsConfirmed: true })
    .catch(async (error: unknown) => {
      bb.log.warn(`could not delete ${threadId}: ${describeError(error)}`);
      await bb.sdk.threads.archive({ threadId }).catch(() => {});
    });
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
