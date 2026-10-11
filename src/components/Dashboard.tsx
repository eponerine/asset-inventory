import { useMemo } from 'react';
import { CONNECTOR_META, INVENTORY_TYPES } from '../data/connectors';
import type { Asset, Connector, SourceType } from '../data/types';
import { compileQuery } from '../lib/query';
import { fmtNum, pct, toneFor, type Tone } from '../lib/format';

interface Props {
  assets: Asset[];
  connectors: Connector[];
  onOpen: (query: string) => void;
}

interface Insight { title: string; desc: string; q: string; tone: Tone }

const INSIGHTS: Insight[] = [
  { title: 'Missing Defender agent', desc: 'Assets with an OS that are not onboarded to MDE', q: 'av:"Not onboarded,No coverage"', tone: 'bad' },
  { title: 'Critical patches missing', desc: 'At least one critical update outstanding', q: 'critical>0', tone: 'bad' },
  { title: 'Internet-exposed & high risk', desc: 'Public IP + Defender risk High', q: 'pubip:* risk:high', tone: 'bad' },
  { title: 'Public DNS → risky asset', desc: 'Cloudflare hostname points at a Medium/High-risk asset', q: 'dns:* risk:high,medium', tone: 'bad' },
  { title: 'AV unhealthy', desc: 'Out of date, disabled, passive or not reporting', q: 'av:"Out of date,Disabled,Not reporting,Passive"', tone: 'warn' },
  { title: 'End-of-life operating systems', desc: 'Win 10, Server 2012 R2, CentOS 7, Ubuntu 20.04…', q: 'eol:yes', tone: 'warn' },
  { title: 'No patch management', desc: 'Not reported by Update Manager or Endpoint Central', q: 'patch:"No coverage"', tone: 'warn' },
  { title: 'Stale patch assessment', desc: 'Last assessment older than 14 days', q: 'patch:stale', tone: 'warn' },
  { title: 'Intune non-compliant', desc: 'Device compliance policy failing', q: 'compliance:non-compliant', tone: 'warn' },
  { title: 'Stale devices', desc: 'Not seen for 30+ days', q: 'lastseen>30', tone: 'muted' },
  { title: 'Untagged cloud resources', desc: 'No tags at all – ownership unknown', q: 'tagcount:0 -source:intune', tone: 'muted' },
  { title: 'Stopped / deallocated compute', desc: 'Candidates for cost review', q: 'state:"stopped,deallocated"', tone: 'muted' },
];

const inc = (m: Map<string, number>, k: string) => m.set(k, (m.get(k) ?? 0) + 1);
const top = (m: Map<string, number>, n = 99) => [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, n);

function computeStats(assets: Asset[]) {
  const s = {
    total: assets.length, running: 0, withOs: 0, defOn: 0, avOk: 0, patchEligible: 0, patchOk: 0, critAssets: 0, critTotal: 0, eol: 0,
    bySource: new Map<string, number>(), byFamily: new Map<string, number>(), byAv: new Map<string, number>(),
    byPatch: new Map<string, number>(), byState: new Map<string, number>(), byKind: new Map<string, number>(),
    byOs: new Map<string, number>(), byRegion: new Map<string, number>(), byRisk: new Map<string, number>(),
    perSource: new Map<SourceType, { total: number; withOs: number; defOn: number; patchEligible: number; patched: number; crit: number; eol: number }>(),
  };
  for (const a of assets) {
    let ps = s.perSource.get(a.source);
    if (!ps) s.perSource.set(a.source, (ps = { total: 0, withOs: 0, defOn: 0, patchEligible: 0, patched: 0, crit: 0, eol: 0 }));
    ps.total++;
    if (a.powerState === 'running' || a.powerState === 'online') s.running++;
    if (a.osFamily) {
      s.withOs++; ps.withOs++;
      inc(s.byOs, a.os);
    }
    if (a.defender?.onboarded) {
      s.defOn++; ps.defOn++;
      if (a.av === 'Up to date') s.avOk++;
      inc(s.byRisk, a.risk);
    }
    if (a.patchStatus !== 'N/A') {
      s.patchEligible++; ps.patchEligible++;
      if (a.patch) ps.patched++;
      if (a.patchStatus === 'Up to date') s.patchOk++;
    }
    if (a.missingCritical) { s.critAssets++; s.critTotal += a.missingCritical; ps.crit++; }
    if (a.eol) { s.eol++; ps.eol++; }
    inc(s.bySource, a.source);
    inc(s.byFamily, a.osFamily || 'None (PaaS)');
    inc(s.byAv, a.av);
    inc(s.byPatch, a.patchStatus);
    inc(s.byState, a.powerState);
    inc(s.byKind, a.kind);
    inc(s.byRegion, a.region);
  }
  return s;
}

