import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import type { Asset } from '../data/types';
import { compileQuery, FIELDS, QUERY_EXAMPLES } from '../lib/query';
import { fmtNum } from '../lib/format';
import { ALL_COLUMNS, COLUMN_MAP, DEFAULT_COLUMNS, type Column } from './columns';
import { VirtualTable } from './VirtualTable';
import { AssetDrawer } from './AssetDrawer';
import { applyFacets, FACETS, FacetPanel, type FacetSelection } from './Facets';

const COLS_KEY = 'asset-inventory.columns.v1';

function loadCols(): string[] {
  try {
    const v: unknown = JSON.parse(localStorage.getItem(COLS_KEY) ?? 'null');
    if (Array.isArray(v)) {
      const ok = v.filter((id): id is string => typeof id === 'string' && id in COLUMN_MAP);
      if (ok.length) return ok;
    }
  } catch {
    /* use defaults */
  }
  return DEFAULT_COLUMNS;
}

function exportCsv(rows: Asset[], cols: Column[]) {
  const esc = (v: string) => {
    // Neutralise spreadsheet formula injection.
    const s = /^[=+\-@\t\r]/.test(v) ? `'${v}` : v;
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = [cols.map((c) => esc(c.label)).join(',')];
  for (const r of rows) lines.push(cols.map((c) => esc(c.text ? c.text(r) : String(c.sort(r)))).join(','));
  const url = URL.createObjectURL(new Blob([lines.join('\r\n')], { type: 'text/csv' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = `assets-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

interface Props {
  assets: Asset[];
  query: string;
  onQueryChange: (q: string) => void;
}

export function AssetsView({ assets, query, onQueryChange }: Props) {
  const timings = useRef({ query: 0, facets: 0, sort: 0 });
  const deferredQuery = useDeferredValue(query);
  const compiled = useMemo(() => compileQuery(deferredQuery), [deferredQuery]);

  const base = useMemo(() => {
    const t = performance.now();
    const r = compiled.empty ? assets : assets.filter(compiled.test);
    timings.current.query = performance.now() - t;
    return r;
  }, [assets, compiled]);

  const [sel, setSel] = useState<FacetSelection>({});
  const { filtered, counts } = useMemo(() => {
    const t = performance.now();
    const r = applyFacets(base, sel);
    timings.current.facets = performance.now() - t;
    return r;
  }, [base, sel]);

  const [sort, setSort] = useState<{ id: string; desc: boolean } | null>(null);
  const sorted = useMemo(() => {
    const t = performance.now();
    let r = filtered;
    const col = sort && COLUMN_MAP[sort.id];
    if (col) {
      const keyed = filtered.map((a) => [col.sort(a), a] as const);
      keyed.sort((x, y) => (x[0] < y[0] ? -1 : x[0] > y[0] ? 1 : 0));
      if (sort.desc) keyed.reverse();
      r = keyed.map((k) => k[1]);
    }
    timings.current.sort = performance.now() - t;
    return r;
  }, [filtered, sort]);

  const [visible, setVisible] = useState<string[]>(loadCols);
  const updateVisible = (cols: string[]) => {
    setVisible(cols);
    localStorage.setItem(COLS_KEY, JSON.stringify(cols));
  };
  const columns = useMemo(() => visible.map((id) => COLUMN_MAP[id]).filter(Boolean), [visible]);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selected = useMemo(() => (selectedId ? assets.find((a) => a.id === selectedId) ?? null : null), [assets, selectedId]);
  const closeDrawer = useCallback(() => setSelectedId(null), []);

  const [showHelp, setShowHelp] = useState(false);

  const toggleFacet = (key: string, value: string) =>
    setSel((s) => {
      const cur = s[key] ?? [];
      const next = cur.includes(value) ? cur.filter((v) => v !== value) : [...cur, value];
      return { ...s, [key]: next };
    });

  const onSort = (id: string) =>
    setSort((s) => (!s || s.id !== id ? { id, desc: false } : !s.desc ? { id, desc: true } : null));

  const activeChips = FACETS.flatMap((f) => (sel[f.key] ?? []).map((v) => ({ f, v })));
  const ms = timings.current.query + timings.current.facets + timings.current.sort;
  const pending = query !== deferredQuery;

  return (
    <div className="assets">
      <aside className="facets">
        <div className="facets-head">
          <span>Filters</span>
          {activeChips.length > 0 && <button className="link small" onClick={() => setSel({})}>Clear all</button>}
        </div>
        <FacetPanel counts={counts} selection={sel} onToggle={toggleFacet} />
      </aside>

      <section className="assets-main">
        <div className="toolbar">
          <div className="search">
            <span className="search-icon">⌕</span>
            <input
              value={query}
              onChange={(e) => onQueryChange(e.target.value)}
              placeholder='Search or query…  e.g.  source:azure os:"Server 2019" critical>0 tag:env=prod -state:deallocated'
              spellCheck={false}
              autoFocus
            />
            {query && <button className="icon-btn" onClick={() => onQueryChange('')} aria-label="Clear search">×</button>}
            <button className={`btn ghost${showHelp ? ' active' : ''}`} onClick={() => setShowHelp((v) => !v)}>Query help</button>
          </div>
          <div className="toolbar-right">
            <span className={`count${pending ? ' pending' : ''}`}>
              <b>{fmtNum(sorted.length)}</b> <span className="muted">of {fmtNum(assets.length)}</span>
            </span>
            <span className="muted small" title="query + facets + sort">{ms.toFixed(1)} ms</span>
            <ColumnPicker visible={visible} onChange={updateVisible} />
            <button className="btn" onClick={() => exportCsv(sorted, columns)}>Export CSV</button>
          </div>
        </div>

        {compiled.errors.length > 0 && <div className="query-errors">{compiled.errors.join(' · ')}</div>}
        {showHelp && <QueryHelp onPick={(q) => { onQueryChange(q); setShowHelp(false); }} />}

        {activeChips.length > 0 && (
          <div className="chips">
            {activeChips.map(({ f, v }) => (
              <button key={`${f.key}:${v}`} className="chip" onClick={() => toggleFacet(f.key, v)}>
                <span className="muted">{f.label}:</span> {f.format ? f.format(v) : v} <span className="x">×</span>
              </button>
            ))}
          </div>
        )}

        <VirtualTable
          rows={sorted}
          columns={columns}
          rowKey={(a) => a.id}
          selectedKey={selectedId}
          onRowClick={(a) => setSelectedId(a.id)}
          sort={sort}
          onSort={onSort}
        />
      </section>

      {selected && <AssetDrawer asset={selected} onClose={closeDrawer} />}
    </div>
  );
}

function ColumnPicker({ visible, onChange }: { visible: string[]; onChange: (cols: string[]) => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const h = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, [open]);

  const toggle = (id: string) => {
    if (visible.includes(id)) {
      if (visible.length > 1) onChange(visible.filter((v) => v !== id));
    } else {
      onChange(ALL_COLUMNS.map((c) => c.id).filter((c) => c === id || visible.includes(c)));
    }
  };

  return (
    <div className="popover-wrap" ref={ref}>
      <button className="btn" onClick={() => setOpen((o) => !o)}>Columns ({visible.length})</button>
      {open && (
        <div className="popover">
          {ALL_COLUMNS.map((c) => (
            <label key={c.id} className="check-row">
              <input type="checkbox" checked={visible.includes(c.id)} onChange={() => toggle(c.id)} />
              {c.label}
            </label>
          ))}
          <button className="link small" onClick={() => onChange(DEFAULT_COLUMNS)}>Reset to default</button>
        </div>
      )}
    </div>
  );
}

function QueryHelp({ onPick }: { onPick: (q: string) => void }) {
  return (
    <div className="help">
      <div className="help-col">
        <h4>Syntax</h4>
        <ul>
          <li><code>text</code> free text across name, IDs, IPs, OS, tags…</li>
          <li><code>field:value</code> contains · <code>field=value</code> exact · <code>field!=value</code></li>
          <li><code>cpu&gt;8</code> <code>mem&lt;=4</code> numeric comparisons</li>
          <li><code>-field:value</code> or <code>-text</code> to negate</li>
          <li><code>field:a,b</code> OR values · <code>"quoted values"</code></li>
          <li><code>tag:env=prod</code> · <code>tag:owner</code> · <code>tag:none</code></li>
          <li><code>pubip:*</code> has any value</li>
        </ul>
        <h4>Examples</h4>
        <ul className="examples">
          {QUERY_EXAMPLES.map((e) => (
            <li key={e.q}><button className="link" onClick={() => onPick(e.q)}><code>{e.q}</code></button> <span className="muted">{e.d}</span></li>
          ))}
        </ul>
      </div>
      <div className="help-col fields">
        <h4>Fields</h4>
        <div className="field-grid">
          {Object.entries(FIELDS).map(([k, f]) => (
            <div key={k}><code>{k}</code><span className="muted">{f.help}</span></div>
          ))}
          <div><code>tag</code><span className="muted">Tag key[=value]</span></div>
        </div>
      </div>
    </div>
  );
}
