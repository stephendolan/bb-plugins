import { describe, it, expect } from 'vitest';
import { createFakePluginHost, makeThreadResponse } from '@get-bb/plugin-sdk/testing';
import plugin, { resolveDirectory } from './server';

describe('personal directory boundaries', () => {
  it('resolves nested folders and rejects sibling and absolute escapes', () => {
    expect(resolveDirectory('/work/personal', 'reports/2026')).toBe('/work/personal/reports/2026');
    expect(() => resolveDirectory('/work/personal', '../other')).toThrow('inside');
    expect(() => resolveDirectory('/work/personal', '/etc')).toThrow('inside');
  });
});

it('browses the thread host, preserves existing tabs, and respects a later close', async () => {
  const updates: unknown[] = [];
  const listings: unknown[] = [];
  const env = { path: '/work/personal', hostId: 'host-remote' };
  const host = createFakePluginHost({ pluginId: 'personal-files', sdk: {
    threads: {
      get: async () => ({ ...makeThreadResponse({ id: 'thread-a', projectId: 'personal', environmentId: 'env-a' }), environment: env }) as never,
      tabs: {
        get: async () => ({ revision: 3, tabs: [{ id: 'info', kind: 'thread-info' }] }),
        update: async args => { updates.push(args); return { revision: 4, tabs: args.tabs }; },
      },
    },
    environments: { get: async () => env as never },
    projects: { list: async () => [{ id: 'personal', kind: 'personal' }] as never },
    files: { listPaths: async args => { listings.push(args); return { truncated: false, paths: [
      { name: 'prep.md', path: '/work/personal/prep.md', kind: 'file', score: 0, positions: [] },
      { name: 'nested.md', path: '/work/personal/reports/nested.md', kind: 'file', score: 0, positions: [] },
      { name: 'reports', path: '/work/personal/reports', kind: 'directory', score: 0, positions: [] },
    ] }; } },
  } });
  try {
    plugin(host.bb);
    await host.harness.behavior.callRpc('ensureTab', { threadId: 'thread-a' });
    await host.harness.behavior.callRpc('ensureTab', { threadId: 'thread-a' });
    expect(updates).toEqual([{ threadId: 'thread-a', expectedRevision: 3, tabs: [
      { id: 'info', kind: 'thread-info' },
      { id: 'plugin:personal-files:files', kind: 'plugin-panel', pluginId: 'personal-files', actionId: 'files', title: 'Files', paramsJson: null },
    ] }]);
    const result = await host.harness.behavior.callRpc('list', { threadId: 'thread-a', directory: '' });
    expect(listings).toEqual([{ hostId: 'host-remote', path: '/work/personal', includeFiles: true, includeDirectories: true, limit: 1000 }]);
    expect(result).toMatchObject({ hostId: 'host-remote', root: '/work/personal', entries: [{ name: 'reports' }, { name: 'prep.md' }] });
  } finally { await host.harness.lifecycle.dispose(); }
});
