import { useMemo, useState } from 'react';
import { CONNECTOR_META } from '../data/connectors';
import type { Asset, ConnectorType } from '../data/types';
import { fmtNum } from '../lib/format';

export interface FacetDef {
  key: string;
  label: string;
  get: (a: Asset) => string;
  format?: (v: string) => string;
}

export const FACETS: FacetDef[] = [
  { key: 'source', label: 'Source', get: (a) => a.source, format: (v) => CONNECTOR_META[v as ConnectorType]?.label ?? v },
  { key: 'kind', label: 'Asset type', get: (a) => a.kind },
  { key: 'family', label: 'OS family', get: (a) => a.osFamily || 'None (PaaS)' },
  { key: 'state', label: 'Power / state', get: (a) => a.powerState },
  { key: 'av', label: 'Defender AV', get: (a) => a.av },
  { key: 'risk', label: 'Defender risk', get: (a) => a.risk },
  { key: 'patch', label: 'Patch status', get: (a) => a.patchStatus },
  { key: 'eol', label: 'OS lifecycle', get: (a) => (a.osFamily ? (a.eol ? 'End of life' : 'Supported') : 'N/A') },
  { key: 'env', label: 'Environment tag', get: (a) => a.tags.env ?? '(none)' },
  { key: 'region', label: 'Region / location', get: (a) => a.region },
  { key: 'os', label: 'Operating system', get: (a) => a.os || 'None' },
  { key: 'account', label: 'Subscription / account', get: (a) => a.account },
];

export type FacetSelection = Record<string, string[]>;

const inc = (m: Map<string, number>, k: string) => m.set(k, (m.get(k) ?? 0) + 1);

/**
 * Applies facet selections (OR within a facet, AND across facets) and computes
 * per-facet counts as if that facet's own selection were not applied.
 */
export function applyFacets(rows: Asset[], sel: FacetSelection) {
  const n = FACETS.length;
  const counts = FACETS.map(() => new Map<string, number>());
  const active: { idx: number; set: Set<string> }[] = [];
  FACETS.forEach((f, idx) => {
    const v = sel[f.key];
    if (v?.length) active.push({ idx, set: new Set(v) });
  });

  if (!active.length) {
    for (const a of rows) for (let i = 0; i < n; i++) inc(counts[i], FACETS[i].get(a));
    return { filtered: rows, counts };
  }

  const filtered: Asset[] = [];
  const vals = new Array<string>(n);
  for (const a of rows) {
    for (let i = 0; i < n; i++) vals[i] = FACETS[i].get(a);
    let fails = 0;
    let failIdx = -1;
    for (const f of active) {
      if (!f.set.has(vals[f.idx])) {
        fails++;
        failIdx = f.idx;
        if (fails > 1) break;
      }
    }
    if (fails === 0) {
      filtered.push(a);
      for (let i = 0; i < n; i++) inc(counts[i], vals[i]);
    } else if (fails === 1) {
      inc(counts[failIdx], vals[failIdx]);
    }
  }
  return { filtered, counts };
}

interface PanelProps {
  counts: Map<string, number>[];
  selection: FacetSelection;
  onToggle: (key: string, value: string) => void;
}

export function FacetPanel({ counts, selection, onToggle }: PanelProps) {
  return (
    <>
      {FACETS.map((f, i) => (
        <FacetGroup key={f.key} def={f} counts={counts[i]} selected={selection[f.key] ?? []} onToggle={(v) => onToggle(f.key, v)} />
      ))}
    </>
  );
}

const INITIAL = 6;

function FacetGroup({ def, counts, selected, onToggle }: { def: FacetDef; counts: Map<string, number>; selected: string[]; onToggle: (v: string) => void }) {
  const [expanded, setExpanded] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const entries = useMemo(() => {
    const e = [...counts.entries()];
    for (const s of selected) if (!counts.has(s)) e.push([s, 0]);
    e.sort((a, b) => b[1] - a[1]);
    return e;
  }, [counts, selected]);
  const max = entries[0]?.[1] || 1;
  const shown = expanded ? entries : entries.slice(0, INITIAL);

  return (
    <div className="facet">
      <button className="facet-title" onClick={() => setCollapsed((c) => !c)}>
        <span>{collapsed ? '▸' : '▾'} {def.label}</span>
        {selected.length > 0 && <span className="facet-active">{selected.length}</span>}
      </button>
      {!collapsed && (
        <>
          {shown.map(([v, c]) => {
            const on = selected.includes(v);
            return (
              <label key={v} className={`facet-row${on ? ' on' : ''}`}>
                <span className="facet-bar" style={{ width: `${(c / max) * 100}%` }} />
                <input type="checkbox" checked={on} onChange={() => onToggle(v)} />
                <span className="facet-label" title={v}>{def.format ? def.format(v) : v}</span>
                <span className="facet-count">{fmtNum(c)}</span>
              </label>
            );
          })}
          {entries.length > INITIAL && (
            <button className="link small facet-more" onClick={() => setExpanded((e) => !e)}>
              {expanded ? 'Show less' : `Show all ${entries.length}`}
            </button>
          )}
        </>
      )}
    </div>
  );
}
