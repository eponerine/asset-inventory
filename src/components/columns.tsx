import type { Asset } from '../data/types';
import { relTime } from '../lib/format';
import { Pill, SourceBadge, StateDot, TagList } from './ui';
import type { VtColumn } from './VirtualTable';

export interface Column extends VtColumn<Asset> {
  /** Plain-text value for CSV export; defaults to String(sort(row)). */
  text?: (a: Asset) => string;
}

const dash = (s: string | undefined) => s || '—';

const ipKey = (ip: string) => {
  if (!ip) return -1;
  const p = ip.split('.');
  return ((+p[0] * 256 + +p[1]) * 256 + +p[2]) * 256 + +p[3];
};

const RISK_ORDER: Record<string, number> = { 'N/A': 0, Unknown: 1, None: 2, Low: 3, Medium: 4, High: 5 };

export const ALL_COLUMNS: Column[] = [
  { id: 'name', label: 'Name', width: 270, sort: (a) => a.name.toLowerCase(), text: (a) => a.name, render: (a) => <span className="strong">{a.name}</span> },
  { id: 'source', label: 'Source', width: 96, sort: (a) => a.source, render: (a) => <SourceBadge type={a.source} withLabel /> },
  { id: 'kind', label: 'Type', width: 140, sort: (a) => a.kind },
  { id: 'account', label: 'Subscription / account', width: 210, sort: (a) => a.account },
  { id: 'connector', label: 'Connector', width: 220, sort: (a) => a.connectorName },
  { id: 'rg', label: 'Resource group / VPC', width: 210, sort: (a) => a.resourceGroup, render: (a) => dash(a.resourceGroup) },
  { id: 'region', label: 'Region', width: 120, sort: (a) => a.region },
  { id: 'os', label: 'Operating system', width: 250, sort: (a) => a.os, text: (a) => a.os, render: (a) => (a.os ? <>{a.os}{a.eol && <Pill v="EOL" small />}</> : '—') },
  { id: 'osVersion', label: 'OS version', width: 90, sort: (a) => a.osVersion, render: (a) => dash(a.osVersion) },
  { id: 'osBuild', label: 'OS build', width: 210, mono: true, sort: (a) => a.osBuild, render: (a) => dash(a.osBuild) },
  { id: 'size', label: 'Size / model', width: 180, sort: (a) => a.model ?? a.size, render: (a) => a.model ?? dash(a.size) },
  { id: 'cpu', label: 'vCPU', width: 64, align: 'right', sort: (a) => a.cpu, render: (a) => a.cpu || '—' },
  { id: 'mem', label: 'Memory', width: 84, align: 'right', sort: (a) => a.memoryGb, render: (a) => (a.memoryGb ? `${a.memoryGb} GB` : '—') },
  { id: 'privateIp', label: 'Private IP', width: 130, mono: true, sort: (a) => ipKey(a.privateIp), text: (a) => a.privateIp, render: (a) => dash(a.privateIp) },
  { id: 'publicIp', label: 'Public IP', width: 130, mono: true, sort: (a) => ipKey(a.publicIp), text: (a) => a.publicIp, render: (a) => dash(a.publicIp) },
  { id: 'state', label: 'State', width: 115, sort: (a) => a.powerState, render: (a) => <StateDot state={a.powerState} /> },
  { id: 'av', label: 'Defender AV', width: 130, sort: (a) => a.av, render: (a) => <Pill v={a.av} /> },
  { id: 'risk', label: 'Risk', width: 90, sort: (a) => RISK_ORDER[a.risk] ?? 0, text: (a) => a.risk, render: (a) => <Pill v={a.risk} /> },
  { id: 'patch', label: 'Patch status', width: 145, sort: (a) => a.patchStatus, render: (a) => <Pill v={a.patchStatus} /> },
  {
    id: 'critical', label: 'Crit. missing', width: 100, align: 'right', sort: (a) => a.missingCritical ?? -1,
    text: (a) => (a.missingCritical == null ? '' : String(a.missingCritical)),
    render: (a) => (a.missingCritical == null ? '—' : <span className={a.missingCritical > 0 ? 'text-bad strong' : 'muted'}>{a.missingCritical}</span>),
  },
  { id: 'compliance', label: 'Intune compliance', width: 135, sort: (a) => a.compliance ?? '', render: (a) => (a.compliance ? <Pill v={a.compliance} /> : '—') },
  { id: 'user', label: 'Owner / user', width: 220, sort: (a) => a.primaryUser ?? a.tags.owner ?? '', render: (a) => a.primaryUser ?? a.tags.owner ?? '—' },
  { id: 'env', label: 'Env', width: 80, sort: (a) => a.tags.env ?? '', render: (a) => dash(a.tags.env) },
  {
    id: 'tags', label: 'Tags', width: 300, sort: (a) => Object.keys(a.tags).length,
    text: (a) => Object.entries(a.tags).map(([k, v]) => `${k}=${v}`).join('; '),
    render: (a) => <TagList tags={a.tags} max={3} />,
  },
  {
    id: 'dns', label: 'DNS names', width: 240, sort: (a) => a.dns[0]?.name ?? '', text: (a) => a.dns.map((d) => d.name).join('; '),
    render: (a) => (a.dns.length ? <>{a.dns[0].name}{a.dns.length > 1 && <span className="muted"> +{a.dns.length - 1}</span>}</> : '—'),
  },
  {
    id: 'seenBy', label: 'Seen by', width: 160, sort: (a) => a.seenBy.length, text: (a) => a.seenBy.join(' '),
    render: (a) => <span className="badges">{a.seenBy.map((t) => <SourceBadge key={t} type={t} />)}</span>,
  },
  { id: 'lastSeen', label: 'Last seen', width: 100, sort: (a) => a.lastSeen, text: (a) => new Date(a.lastSeen).toISOString(), render: (a) => relTime(a.lastSeen) },
  { id: 'created', label: 'Created', width: 100, sort: (a) => a.createdAt, text: (a) => new Date(a.createdAt).toISOString(), render: (a) => relTime(a.createdAt) },
];

export const COLUMN_MAP: Record<string, Column> = Object.fromEntries(ALL_COLUMNS.map((c) => [c.id, c]));

export const DEFAULT_COLUMNS = ['name', 'source', 'kind', 'account', 'rg', 'region', 'os', 'osBuild', 'cpu', 'mem', 'privateIp', 'publicIp', 'dns', 'state', 'av', 'patch', 'critical', 'seenBy', 'lastSeen'];
