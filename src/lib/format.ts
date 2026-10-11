export const fmtNum = (n: number) => n.toLocaleString();

export const pct = (a: number, b: number) => (b ? `${(Math.round((a / b) * 1000) / 10).toFixed(1)}%` : '—');

export function relTime(ts: number) {
  if (!ts) return '—';
  const m = (Date.now() - ts) / 60_000;
  if (m < 1) return 'just now';
  if (m < 60) return `${Math.floor(m)}m ago`;
  const h = m / 60;
  if (h < 24) return `${Math.floor(h)}h ago`;
  const d = h / 24;
  if (d < 60) return `${Math.floor(d)}d ago`;
  return `${Math.floor(d / 30)}mo ago`;
}

export const fmtDate = (ts: number) => (ts ? new Date(ts).toLocaleString() : '—');

export type Tone = 'good' | 'warn' | 'bad' | 'muted';

const TONES: Record<string, Tone> = {
  'Up to date': 'good', running: 'good', online: 'good', available: 'good', None: 'good', Low: 'good',
  Compliant: 'good', Active: 'good', healthy: 'good',
  'Out of date': 'warn', 'Security missing': 'warn', Medium: 'warn', stopped: 'warn', deallocated: 'warn',
  offline: 'warn', 'Passive mode': 'warn', 'In grace period': 'warn', 'Stale assessment': 'warn',
  warning: 'warn', Inactive: 'warn', Misconfigured: 'warn',
  Disabled: 'bad', 'Critical missing': 'bad', High: 'bad', 'Not onboarded': 'bad', 'No coverage': 'bad',
  'Not reporting': 'bad', terminated: 'bad', 'Non-compliant': 'bad', error: 'bad',
};

export const toneFor = (v: string): Tone => TONES[v] ?? 'muted';
