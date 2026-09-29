import path from 'node:path';
import { defineRpcContract, type BbPluginApi } from '@get-bb/plugin-sdk';
import { z } from 'zod';

const request = z.object({ threadId: z.string().min(1) });
export const rpcContract = defineRpcContract({
  ensureTab: { input: request, output: z.object({ available: z.boolean(), open: z.boolean() }) },
  list: {
    input: request.extend({ directory: z.string().default('') }),
    output: z.object({
      root: z.string(), hostId: z.string(), directory: z.string(), truncated: z.boolean(),
      entries: z.array(z.object({ name: z.string(), path: z.string(), kind: z.enum(['file', 'directory']) })),
    }),
  },
});

export function resolveDirectory(root: string, directory: string) {
  const resolved = path.resolve(root, directory);
  const relative = path.relative(root, resolved);
  if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new Error('Choose a folder inside this thread’s directory.');
  }
  return resolved;
}

export default function plugin(bb: BbPluginApi) {
  async function environment(threadId: string) {
    const thread = await bb.sdk.threads.get({ threadId });
    const projects = await bb.sdk.projects.list({ includePersonal: true });
    if (!projects.some(project => project.id === thread.projectId && project.kind === 'personal')) return null;
    if (!thread.environmentId) throw new Error('This thread does not have a directory yet.');
    const env = await bb.sdk.environments.get({ environmentId: thread.environmentId });
    if (!env.path) throw new Error('This thread does not have a directory yet.');
    return env;
  }
  const pending = new Map<string, Promise<{ available: boolean; open: boolean }>>();
  async function ensureTab(threadId: string) {
    const env = await environment(threadId);
    if (!env) return { available: false, open: false };
    const key = `tab-installed:${threadId}`;
    if (await bb.storage.kv.get(key)) return { available: true, open: false };
    const current = await bb.sdk.threads.tabs.get({ threadId });
    if (!current.tabs.some(tab => tab.kind === 'plugin-panel' && tab.pluginId === 'personal-files' && tab.actionId === 'files')) {
      await bb.sdk.threads.tabs.update({ threadId, expectedRevision: current.revision, tabs: [...current.tabs, {
        id: 'plugin:personal-files:files', kind: 'plugin-panel', pluginId: 'personal-files', actionId: 'files', title: 'Files', paramsJson: null,
      }] });
    }
    await bb.storage.kv.set(key, true);
    return { available: true, open: true };
  }
  bb.rpc.register(rpcContract, {
    ensureTab({ threadId }) {
      const existing = pending.get(threadId);
      if (existing) return existing;
      const result = ensureTab(threadId).finally(() => pending.delete(threadId));
      pending.set(threadId, result);
      return result;
    },
    async list({ threadId, directory }) {
      const env = await environment(threadId);
      if (!env?.path) throw new Error('Files is available for personal threads.');
      const folder = resolveDirectory(env.path, directory);
      const result = await bb.sdk.files.listPaths({ hostId: env.hostId, path: folder, includeFiles: true, includeDirectories: true, limit: 1000 });
      return {
        root: env.path, hostId: env.hostId, directory: path.relative(env.path, folder), truncated: result.truncated,
        entries: result.paths.filter(entry => path.dirname(path.resolve(folder, entry.path)) === folder).map(entry => ({ name: entry.name, path: entry.path, kind: entry.kind })).sort((a, b) => {
          if (a.kind !== b.kind) return a.kind === 'directory' ? -1 : 1;
          return a.name.localeCompare(b.name, undefined, { numeric: true });
        }),
      };
    },
  });
}
