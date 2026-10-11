import { NOW, Rng } from './generate';
import type { DnsMatch, DnsRecord, RawAsset } from './types';

const DAY = 86_400_000;

function hashSeed(s: string, seed: number) {
  let h = (seed ^ 0x811c9dc5) >>> 0;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** The hostname the cloud provider itself assigns to the asset, used for CNAME correlation. */
export function providerFqdn(a: RawAsset): string {
  const ip = a.publicIp;
  switch (a.source) {
    case 'azure':
      if (a.kind === 'Storage Account') return `${a.name}.blob.core.windows.net`;
      return ip && (a.kind === 'Virtual Machine' || a.kind === 'VMSS Instance') ? `${a.name.replace(/_/g, '-')}.${a.region}.cloudapp.azure.com` : '';
    case 'aws':
      if (a.kind === 'S3 Bucket') return `${a.name}.s3.amazonaws.com`;
      return ip ? `ec2-${ip.replace(/\./g, '-')}.${a.region === 'us-east-1' ? 'compute-1' : `${a.region}.compute`}.amazonaws.com` : '';
    case 'gcp':
      return ip ? `${ip.split('.').reverse().join('.')}.bc.googleusercontent.com` : '';
    case 'linode':
      return ip ? `${ip.replace(/\./g, '-')}.ip.linodeusercontent.com` : '';
    default:
      return '';
  }
}

const ZONES = ['contoso.com', 'contoso.io', 'contoso-apps.net'];
const ALIASES = ['www', 'portal', 'app', 'status', 'dashboard', 'admin', 'sso', 'files'];
const DANGLING_WORDS = ['legacy', 'old', 'promo', 'beta', 'campaign', 'staging-old', 'test', 'demo', 'event', 'summit', 'hr-portal', 'careers'];

export interface DnsResult {
  byAsset: Map<string, DnsMatch[]>;
  unmatched: DnsRecord[];
  total: number;
}

/** Simulates a Cloudflare zone export, then correlates every record back to inventory. */
export function buildDns(raw: RawAsset[], seed: number): DnsResult {
  const records: DnsRecord[] = [];
  const used = new Set<string>();
  const add = (r: Rng, zone: string, label: string, type: DnsRecord['type'], content: string, proxied: boolean) => {
    let name = `${label}.${zone}`;
    if (used.has(name)) name = `${label}-${r.hex(4)}.${zone}`;
    if (used.has(name)) return null;
    used.add(name);
    const rec: DnsRecord = { id: r.hex(32), zone, name, type, content, proxied, ttl: proxied ? 1 : r.pick([300, 3600, 14400]), modifiedOn: NOW - r.int(1, 900) * DAY };
    records.push(rec);
    return rec;
  };

  for (const a of raw) {
    if (a.source === 'intune') continue;
    const fqdn = providerFqdn(a);
    if (!a.publicIp && !fqdn) continue;
    const r = new Rng(hashSeed(a.id, seed));
    const env = a.tags.env;
    if (!r.chance(env === 'prod' ? 0.55 : 0.25)) continue;
    const zone = a.connectorName.toLowerCase().startsWith('fabrikam') ? 'fabrikam.com' : r.pick(ZONES);
    const app = a.tags.app;
    const label = app && env ? (env === 'prod' ? app : `${app}-${env}`) : a.name.toLowerCase().replace(/[^a-z0-9-]/g, '-').slice(0, 40);
    const primary = fqdn && (!a.publicIp || r.chance(0.3))
      ? add(r, zone, label, 'CNAME', fqdn, false)
      : add(r, zone, label, 'A', a.publicIp, r.chance(0.6));
    if (primary && r.chance(0.25)) add(r, zone, `${r.pick(ALIASES)}-${label}`, 'CNAME', primary.name, false);
  }

  // Records pointing at things no inventory source knows about (dangling / takeover candidates).
  const dr = new Rng(seed);
  const danglingCount = Math.max(12, Math.round(records.length * 0.03));
  for (let i = 0; i < danglingCount; i++) {
    const zone = dr.pick(ZONES);
    const word = dr.pick(DANGLING_WORDS);
    if (dr.chance(0.5)) {
      add(dr, zone, word, 'A', `${dr.pick([20, 40, 52, 54, 34, 35])}.${dr.int(1, 254)}.${dr.int(0, 255)}.${dr.int(1, 254)}`, dr.chance(0.4));
    } else {
      const target = dr.pick([
        `${word}-${dr.hex(6)}.azurewebsites.net`,
        `${word}-${dr.hex(6)}.s3-website-us-east-1.amazonaws.com`,
        `${word}.cloudapp.net`,
        `${word}-${dr.hex(4)}.herokuapp.com`,
        `${word}.trafficmanager.net`,
      ]);
      add(dr, zone, word, 'CNAME', target, false);
    }
  }

  return correlate(raw, records);
}

function correlate(raw: RawAsset[], records: DnsRecord[]): DnsResult {
  const ipMap = new Map<string, RawAsset>();
  const fqdnMap = new Map<string, RawAsset>();
  for (const a of raw) {
    if (a.source === 'intune') continue;
    if (a.publicIp) ipMap.set(a.publicIp, a);
    const f = providerFqdn(a);
    if (f) fqdnMap.set(f.toLowerCase(), a);
  }
  const byName = new Map(records.map((r) => [r.name.toLowerCase(), r]));

  const resolve = (rec: DnsRecord, depth: number): { asset: RawAsset; by: DnsMatch['matchedBy'] } | null => {
    if (rec.type === 'A') {
      const a = ipMap.get(rec.content);
      return a ? { asset: a, by: 'Public IP' } : null;
    }
    const target = rec.content.toLowerCase();
    const a = fqdnMap.get(target);
    if (a) return { asset: a, by: 'Provider FQDN' };
    const next = byName.get(target);
    if (next && depth < 3) {
      const r = resolve(next, depth + 1);
      return r && { asset: r.asset, by: 'CNAME chain' };
    }
    return null;
  };

  const byAsset = new Map<string, DnsMatch[]>();
  const unmatched: DnsRecord[] = [];
  for (const rec of records) {
    const m = resolve(rec, 0);
    if (!m) {
      unmatched.push(rec);
      continue;
    }
    let list = byAsset.get(m.asset.id);
    if (!list) byAsset.set(m.asset.id, (list = []));
    list.push({ ...rec, matchedBy: m.by });
  }
  return { byAsset, unmatched, total: records.length };
}
