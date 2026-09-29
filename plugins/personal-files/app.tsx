import { useEffect, useRef, useState } from 'react';
import { definePluginApp, useBbContext, useBbNavigate, useRpc, type PluginThreadPanelProps } from '@get-bb/plugin-sdk/app';
import type { rpcContract } from './server';
import './app.css';

type Listing = { root: string; hostId: string; directory: string; truncated: boolean; entries: { name: string; path: string; kind: 'file' | 'directory' }[] };

function InstallTab() {
  const { threadId } = useBbContext();
  const navigate = useBbNavigate();
  const navigation = useRef(navigate); navigation.current = navigate;
  const rpc = useRpc<typeof rpcContract>();
  const client = useRef(rpc); client.current = rpc;
  useEffect(() => {
    if (!threadId) return;
    let active = true;
    void client.current.call('ensureTab', { threadId }).then(result => {
      if (active && result.open) navigation.current.openThreadPanel({ actionId: 'files' });
    }).catch(error => console.error('Personal Files tab:', error));
    return () => { active = false; };
  }, [threadId]);
  return null;
}

export function Files({ threadId }: PluginThreadPanelProps) {
  const rpc = useRpc<typeof rpcContract>();
  const navigate = useBbNavigate();
  const client = useRef(rpc); client.current = rpc;
  const [directory, setDirectory] = useState('');
  const [listing, setListing] = useState<Listing | null>(null);
  const [query, setQuery] = useState('');
  const [revision, refresh] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  useEffect(() => { setDirectory(''); setQuery(''); }, [threadId]);
  useEffect(() => {
    let active = true;
    setLoading(true); setError(null);
    void client.current.call('list', { threadId, directory }).then(value => {
      if (active) setListing(value);
    }).catch(reason => { if (active) setError(reason instanceof Error ? reason.message : 'Could not load files.'); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [threadId, directory, revision]);
  const entries = listing?.entries.filter(entry => entry.name.toLowerCase().includes(query.toLowerCase())) ?? [];
  function enter(next: string) { setDirectory(next); setQuery(''); }
  return <section className="personal-files" aria-label="Thread files">
    <header>
      <div className="pf-toolbar"><strong>Files</strong><button aria-label="Refresh files" title="Refresh files" onClick={() => refresh(n => n + 1)}>↻</button></div>
      <div className="pf-root" title={listing?.root}>{listing?.root ?? 'Thread directory'}</div>
      <nav aria-label="Folder navigation"><button onClick={() => enter('')}>Home</button>{directory && <><span>/</span><button title="Parent folder" onClick={() => enter(directory.split('/').slice(0, -1).join('/'))}>..</button><span className="pf-current">{directory}</span></>}</nav>
      <input type="search" aria-label="Filter files" placeholder="Filter files…" value={query} onChange={event => setQuery(event.target.value)} />
    </header>
    <div className="pf-list" aria-busy={loading}>
      {loading ? <p>Loading files…</p> : error ? <p role="alert">{error}</p> : <>
        {entries.length === 0 && <p>{query ? 'No matching files.' : 'This folder is empty.'}</p>}
        {entries.map(entry => <button className="pf-entry" key={entry.path} title={entry.name} onClick={() => {
          if (entry.kind === 'directory') {
            const relative = entry.path.startsWith(`${listing!.root}/`) ? entry.path.slice(listing!.root.length + 1) : [directory, entry.name].filter(Boolean).join('/');
            enter(relative);
          } else if (!navigate.experimental_openFilePreview({ target: { kind: 'host', hostId: listing!.hostId, path: entry.path.startsWith('/') ? entry.path : `${listing!.root}/${directory ? directory + '/' : ''}${entry.name}` }, location: null })) {
            setError('BB could not open this file preview.');
          }
        }}><svg viewBox="0 0 24 24" aria-hidden="true"><path d={entry.kind === 'directory' ? 'M3 7V5h6l2 2h10v13H3Z' : 'M6 3h8l4 4v14H6ZM14 3v5h4M9 12h6M9 16h6'} /></svg><span>{entry.name}</span>{entry.kind === 'directory' && <span aria-hidden="true">›</span>}</button>)}
        {listing?.truncated && <p>Listing is incomplete: the directory scan reached its limit.</p>}
      </>}
    </div>
    <footer>{!loading && !error ? `${entries.length} ${entries.length === 1 ? 'item' : 'items'}` : ' '}</footer>
  </section>;
}

export default definePluginApp(app => {
  app.slots.threadPanelAction({ id: 'files', title: 'Files', icon: 'FolderOpen', component: Files, layout: 'flush' });
  app.slots.experimental_appOverlay({ id: 'install-personal-files-tab', component: InstallTab });
});
