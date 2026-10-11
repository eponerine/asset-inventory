import { useEffect, useMemo, useState } from 'react';
import { clearSavedConnectors, DEFAULT_CONNECTORS, enabledResourceTypes, isInventory, loadConnectors, markDefaultRemoved, saveConnectors } from './data/connectors';
import { enrich } from './data/enrich';
import { buildDns } from './data/dns';
import { generateForConnector } from './data/generate';
import type { Connector, RawAsset } from './data/types';
import { fmtNum } from './lib/format';
import { AssetsView } from './components/AssetsView';
import { ConnectorsView } from './components/ConnectorsView';
import { Dashboard } from './components/Dashboard';

type View = 'dashboard' | 'assets' | 'connectors';

export default function App() {
  const [connectors, setConnectors] = useState<Connector[]>(loadConnectors);
  const [view, setView] = useState<View>('dashboard');
  const [query, setQuery] = useState('');
  const [syncing, setSyncing] = useState<Set<string>>(new Set());
  const [ready, setReady] = useState(false);

  useEffect(() => saveConnectors(connectors), [connectors]);
  // Let the splash paint before the (synchronous) data generation kicks in.
  useEffect(() => {
    const t = setTimeout(() => setReady(true), 30);
    return () => clearTimeout(t);
  }, []);

  const inventory = connectors.filter((c) => c.enabled && isInventory(c.type));
  const inventoryKey = inventory.map((c) => `${c.id}|${c.seed}|${c.simulatedCount}|${c.name}|${[...enabledResourceTypes(c)].join(',')}`).join(';');
  const raw = useMemo(() => {
    if (!ready) return [];
    const out: RawAsset[] = [];
    for (const c of inventory) {
      const allowed = enabledResourceTypes(c);
      for (const a of generateForConnector(c)) if (allowed.has(c.type === 'intune' ? a.osFamily : a.kind)) out.push(a);
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inventoryKey, ready]);

  const has = (t: string) => connectors.some((c) => c.enabled && c.type === t);
  const flags = { defender: has('defender'), aum: has('aum'), endpointcentral: has('endpointcentral') };
  const flagsKey = `${flags.defender}${flags.aum}${flags.endpointcentral}`;
  const cloudflare = connectors.find((c) => c.enabled && c.type === 'cloudflare');
  const dns = useMemo(() => (cloudflare ? buildDns(raw, cloudflare.seed) : null), [raw, cloudflare?.seed]);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const assets = useMemo(() => enrich(raw, flags, dns?.byAsset), [raw, flagsKey, dns]);

  // Status derived from live data rather than stored on the connector.
  const dynamicStatus = useMemo(() => {
    const m = new Map<string, Partial<Connector>>();
    if (cloudflare && dns?.unmatched.length) {
      m.set(cloudflare.id, {
        status: 'warning',
        statusMessage: `${dns.unmatched.length} of ${fmtNum(dns.total)} DNS records don't resolve to any inventoried asset`,
        statusDetails: dns.unmatched.map((r) => `${r.name}  ${r.type}  →  ${r.content}${r.proxied ? '  (proxied)' : ''}`),
        statusRemediation: 'Possible dangling DNS / subdomain-takeover risk. Delete stale records, or enable the inventory source (or resource type) that owns the target.',
      });
    }
    return m;
  }, [cloudflare, dns]);

  const counts = useMemo(() => {
    const m = new Map<string, number>();
    let d = 0, u = 0, e = 0, cf = 0;
    for (const a of assets) {
      m.set(a.connectorId, (m.get(a.connectorId) ?? 0) + 1);
      if (a.defender?.onboarded) d++;
      if (a.aum) u++;
      if (a.endpointCentral) e++;
      if (a.dns.length) cf++;
    }
    m.set('defender', d).set('aum', u).set('endpointcentral', e).set('cloudflare', cf);
    return m;
  }, [assets]);

  const openAssets = (q: string) => {
    setQuery(q);
    setView('assets');
  };

  const updateConnector = (c: Connector) => setConnectors((cs) => cs.map((x) => (x.id === c.id ? c : x)));

  const syncConnector = (id: string) => {
    setSyncing((s) => new Set(s).add(id));
    setTimeout(() => {
      setSyncing((s) => {
        const n = new Set(s);
        n.delete(id);
        return n;
      });
      setConnectors((cs) => cs.map((x) => (x.id === id ? { ...x, lastSync: Date.now() } : x)));
    }, 1200 + Math.random() * 1200);
  };

  const enabledCount = connectors.filter((c) => c.enabled).length;
  const warnCount = connectors.filter((c) => c.enabled && (dynamicStatus.get(c.id)?.status ?? c.status) !== 'healthy').length;
  const expected = inventory.reduce((s, c) => s + c.simulatedCount, 0);

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <span className="brand-mark" />
          Asset Inventory
          <span className="poc-badge">POC · simulated data</span>
        </div>
        <nav className="nav">
          {(['dashboard', 'assets', 'connectors'] as const).map((v) => (
            <button key={v} className={view === v ? 'active' : ''} onClick={() => setView(v)}>
              {v === 'dashboard' ? 'Dashboard' : v === 'assets' ? 'Assets' : 'Connectors'}
            </button>
          ))}
        </nav>
        <div className="topbar-right">
          <span><b>{fmtNum(assets.length)}</b> assets</span>
          <button className="link" onClick={() => setView('connectors')}>
            {enabledCount} connectors{warnCount > 0 && <span className="text-warn"> · {warnCount} warning</span>}
          </button>
        </div>
      </header>

      <main className="main">
        {!ready ? (
          <div className="splash">
            <div className="spinner" />
            <div>Generating {fmtNum(expected)} simulated assets…</div>
          </div>
        ) : view === 'dashboard' ? (
          <Dashboard assets={assets} connectors={connectors} onOpen={openAssets} />
        ) : view === 'assets' ? (
          <AssetsView assets={assets} query={query} onQueryChange={setQuery} />
        ) : (
          <ConnectorsView
            connectors={connectors}
            counts={counts}
            dynamicStatus={dynamicStatus}
            syncing={syncing}
            onUpdate={updateConnector}
            onAdd={(c) => setConnectors((cs) => [...cs, c])}
            onDelete={(id) => {
              markDefaultRemoved(id);
              setConnectors((cs) => cs.filter((x) => x.id !== id));
            }}
            onSync={syncConnector}
            onReset={() => {
              clearSavedConnectors();
              setConnectors(DEFAULT_CONNECTORS);
            }}
          />
        )}
      </main>
    </div>
  );
}
