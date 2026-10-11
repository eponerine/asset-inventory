import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';

export interface VtColumn<T> {
  id: string;
  label: string;
  width: number;
  align?: 'right';
  mono?: boolean;
  sort: (row: T) => string | number;
  render?: (row: T) => ReactNode;
}

interface Props<T> {
  rows: T[];
  columns: VtColumn<T>[];
  rowKey: (row: T) => string;
  rowHeight?: number;
  selectedKey?: string | null;
  onRowClick?: (row: T) => void;
  sort?: { id: string; desc: boolean } | null;
  onSort?: (id: string) => void;
  emptyText?: string;
}

const OVERSCAN = 12;

/** Fixed-row-height windowed table: only visible rows are mounted, so 100k rows scroll smoothly. */
export function VirtualTable<T>({ rows, columns, rowKey, rowHeight = 32, selectedKey, onRowClick, sort, onSort, emptyText = 'No matching assets' }: Props<T>) {
  const ref = useRef<HTMLDivElement>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewport, setViewport] = useState(800);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setViewport(el.clientHeight));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    if (ref.current) ref.current.scrollTop = 0;
    setScrollTop(0);
  }, [rows]);

  const width = columns.reduce((s, c) => s + c.width, 0);
  const start = Math.max(0, Math.floor(scrollTop / rowHeight) - OVERSCAN);
  const end = Math.min(rows.length, Math.ceil((scrollTop + viewport) / rowHeight) + OVERSCAN);

  const items: ReactNode[] = [];
  for (let i = start; i < end; i++) {
    const row = rows[i];
    const key = rowKey(row);
    items.push(
      <div
        key={key}
        className={`vt-row${key === selectedKey ? ' selected' : ''}${i % 2 ? ' odd' : ''}`}
        style={{ transform: `translateY(${i * rowHeight}px)`, height: rowHeight, width }}
        onClick={() => onRowClick?.(row)}
      >
        {columns.map((c) => (
          <div key={c.id} className={`vt-td${c.align === 'right' ? ' right' : ''}${c.mono ? ' mono' : ''}`} style={{ width: c.width }}>
            {c.render ? c.render(row) : String(c.sort(row))}
          </div>
        ))}
      </div>,
    );
  }

  return (
    <div className="vt" ref={ref} onScroll={(e) => setScrollTop(e.currentTarget.scrollTop)}>
      <div className="vt-header" style={{ width }}>
        {columns.map((c) => (
          <div key={c.id} className={`vt-th${c.align === 'right' ? ' right' : ''}${sort?.id === c.id ? ' sorted' : ''}`} style={{ width: c.width }} onClick={() => onSort?.(c.id)}>
            <span>{c.label}</span>
            {sort?.id === c.id && <span className="sort">{sort.desc ? '▼' : '▲'}</span>}
          </div>
        ))}
      </div>
      <div className="vt-body" style={{ height: rows.length * rowHeight, width }}>{items}</div>
      {rows.length === 0 && <div className="vt-empty">{emptyText}</div>}
    </div>
  );
}