const quote = (v: string) => (/[\s,"]/.test(v) ? `"${v}"` : v);

export function Dashboard({ assets, connectors, onOpen }: Props) {
  const s = useMemo(() => computeStats(assets), [assets]);
  const insights = useMemo(
    () =>
      INSIGHTS.map((i) => {
        const cq = compileQuery(i.q);
        let count = 0;
        for (const a of assets) if (cq.test(a)) count++;
        return { ...i, count };
      }),
    [assets],
  );
  const activeConnectors = connectors.filter((c) => c.enabled);
  const unhealthy = activeConnectors.filter((c) => c.status !== 'healthy').length;

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>Overview</h1>
          <p className="muted">
            {fmtNum(s.total)} assets correlated from {activeConnectors.length} connectors
            {unhealthy > 0 && <> · <span className="text-warn">{unhealthy} connector{unhealthy > 1 ? 's' : ''} need attention</span></>}
          </p>
        </div>
      </div>

      <div className="source-strip">
        {INVENTORY_TYPES.map((t) => {
          const n = s.bySource.get(t) ?? 0;
          if (!n) return null;
          const m = CONNECTOR_META[t];
          return (
            <button key={t} className="source-seg" style={{ flex: n, background: m.color }} onClick={() => onOpen(`source=${t}`)} title={`${m.label}: ${fmtNum(n)}`}>
              <span>{m.labelShort} · {fmtNum(n)}</span>
            </button>
          );
        })}
      </div>

      <div className="kpis">
        <Kpi label="Total assets" value={fmtNum(s.total)} sub={`${fmtNum(s.running)} running / online`} onClick={() => onOpen('')} />
        <Kpi label="Defender coverage" value={pct(s.defOn, s.withOs)} sub={`${fmtNum(s.withOs - s.defOn)} without agent`} tone={s.defOn / (s.withOs || 1) > 0.95 ? 'good' : 'warn'} onClick={() => onOpen('av:"Not onboarded,No coverage"')} />
        <Kpi label="AV healthy" value={pct(s.avOk, s.defOn)} sub="of onboarded assets" tone={s.avOk / (s.defOn || 1) > 0.95 ? 'good' : 'warn'} onClick={() => onOpen('-av="Up to date" seenby:defender')} />
        <Kpi label="Patch compliant" value={pct(s.patchOk, s.patchEligible)} sub="fully up to date" tone={s.patchOk / (s.patchEligible || 1) > 0.8 ? 'good' : 'warn'} onClick={() => onOpen('-patch="Up to date" -patch=N/A')} />
        <Kpi label="Critical patches missing" value={fmtNum(s.critAssets)} sub={`${fmtNum(s.critTotal)} critical updates outstanding`} tone="bad" onClick={() => onOpen('critical>0')} />
        <Kpi label="End-of-life OS" value={fmtNum(s.eol)} sub={pct(s.eol, s.withOs) + ' of OS-bearing assets'} tone="warn" onClick={() => onOpen('eol:yes')} />
      </div>

      <div className="grid-2">
        <div className="card">
          <h3>Insights <span className="muted small">saved queries</span></h3>
          <div className="insights">
            {insights.map((i) => (
              <button key={i.title} className="insight" onClick={() => onOpen(i.q)}>
                <span className={`insight-dot ${i.tone}`} />
                <span className="insight-text">
                  <span className="insight-title">{i.title}</span>
                  <span className="muted small">{i.desc}</span>
                </span>
                <span className="insight-count">{fmtNum(i.count)}</span>
                <code className="insight-q">{i.q}</code>
              </button>
            ))}
          </div>
        </div>

        <div className="card">
          <h3>Coverage by source</h3>
          <table className="cov">
            <thead>
              <tr><th>Source</th><th>Assets</th><th>Defender</th><th>Patch tool</th><th>Crit. missing</th><th>EOL OS</th></tr>
            </thead>
            <tbody>
              {INVENTORY_TYPES.map((t) => {
                const p = s.perSource.get(t as SourceType);
                if (!p) return null;
                return (
                  <tr key={t} onClick={() => onOpen(`source=${t}`)}>
                    <td><span className="src"><span className="src-badge" style={{ background: CONNECTOR_META[t].color }}>{CONNECTOR_META[t].short}</span><span className="src-label">{CONNECTOR_META[t].labelShort}</span></span></td>
                    <td>{fmtNum(p.total)}</td>
                    <td><Meter v={p.defOn} of={p.withOs} /></td>
                    <td><Meter v={p.patched} of={p.patchEligible} /></td>
                    <td className={p.crit ? 'text-bad' : ''}>{fmtNum(p.crit)}</td>
                    <td className={p.eol ? 'text-warn' : ''}>{fmtNum(p.eol)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <p className="muted small">Defender % = onboarded / assets with an OS. Patch tool % = reported by Update Manager or Endpoint Central / patchable assets.</p>
        </div>
      </div>

      <div className="grid-3">
        <BarCard title="Defender AV status" data={top(s.byAv)} toneBars q={(v) => `av=${quote(v)}`} onOpen={onOpen} total={s.total} />
        <BarCard title="Patch status" data={top(s.byPatch)} toneBars q={(v) => `patch=${quote(v)}`} onOpen={onOpen} total={s.total} />
        <BarCard title="Defender risk level" data={top(s.byRisk)} toneBars q={(v) => `risk=${quote(v)}`} onOpen={onOpen} total={s.defOn} />
        <BarCard title="OS family" data={top(s.byFamily)} q={(v) => (v.startsWith('None') ? '-family:*' : `family=${quote(v)}`)} onOpen={onOpen} total={s.total} />
        <BarCard title="Power / device state" data={top(s.byState)} toneBars q={(v) => `state=${quote(v)}`} onOpen={onOpen} total={s.total} />
        <BarCard title="Asset type" data={top(s.byKind, 10)} q={(v) => `kind=${quote(v)}`} onOpen={onOpen} total={s.total} />
        <BarCard title="Top operating systems" data={top(s.byOs, 12)} q={(v) => `os=${quote(v)}`} onOpen={onOpen} total={s.withOs} />
        <BarCard title="Top regions / locations" data={top(s.byRegion, 12)} q={(v) => `region=${quote(v)}`} onOpen={onOpen} total={s.total} />
        <BarCard title="Assets by source" data={top(s.bySource)} colorFor={(v) => CONNECTOR_META[v as SourceType].color} labelFor={(v) => CONNECTOR_META[v as SourceType].label} q={(v) => `source=${v}`} onOpen={onOpen} total={s.total} />
      </div>
    </div>
  );
}

function Kpi({ label, value, sub, tone, onClick }: { label: string; value: string; sub?: string; tone?: Tone; onClick?: () => void }) {
  return (
    <button className={`kpi${tone ? ` tone-${tone}` : ''}`} onClick={onClick}>
      <span className="kpi-label">{label}</span>
      <span className="kpi-value">{value}</span>
      {sub && <span className="kpi-sub">{sub}</span>}
    </button>
  );
}

function Meter({ v, of }: { v: number; of: number }) {
  const r = of ? v / of : 0;
  const tone = r > 0.9 ? 'good' : r > 0.7 ? 'warn' : 'bad';
  return (
    <span className="meter">
      <span className="meter-track"><span className={`meter-fill ${tone}`} style={{ width: `${r * 100}%` }} /></span>
      <span className="meter-text">{of ? pct(v, of) : '—'}</span>
    </span>
  );
}

interface BarCardProps {
  title: string;
  data: [string, number][];
  total: number;
  q: (v: string) => string;
  onOpen: (q: string) => void;
  toneBars?: boolean;
  colorFor?: (v: string) => string;
  labelFor?: (v: string) => string;
}

function BarCard({ title, data, total, q, onOpen, toneBars, colorFor, labelFor }: BarCardProps) {
  const max = data[0]?.[1] || 1;
  return (
    <div className="card">
      <h3>{title}</h3>
      <div className="bars">
        {data.map(([label, n]) => (
          <button key={label} className="bar-row" onClick={() => onOpen(q(label))} title={`${label}: ${fmtNum(n)} (${pct(n, total)})`}>
            <span className="bar-label">{labelFor ? labelFor(label) : label}</span>
            <span className="bar-track">
              <span
                className={`bar-fill${toneBars ? ` ${toneFor(label)}` : ''}`}
                style={{ width: `${(n / max) * 100}%`, background: colorFor?.(label) }}
              />
            </span>
            <span className="bar-num">{fmtNum(n)}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
