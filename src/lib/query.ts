import type { Asset } from '../data/types';

const DAY = 86_400_000;
type Val = string | number | null | undefined;
type Pred = (a: Asset) => boolean;

interface FieldSpec {
  get: (a: Asset, now: number) => Val;
  numeric?: boolean;
  help: string;
}

export const FIELDS: Record<string, FieldSpec> = {
  name: { get: (a) => a.name, help: 'Asset / device name' },
  source: { get: (a) => a.source, help: 'azure, aws, gcp, linode, intune' },
  connector: { get: (a) => a.connectorName, help: 'Connector display name' },
  kind: { get: (a) => a.kind, help: 'Asset type – "Virtual Machine", Laptop, "EKS Node"…' },
  account: { get: (a) => a.account, help: 'Subscription / AWS account / GCP project / tenant' },
  rg: { get: (a) => a.resourceGroup, help: 'Resource group / VPC / network' },
  region: { get: (a) => a.region, help: 'Cloud region or Intune scope region' },
  family: { get: (a) => a.osFamily, help: 'Windows, Linux, macOS, iOS, Android' },
  os: { get: (a) => a.os, help: 'OS name, e.g. "Server 2019"' },
  osver: { get: (a) => a.osVersion, help: 'OS version, e.g. 22H2, 24.04' },
  build: { get: (a) => a.osBuild, help: 'OS build / kernel version' },
  size: { get: (a) => a.model ?? a.size, help: 'VM size / instance type / device model' },
  cpu: { get: (a) => a.cpu, numeric: true, help: 'vCPU / cores' },
  mem: { get: (a) => a.memoryGb, numeric: true, help: 'Memory (GB)' },
  disk: { get: (a) => a.diskGb, numeric: true, help: 'Disk (GB)' },
  ip: { get: (a) => `${a.privateIp} ${a.publicIp}`, help: 'Any IP address' },
  privip: { get: (a) => a.privateIp, help: 'Private IP' },
  pubip: { get: (a) => a.publicIp, help: 'Public IP (pubip:* = has one)' },
  state: { get: (a) => a.powerState, help: 'running, stopped, deallocated, online, offline…' },
  av: { get: (a) => a.av, help: 'Defender AV status' },
  risk: { get: (a) => a.risk, help: 'Defender risk: none, low, medium, high' },
  alerts: { get: (a) => (a.defender?.onboarded ? a.defender.activeAlerts : null), numeric: true, help: 'Defender active alerts' },
  exposure: { get: (a) => (a.defender?.onboarded ? a.defender.exposureScore : null), numeric: true, help: 'Defender exposure score 0–100' },
  patch: { get: (a) => a.patchStatus, help: 'Patch status' },
  critical: { get: (a) => a.missingCritical, numeric: true, help: 'Missing critical updates' },
  security: { get: (a) => a.patch?.missingSecurity ?? null, numeric: true, help: 'Missing security updates' },
  reboot: { get: (a) => (a.patch ? (a.patch.rebootPending ? 'yes' : 'no') : ''), help: 'Reboot pending: yes / no' },
  user: { get: (a) => a.primaryUser, help: 'Intune primary user' },
  compliance: { get: (a) => a.compliance, help: 'Intune compliance state' },
  eol: { get: (a) => (a.eol ? 'yes' : 'no'), help: 'End-of-life OS: yes / no' },
  tagcount: { get: (a) => Object.keys(a.tags).length, numeric: true, help: 'Number of tags' },
  lastseen: { get: (a, now) => Math.floor((now - a.lastSeen) / DAY), numeric: true, help: 'Days since last seen' },
  age: { get: (a, now) => Math.floor((now - a.createdAt) / DAY), numeric: true, help: 'Days since created' },
  seenby: { get: (a) => a.seenBy.join(' '), help: 'Reporting sources: defender, aum, endpointcentral, cloudflare…' },
  dns: { get: (a) => a.dns.map((d) => d.name).join(' '), help: 'Cloudflare DNS names pointing at the asset (dns:* = any)' },
  dnscount: { get: (a) => a.dns.length, numeric: true, help: 'Number of DNS records pointing at the asset' },
};

const ALIASES: Record<string, string> = {
  type: 'kind', subscription: 'account', sub: 'account', project: 'account', vpc: 'rg', power: 'state',
  status: 'state', defender: 'av', patching: 'patch', model: 'size', memory: 'mem', owner: 'user',
};

