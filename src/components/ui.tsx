import { useEffect, type ReactNode } from 'react';
import { CONNECTOR_META } from '../data/connectors';
import type { ConnectorType } from '../data/types';
import { toneFor } from '../lib/format';

export function SourceBadge({ type, withLabel }: { type: ConnectorType; withLabel?: boolean }) {
  const m = CONNECTOR_META[type];
  return (
    <span className="src" title={m.label}>
      <span className="src-badge" style={{ background: m.color }}>{m.short}</span>
      {withLabel && <span className="src-label">{m.labelShort}</span>}
    </span>
  );
}

export function Pill({ v, small }: { v: string; small?: boolean }) {
  return <span className={`pill ${toneFor(v)}${small ? ' tiny' : ''}`}>{v}</span>;
}

export function StateDot({ state }: { state: string }) {
  return <span className={`state ${toneFor(state)}`}><i />{state}</span>;
}

export function TagList({ tags, max }: { tags: Record<string, string>; max?: number }) {
  const entries = Object.entries(tags);
  if (!entries.length) return <span className="muted">—</span>;
  const shown = max ? entries.slice(0, max) : entries;
  return (
    <span className="tags">
      {shown.map(([k, v]) => (
        <span key={k} className="tag"><b>{k}</b>{v && <>={v}</>}</span>
      ))}
      {max && entries.length > max && <span className="tag more">+{entries.length - max}</span>}
    </span>
  );
}

export function Switch({ on, onChange, label }: { on: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <button type="button" role="switch" aria-checked={on} aria-label={label} className={`switch${on ? ' on' : ''}`} onClick={() => onChange(!on)}>
      <i />
    </button>
  );
}

export function Modal({ title, onClose, children, wide }: { title: string; onClose: () => void; children: ReactNode; wide?: boolean }) {
  useEffect(() => {
    const h = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [onClose]);
  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={`modal${wide ? ' wide' : ''}`} role="dialog" aria-modal="true" aria-label={title}>
        <header className="modal-head">
          <h2>{title}</h2>
          <button className="icon-btn" onClick={onClose} aria-label="Close">×</button>
        </header>
        <div className="modal-body">{children}</div>
      </div>
    </div>
  );
}