export const QUERY_EXAMPLES: { q: string; d: string }[] = [
  { q: 'source:azure family:windows critical>0', d: 'Azure Windows machines missing critical patches' },
  { q: 'pubip:* risk:high', d: 'Internet-exposed, high-risk assets' },
  { q: 'tag:env=prod -av="Up to date"', d: 'Production assets without healthy AV' },
  { q: 'os:"Server 2016,Server 2012" state:running', d: 'Old Windows Server still running' },
  { q: 'source:intune lastseen>30', d: 'Intune devices not checked in for 30+ days' },
  { q: 'cpu>=16 state:deallocated,stopped', d: 'Large stopped VMs (cost review)' },
  { q: 'tagcount:0 -source:intune', d: 'Untagged cloud resources' },
  { q: 'family:windows -seenby:aum,endpointcentral', d: 'Windows assets with no patch tool' },
  { q: 'dns:contoso.com risk:high,medium', d: 'Public contoso.com hostnames on risky assets' },
];

// Groups: 1 negation, 2 field, 3 operator, 4 value | 5 negation, 6 quoted text | 7 bare word
const TOKEN_RE = /(-?)([a-z]+)(>=|<=|!=|>|<|:|=)("[^"]*"?|\S*)|(-?)"([^"]*)"?|(\S+)/gi;

const unquote = (s: string) => s.replace(/^"/, '').replace(/"$/, '');

export interface CompiledQuery {
  test: Pred;
  empty: boolean;
  errors: string[];
}

export function compileQuery(q: string): CompiledQuery {
  const preds: Pred[] = [];
  const errors: string[] = [];
  const now = Date.now();

  for (const m of q.matchAll(TOKEN_RE)) {
    if (m[2] !== undefined) {
      const neg = m[1] === '-';
      const fieldRaw = m[2].toLowerCase();
      const field = ALIASES[fieldRaw] ?? fieldRaw;
      const raw = unquote(m[4]);
      if (raw === '') continue;
      const p = field === 'tag' ? tagPred(raw) : fieldPred(field, m[3], raw, now, errors, `${m[2]}${m[3]}${m[4]}`);
      if (p) preds.push(neg ? (a) => !p(a) : p);
    } else {
      let text = m[6] ?? m[7] ?? '';
      let neg = m[5] === '-';
      if (m[7] !== undefined && text.length > 1 && text.startsWith('-')) {
        neg = true;
        text = text.slice(1);
      }
      const needle = text.toLowerCase();
      if (!needle) continue;
      preds.push(neg ? (a) => !a.search.includes(needle) : (a) => a.search.includes(needle));
    }
  }

  return {
    empty: preds.length === 0,
    errors,
    test: (a) => {
      for (const p of preds) if (!p(a)) return false;
      return true;
    },
  };
}

function fieldPred(field: string, op: string, raw: string, now: number, errors: string[], token: string): Pred | null {
  const spec = FIELDS[field];
  if (!spec) {
    errors.push(`Unknown field "${field}" – treated as free text`);
    const needle = token.toLowerCase();
    return (a) => a.search.includes(needle);
  }
  const get = spec.get;

  if (spec.numeric) {
    const n = Number(raw);
    if (Number.isNaN(n)) {
      errors.push(`"${field}" expects a number`);
      return null;
    }
    const cmp: (x: number) => boolean =
      op === '>' ? (x) => x > n
      : op === '<' ? (x) => x < n
      : op === '>=' ? (x) => x >= n
      : op === '<=' ? (x) => x <= n
      : op === '!=' ? (x) => x !== n
      : (x) => x === n;
    return (a) => {
      const v = get(a, now);
      return typeof v === 'number' && cmp(v);
    };
  }

  if (op === '>' || op === '<' || op === '>=' || op === '<=') {
    errors.push(`"${field}" is text – use : (contains) or = (exact)`);
    return null;
  }
  const vals = raw.toLowerCase().split(',').map((s) => s.trim()).filter(Boolean);
  const str = (a: Asset) => String(get(a, now) ?? '').toLowerCase();
  if (op === '=') return (a) => vals.includes(str(a));
  if (op === '!=') return (a) => !vals.includes(str(a));
  return (a) => {
    const s = str(a);
    for (const v of vals) if (v === '*' ? s !== '' : s.includes(v)) return true;
    return false;
  };
}

function tagPred(raw: string): Pred {
  const conds = raw.toLowerCase().split(',').map((s) => s.trim()).filter(Boolean).map((s) => {
    const i = s.indexOf('=');
    return i < 0 ? { k: s, v: null as string | null } : { k: s.slice(0, i), v: s.slice(i + 1) };
  });
  return (a) => {
    const tags = a.tags;
    for (const { k, v } of conds) {
      if (k === 'none' || k === '*') {
        const has = Object.keys(tags).length > 0;
        if ((k === '*') === has) return true;
        continue;
      }
      for (const key in tags) {
        if (key.toLowerCase() === k && (v === null || tags[key].toLowerCase().includes(v))) return true;
      }
    }
    return false;
  };
}
