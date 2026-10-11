import type { Connector, DefenderInfo, OsFamily, PatchInfo, PatchStatus, PowerState, RawAsset, SourceType } from './types';

export const NOW = Date.now();
const MIN = 60_000;
const HOUR = 3_600_000;
const DAY = 86_400_000;
const HEX = '0123456789abcdef';
const B36 = '0123456789abcdefghijklmnopqrstuvwxyz';
const ALNUM = '0123456789ABCDEFGHJKLMNPQRSTUVWXYZ';

type W<T> = readonly (readonly [T, number])[];
type CloudSource = Exclude<SourceType, 'intune'>;

// ---------------------------------------------------------------- RNG

function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export class Rng {
  private f: () => number;
  constructor(seed: number) {
    this.f = mulberry32(seed);
  }
  next() { return this.f(); }
  int(min: number, max: number) { return min + Math.floor(this.f() * (max - min + 1)); }
  chance(p: number) { return this.f() < p; }
  pick<T>(arr: readonly T[]): T { return arr[Math.floor(this.f() * arr.length)]; }
  weighted<T>(items: W<T>): T {
    let total = 0;
    for (const it of items) total += it[1];
    let x = this.f() * total;
    for (const it of items) {
      x -= it[1];
      if (x < 0) return it[0];
    }
    return items[items.length - 1][0];
  }
  weightedBy<T>(items: readonly T[], w: (t: T) => number): T {
    let total = 0;
    for (const it of items) total += w(it);
    let x = this.f() * total;
    for (const it of items) {
      x -= w(it);
      if (x < 0) return it;
    }
    return items[items.length - 1];
  }
  chars(set: string, n: number) {
    let s = '';
    for (let i = 0; i < n; i++) s += set[Math.floor(this.f() * set.length)];
    return s;
  }
  hex(n: number) { return this.chars(HEX, n); }
  digits(n: number) { return this.chars('0123456789', n); }
  guid() { return `${this.hex(8)}-${this.hex(4)}-4${this.hex(3)}-${this.pick(['8', '9', 'a', 'b'])}${this.hex(3)}-${this.hex(12)}`; }
  mac() { return Array.from({ length: 6 }, () => this.hex(2)).join(':').toUpperCase(); }
  sample<T>(arr: readonly T[], n: number): T[] {
    const copy = [...arr];
    const out: T[] = [];
    while (out.length < n && copy.length) out.push(copy.splice(Math.floor(this.f() * copy.length), 1)[0]);
    return out;
  }
}

/** Months behind on patching. Skewed so most assets are current with a long tail of neglected ones. */
const latentBehind = (r: Rng) => Math.floor(Math.pow(r.next(), 4) * 14);

// ---------------------------------------------------------------- Operating systems

type OsMake = (behind: number, r: Rng, flavor: string) => [version: string, build: string];
interface OsDef { os: string; family: OsFamily; make: OsMake; w: number; eol?: boolean; only?: SourceType[] }
const wOs = (d: OsDef) => d.w;

const win = (ver: string, base: string, latest: number): OsMake => (b, r) => [ver, `${base}.${Math.max(100, latest - b * r.int(60, 110))}`];
const lnx = (ver: string, prefix: string, latest: number, suffix: string): OsMake => (b, r, flavor) => [
  ver,
  `${prefix}${Math.max(1, latest - b * r.int(2, 5))}${suffix.replace('{f}', flavor)}`,
];
const apple = (versions: string[], buildPrefix: string): OsMake => (b, r) => {
  const i = Math.max(0, versions.length - 1 - b);
  return [versions[i], `${buildPrefix}${String.fromCharCode(65 + i)}${r.int(10, 99)}`];
};
const android = (ver: string): OsMake => (b) => {
  const d = new Date(NOW - b * 30 * DAY);
  return [ver, `SPL ${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`];
};

const WIN_SERVER: OsDef[] = [
  { os: 'Windows Server 2012 R2 Datacenter', family: 'Windows', make: win('6.3', '6.3.9600', 22192), w: 3, eol: true },
  { os: 'Windows Server 2016 Datacenter', family: 'Windows', make: win('1607', '10.0.14393', 7428), w: 8 },
  { os: 'Windows Server 2019 Datacenter', family: 'Windows', make: win('1809', '10.0.17763', 6532), w: 22 },
  { os: 'Windows Server 2022 Datacenter', family: 'Windows', make: win('21H2', '10.0.20348', 2849), w: 45 },
  { os: 'Windows Server 2025 Datacenter', family: 'Windows', make: win('24H2', '10.0.26100', 4061), w: 12 },
];

const UBUNTU_2204: OsDef = { os: 'Ubuntu 22.04 LTS', family: 'Linux', make: lnx('22.04', '5.15.0-', 140, '-{f}'), w: 28 };
const DEBIAN_12: OsDef = { os: 'Debian 12 (bookworm)', family: 'Linux', make: lnx('12', '6.1.0-', 28, '-cloud-amd64'), w: 8 };
const AL2023: OsDef = { os: 'Amazon Linux 2023', family: 'Linux', make: lnx('2023', '6.1.', 115, '-123.201.amzn2023.x86_64'), w: 30, only: ['aws'] };

const LINUX: OsDef[] = [
  { os: 'Ubuntu 24.04 LTS', family: 'Linux', make: lnx('24.04', '6.8.0-', 85, '-{f}'), w: 20 },
  UBUNTU_2204,
  { os: 'Ubuntu 20.04 LTS', family: 'Linux', make: lnx('20.04', '5.4.0-', 216, '-{f}'), w: 8, eol: true },
  { os: 'Red Hat Enterprise Linux 9.4', family: 'Linux', make: lnx('9.4', '5.14.0-427.', 42, '.1.el9_4.x86_64'), w: 12 },
  { os: 'Red Hat Enterprise Linux 8.10', family: 'Linux', make: lnx('8.10', '4.18.0-553.', 30, '.1.el8_10.x86_64'), w: 8 },
  DEBIAN_12,
  AL2023,
  { os: 'Amazon Linux 2', family: 'Linux', make: lnx('2', '4.14.', 352, '-267.564.amzn2.x86_64'), w: 10, only: ['aws'] },
  { os: 'CentOS 7.9', family: 'Linux', make: lnx('7.9', '3.10.0-1160.', 119, '.1.el7.x86_64'), w: 3, eol: true },
  { os: 'SUSE Linux Enterprise Server 15 SP5', family: 'Linux', make: lnx('15.5', '5.14.21-150500.55.', 73, '-default'), w: 3 },
];

const LINUX_BY_SRC = Object.fromEntries(
  (['azure', 'aws', 'gcp', 'linode'] as const).map((s) => [s, LINUX.filter((d) => !d.only || d.only.includes(s))]),
) as Record<CloudSource, OsDef[]>;

const K8S_OS: Record<CloudSource, OsDef> = {
  azure: UBUNTU_2204,
  aws: AL2023,
  gcp: { os: 'Container-Optimized OS 117', family: 'Linux', make: lnx('117', '6.1.', 100, '+'), w: 1 },
  linode: DEBIAN_12,
};

const CLIENT_WIN: OsDef[] = [
  { os: 'Windows 11 Enterprise 24H2', family: 'Windows', make: win('24H2', '10.0.26100', 4061), w: 42 },
  { os: 'Windows 11 Enterprise 23H2', family: 'Windows', make: win('23H2', '10.0.22631', 5039), w: 26 },
  { os: 'Windows 10 Enterprise 22H2', family: 'Windows', make: win('22H2', '10.0.19045', 5917), w: 26, eol: true },
  { os: 'Windows 10 Enterprise 21H2', family: 'Windows', make: win('21H2', '10.0.19044', 5737), w: 6, eol: true },
];
const MAC: OsDef[] = [
  { os: 'macOS Sequoia', family: 'macOS', make: apple(['15.0', '15.0.1', '15.1', '15.1.1', '15.2', '15.3', '15.3.2', '15.4', '15.5', '15.6'], '24'), w: 60 },
  { os: 'macOS Sonoma', family: 'macOS', make: apple(['14.4', '14.4.1', '14.5', '14.6', '14.6.1', '14.7', '14.7.1', '14.7.4', '14.7.6'], '23'), w: 30 },
  { os: 'macOS Ventura', family: 'macOS', make: apple(['13.6', '13.6.4', '13.6.7', '13.7', '13.7.1', '13.7.4'], '22'), w: 10, eol: true },
];
const IOS: OsDef[] = [
  { os: 'iOS 18', family: 'iOS', make: apple(['18.0', '18.0.1', '18.1', '18.1.1', '18.2', '18.3', '18.3.2', '18.4', '18.5', '18.6'], '22'), w: 70 },
  { os: 'iOS 17', family: 'iOS', make: apple(['17.4', '17.4.1', '17.5', '17.5.1', '17.6', '17.6.1', '17.7'], '21'), w: 30 },
];
const ANDROID: OsDef[] = [
  { os: 'Android 15', family: 'Android', make: android('15'), w: 45 },
  { os: 'Android 14', family: 'Android', make: android('14'), w: 40 },
  { os: 'Android 13', family: 'Android', make: android('13'), w: 15 },
];

// ---------------------------------------------------------------- Cloud catalog

type Size = readonly [name: string, cpu: number, memGb: number, weight: number];
const wSize = (s: Size) => s[3];

interface CloudCfg {
  regions: string[];
  pubOctets: number[];
  kinds: W<string>;
  sizes: Size[];
  winShare: number;
  defender: number;
  ec: number;
  flavor: string;
}

const CLOUD: Record<CloudSource, CloudCfg> = {
  azure: {
    regions: ['eastus', 'eastus2', 'westus2', 'centralus', 'canadacentral', 'westeurope', 'northeurope', 'uksouth', 'australiaeast', 'southeastasia'],
    pubOctets: [13, 20, 40, 52, 104],
    kinds: [['Virtual Machine', 62], ['VMSS Instance', 12], ['AKS Node', 14], ['SQL Database', 7], ['Storage Account', 5]],
    sizes: [
      ['Standard_B1s', 1, 1, 4], ['Standard_B2ms', 2, 8, 10], ['Standard_D2s_v5', 2, 8, 20], ['Standard_D4s_v5', 4, 16, 20],
      ['Standard_D8s_v5', 8, 32, 12], ['Standard_E4s_v5', 4, 32, 8], ['Standard_F8s_v2', 8, 16, 6], ['Standard_D16s_v5', 16, 64, 5],
      ['Standard_E32s_v5', 32, 256, 2], ['Standard_M64s', 64, 1024, 0.3],
    ],
    winShare: 0.45, defender: 0.9, ec: 0.12, flavor: 'azure',
  },
  aws: {
    regions: ['us-east-1', 'us-east-2', 'us-west-2', 'ca-central-1', 'eu-west-1', 'eu-west-2', 'eu-central-1', 'ap-southeast-2', 'ap-northeast-1'],
    pubOctets: [3, 18, 34, 44, 52, 54],
    kinds: [['EC2 Instance', 68], ['EKS Node', 16], ['RDS Instance', 10], ['S3 Bucket', 6]],
    sizes: [
      ['t3.micro', 2, 1, 6], ['t3.medium', 2, 4, 14], ['m5.large', 2, 8, 20], ['m6i.xlarge', 4, 16, 18], ['c6i.2xlarge', 8, 16, 10],
      ['r6i.2xlarge', 8, 64, 6], ['m6i.4xlarge', 16, 64, 5], ['r6i.4xlarge', 16, 128, 3], ['c6i.8xlarge', 32, 64, 2],
    ],
    winShare: 0.3, defender: 0.8, ec: 0.55, flavor: 'aws',
  },
  gcp: {
    regions: ['us-central1', 'us-east1', 'us-west1', 'europe-west1', 'europe-west2', 'asia-southeast1', 'australia-southeast1'],
    pubOctets: [34, 35, 104, 146],
    kinds: [['Compute Instance', 68], ['GKE Node', 22], ['Cloud SQL', 10]],
    sizes: [
      ['e2-micro', 2, 1, 4], ['e2-medium', 2, 4, 14], ['e2-standard-2', 2, 8, 18], ['n2-standard-4', 4, 16, 20],
      ['n2-standard-8', 8, 32, 12], ['n2-highmem-8', 8, 64, 5], ['c2-standard-16', 16, 64, 4], ['n2-standard-32', 32, 128, 1],
    ],
    winShare: 0.15, defender: 0.72, ec: 0.5, flavor: 'gcp',
  },
  linode: {
    regions: ['us-east', 'us-central', 'us-west', 'us-ord', 'eu-west', 'eu-central', 'ap-south', 'ap-southeast'],
    pubOctets: [45, 50, 66, 139, 172, 173],
    kinds: [['Linode', 85], ['LKE Node', 15]],
    sizes: [
      ['g6-nanode-1', 1, 1, 15], ['g6-standard-1', 1, 2, 15], ['g6-standard-2', 2, 4, 25], ['g6-standard-4', 4, 8, 20],
      ['g6-dedicated-4', 4, 8, 10], ['g6-dedicated-8', 8, 16, 8], ['g6-dedicated-16', 16, 32, 3],
    ],
    winShare: 0, defender: 0.55, ec: 0.4, flavor: 'generic',
  },
};

const PAAS_SIZES: Record<string, Size[]> = {
  'SQL Database': [['GP_Gen5_2', 2, 10, 40], ['GP_Gen5_4', 4, 20, 30], ['GP_Gen5_8', 8, 41, 15], ['BC_Gen5_8', 8, 41, 10], ['HS_Gen5_16', 16, 83, 5]],
  'Storage Account': [['Standard_LRS', 0, 0, 50], ['Standard_GRS', 0, 0, 30], ['Standard_ZRS', 0, 0, 15], ['Premium_LRS', 0, 0, 5]],
  'RDS Instance': [['db.t3.medium', 2, 4, 30], ['db.m6g.large', 2, 8, 30], ['db.r6g.xlarge', 4, 32, 25], ['db.r6g.4xlarge', 16, 128, 15]],
  'S3 Bucket': [['STANDARD', 0, 0, 60], ['INTELLIGENT_TIERING', 0, 0, 30], ['GLACIER_IR', 0, 0, 10]],
  'Cloud SQL': [['db-custom-2-8192', 2, 8, 40], ['db-custom-4-16384', 4, 16, 35], ['db-custom-8-32768', 8, 32, 25]],
};
const PAAS = new Set(Object.keys(PAAS_SIZES));
const K8S = new Set(['AKS Node', 'EKS Node', 'GKE Node', 'LKE Node']);

const AZ_SHORT: Record<string, string> = {
  eastus: 'eus', eastus2: 'eus2', westus2: 'wus2', centralus: 'cus', canadacentral: 'cac',
  westeurope: 'weu', northeurope: 'neu', uksouth: 'uks', australiaeast: 'aue', southeastasia: 'sea',
};

const ENVS = [['prod', 40], ['staging', 14], ['dev', 26], ['test', 12], ['sandbox', 8]] as const;
const APPS = ['web', 'api', 'sql', 'etl', 'jump', 'dc', 'file', 'sap', 'k8s', 'cache', 'mq', 'proxy', 'vpn', 'build', 'ci', 'mon', 'log', 'auth', 'pay', 'crm', 'erp', 'bi', 'ml', 'iot', 'portal', 'search', 'media', 'batch'];
const DOMAINS = ['Platform', 'Identity', 'Data', 'Analytics', 'Web', 'Payments', 'ERP', 'CRM', 'HR', 'Security', 'Network', 'Shared', 'ML', 'IoT', 'Logistics', 'Retail', 'Finance', 'Marketing'];
const TEAMS = ['platform-eng', 'sre', 'data-eng', 'secops', 'app-dev', 'finance-it', 'web-team', 'ml-ops', 'networking', 'erp-team', 'identity', 'devex'];
const ROLES = ['web', 'app', 'db', 'worker', 'bastion', 'svc'];
const PATCH_WINDOWS = ['sat-0200', 'sun-0400', 'wed-2200', 'thu-0100'];
const FIRST = ['James', 'Mary', 'Robert', 'Patricia', 'John', 'Jennifer', 'Michael', 'Linda', 'David', 'Elizabeth', 'William', 'Barbara', 'Richard', 'Susan', 'Joseph', 'Jessica', 'Thomas', 'Sarah', 'Priya', 'Wei', 'Aisha', 'Carlos', 'Yuki', 'Olga', 'Mateo', 'Fatima', 'Lars', 'Chen', 'Amara', 'Noah', 'Emma', 'Liam', 'Sofia', 'Arjun', 'Ines', 'Kofi'];
const LAST = ['Smith', 'Johnson', 'Williams', 'Brown', 'Jones', 'Garcia', 'Miller', 'Davis', 'Rodriguez', 'Martinez', 'Hernandez', 'Lopez', 'Wilson', 'Anderson', 'Thomas', 'Taylor', 'Moore', 'Jackson', 'Martin', 'Lee', 'Patel', 'Nguyen', 'Kim', 'Chen', 'Singh', 'Kowalski', 'Mueller', 'Rossi', 'Silva', 'Okafor', 'Tanaka', 'Ivanova', 'Dubois', 'Novak', 'Haddad'];

const orgName = (c: Connector) => c.name.split(/\s+/)[0].replace(/[^a-z0-9]/gi, '') || 'Org';

// ---------------------------------------------------------------- Enrichment payloads

function genDefender(r: Rng, behind: number, pOnboard: number, reporting: boolean): DefenderInfo {
  if (!r.chance(pOnboard)) {
    return {
      onboarded: false, machineId: '', sensorHealth: '—', avStatus: 'Not onboarded', riskLevel: 'Unknown',
      exposureLevel: 'Unknown', exposureScore: 0, signatureVersion: '', engineVersion: '', lastScan: 0, activeAlerts: 0,
    };
  }
  const sensorHealth = reporting ? r.weighted([['Active', 92], ['Inactive', 4], ['Misconfigured', 4]] as const) : 'Inactive';
  const avStatus = sensorHealth === 'Inactive'
    ? 'Not reporting'
    : r.weighted([['Up to date', 86], ['Out of date', 9], ['Disabled', 3], ['Passive mode', 2]] as const);
  const riskBase = behind + (avStatus !== 'Up to date' ? 3 : 0) + r.int(0, 3);
  const riskLevel = riskBase >= 9 ? 'High' : riskBase >= 5 ? 'Medium' : riskBase >= 2 ? 'Low' : 'None';
  const exposureScore = Math.min(100, riskBase * 8 + r.int(0, 15));
  const sigAge = avStatus === 'Up to date' ? 0 : r.int(5, 60);
  return {
    onboarded: true,
    machineId: r.hex(40),
    sensorHealth,
    avStatus,
    riskLevel,
    exposureLevel: exposureScore >= 70 ? 'High' : exposureScore >= 35 ? 'Medium' : 'Low',
    exposureScore,
    signatureVersion: `1.4${19 - Math.min(9, Math.floor(sigAge / 7))}.${r.int(100, 999)}.0`,
    engineVersion: `1.1.${24090 - Math.floor(sigAge / 30) * 10}.${r.int(1, 9)}`,
    lastScan: NOW - (avStatus === 'Up to date' ? r.int(0, 36) : r.int(48, 24 * 30)) * HOUR,
    activeAlerts: riskLevel === 'High' ? r.int(0, 6) : r.chance(0.03) ? 1 : 0,
  };
}

function genPatch(r: Rng, behind: number, source: PatchInfo['source'], reporting: boolean): PatchInfo {
  const stale = reporting ? r.chance(0.03) : r.chance(0.6);
  const missingCritical = behind === 0 ? (r.chance(0.03) ? 1 : 0)
    : behind <= 2 ? (r.chance(0.2 * behind) ? 1 : 0)
    : r.int(0, Math.min(behind, 3)) + (behind > 4 ? r.int(1, behind - 3) : 0);
  const missingSecurity = behind === 0 ? (r.chance(0.2) ? 1 : 0) : behind * r.int(1, 3) + r.int(0, 2);
  const status: PatchStatus = stale ? 'Stale assessment' : missingCritical > 0 ? 'Critical missing' : missingSecurity > 0 ? 'Security missing' : 'Up to date';
  return {
    source,
    status,
    missingCritical,
    missingSecurity,
    missingOther: r.int(0, 12),
    lastAssessed: NOW - (stale ? r.int(15, 90) * DAY : r.int(1, 36) * HOUR),
    lastPatched: NOW - (behind * 30 + r.int(1, 25)) * DAY,
    rebootPending: r.chance(0.08),
    agentVersion: source === 'ManageEngine Endpoint Central' ? `11.${r.int(3, 4)}.${r.int(2400, 2430)}.${r.int(1, 9)}` : undefined,
  };
}

function withSearch(a: RawAsset): RawAsset {
  const parts = [a.name, a.nativeId, a.account, a.accountId, a.resourceGroup, a.region, a.kind, a.os, a.osVersion, a.osBuild, a.size, a.privateIp, a.publicIp, a.mac];
  if (a.primaryUser) parts.push(a.primaryUser);
  if (a.serial) parts.push(a.serial);
  if (a.model) parts.push(a.model);
  for (const k in a.tags) parts.push(`${k}=${a.tags[k]}`);
  a.search = parts.join(' ').toLowerCase();
  return a;
}

// ---------------------------------------------------------------- Cloud generation

interface Account { name: string; id: string; env: string; regions: string[]; groups: string[]; apps: string[]; team: string; cc: string; oct: number }

function makeAccounts(r: Rng, src: CloudSource, org: string, count: number): Account[] {
  const cfg = CLOUD[src];
  const n = src === 'linode' ? Math.max(1, Math.round(count / 1500)) : Math.max(3, Math.round(count / (src === 'gcp' ? 450 : 600)));
  const used = new Set<string>();
  const out: Account[] = [];
  for (let i = 0; i < n; i++) {
    const env = r.weighted(ENVS);
    const domain = r.pick(DOMAINS);
    const envLabel = env[0].toUpperCase() + env.slice(1);
    let name: string;
    let id: string;
    switch (src) {
      case 'azure': name = `${org}-${domain}-${envLabel}`; id = r.guid(); break;
      case 'aws': name = `${org.toLowerCase()}-${domain.toLowerCase()}-${env}`; id = r.digits(12); break;
      case 'gcp': name = `${domain.toLowerCase()}-${env}-${r.hex(4)}`; id = name; break;
      default: name = `${org.toLowerCase()}-linode${i ? `-${i + 1}` : ''}`; id = r.digits(7);
    }
    if (used.has(name)) name = `${name}-${i}`;
    used.add(name);
    out.push({
      name,
      id: src === 'gcp' ? name : id,
      env,
      regions: r.sample(cfg.regions, r.int(1, 3)),
      groups:
        src === 'aws' ? Array.from({ length: r.int(1, 4) }, () => `vpc-0${r.hex(16)}`)
        : src === 'gcp' ? [`${domain.toLowerCase()}-vpc`, 'default']
        : [],
      apps: r.sample(APPS, r.int(3, 8)),
      team: r.pick(TEAMS),
      cc: `CC-${r.int(1000, 9999)}`,
      oct: (i % 250) + 1,
    });
  }
  return out;
}

function genCloudAsset(r: Rng, c: Connector, src: CloudSource, accts: Account[], i: number, org: string): RawAsset {
  const cfg = CLOUD[src];
  const acct = r.pick(accts);
  const kind = r.weighted(cfg.kinds);
  const isPaas = PAAS.has(kind);
  const isK8s = K8S.has(kind);
  const isStorage = kind === 'Storage Account' || kind === 'S3 Bucket';
  const env = acct.env;
  const app = r.pick(acct.apps);
  const region = r.chance(0.88) ? r.pick(acct.regions) : r.pick(cfg.regions);
  const behind = latentBehind(r);
  const nn = String(r.int(1, 120)).padStart(3, '0');
  const cluster = `${app}-${env}-${r.int(1, 3)}`;

  const osDef = isPaas ? null
    : isK8s ? K8S_OS[src]
    : r.chance(cfg.winShare) ? r.weightedBy(WIN_SERVER, wOs) : r.weightedBy(LINUX_BY_SRC[src], wOs);
  const [osVersion, osBuild] = osDef ? osDef.make(behind, r, cfg.flavor) : ['', ''];
  const size = r.weightedBy(isPaas ? PAAS_SIZES[kind] : cfg.sizes, wSize);

  const powerState: PowerState = isPaas ? (r.chance(0.97) ? 'available' : 'stopped')
    : isK8s ? (r.chance(0.97) ? 'running' : 'stopped')
    : src === 'azure' ? r.weighted([['running', 78], ['deallocated', 16], ['stopped', 6]] as const)
    : src === 'aws' ? r.weighted([['running', 80], ['stopped', 17], ['terminated', 3]] as const)
    : r.weighted([['running', 85], ['stopped', 15]] as const);

  const o2 = r.int(0, 255);
  const o3 = r.int(4, 254);
  let privateIp = '';
  if (!isStorage) {
    if (src === 'azure') privateIp = `10.${acct.oct}.${o2}.${o3}`;
    else if (src === 'aws') privateIp = `172.${16 + (acct.oct % 16)}.${o2}.${o3}`;
    else if (src === 'gcp') privateIp = `10.${128 + (acct.oct % 120)}.${o2}.${o3}`;
    else if (r.chance(0.6)) privateIp = `192.168.${r.int(128, 255)}.${o3}`;
  }
  const pubChance = src === 'linode' ? 1 : isStorage ? 0 : isK8s || isPaas ? 0.04 : 0.22;
  const publicIp = powerState !== 'terminated' && r.chance(pubChance)
    ? `${r.pick(cfg.pubOctets)}.${r.int(1, 254)}.${r.int(0, 255)}.${r.int(1, 254)}`
    : '';

  let name: string;
  let nativeId: string;
  let group = '';
  switch (src) {
    case 'azure': {
      const rs = AZ_SHORT[region] ?? region;
      group = isK8s ? `MC_rg-aks-${cluster}_aks-${cluster}_${region}` : `rg-${app}-${env}-${rs}`;
      const base = `/subscriptions/${acct.id}/resourceGroups/${group}/providers`;
      if (kind === 'Virtual Machine') {
        name = `vm-${app}-${env}-${nn}`;
        nativeId = `${base}/Microsoft.Compute/virtualMachines/${name}`;
      } else if (kind === 'VMSS Instance') {
        const ss = `vmss-${app}-${env}`;
        const n = r.int(0, 60);
        name = `${ss}_${n}`;
        nativeId = `${base}/Microsoft.Compute/virtualMachineScaleSets/${ss}/virtualMachines/${n}`;
      } else if (isK8s) {
        const ss = `aks-${r.pick(['system', 'user', 'np01', 'np02'])}-${r.digits(8)}-vmss`;
        name = `${ss}${r.chars(B36, 6)}`;
        nativeId = `${base}/Microsoft.Compute/virtualMachineScaleSets/${ss}/virtualMachines/${r.int(0, 30)}`;
      } else if (kind === 'SQL Database') {
        name = `sqldb-${app}-${r.hex(4)}`;
        nativeId = `${base}/Microsoft.Sql/servers/sql-${app}-${env}-${rs}/databases/${name}`;
      } else {
        name = `st${app}${env}${r.hex(6)}`.slice(0, 24);
        nativeId = `${base}/Microsoft.Storage/storageAccounts/${name}`;
      }
      break;
    }
    case 'aws': {
      group = isStorage ? '' : r.pick(acct.groups);
      if (kind === 'EC2 Instance') {
        name = `${app}-${env}-${r.pick(ROLES)}-${nn}`;
        nativeId = `arn:aws:ec2:${region}:${acct.id}:instance/i-0${r.hex(16)}`;
      } else if (isK8s) {
        name = `ip-${privateIp.replace(/\./g, '-')}.${region}.compute.internal`;
        nativeId = `arn:aws:ec2:${region}:${acct.id}:instance/i-0${r.hex(16)}`;
      } else if (kind === 'RDS Instance') {
        name = `${app}-${env}-db-${nn}`;
        nativeId = `arn:aws:rds:${region}:${acct.id}:db:${name}`;
      } else {
        name = `${org.toLowerCase()}-${app}-${env}-${r.hex(6)}`;
        nativeId = `arn:aws:s3:::${name}`;
      }
      break;
    }
    case 'gcp': {
      group = r.pick(acct.groups);
      const zone = `${region}-${r.pick(['a', 'b', 'c'])}`;
      if (kind === 'Compute Instance') {
        name = `${app}-${env}-${nn}`;
        nativeId = `projects/${acct.id}/zones/${zone}/instances/${name}`;
      } else if (isK8s) {
        name = `gke-${cluster}-default-pool-${r.hex(8)}-${r.chars(B36, 4)}`;
        nativeId = `projects/${acct.id}/zones/${zone}/instances/${name}`;
      } else {
        name = `${app}-${env}-pg-${nn}`;
        nativeId = `projects/${acct.id}/instances/${name}`;
      }
      break;
    }
    default: {
      name = isK8s ? `lke${r.digits(6)}-${r.digits(6)}-${r.hex(8)}` : `li-${app}-${env}-${nn}`;
      nativeId = `linode/${r.digits(8)}`;
    }
  }

  const tags: Record<string, string> = {};
  if (!r.chance(0.08)) {
    tags.env = env;
    tags.app = app;
    if (r.chance(0.9)) tags.owner = acct.team;
    if (r.chance(0.7)) tags.costcenter = acct.cc;
    if (r.chance(0.55)) tags['managed-by'] = r.pick(src === 'aws' ? ['terraform', 'cloudformation', 'manual'] : src === 'azure' ? ['terraform', 'bicep', 'manual'] : ['terraform', 'manual']);
    if (osDef && r.chance(0.4)) tags['patch-window'] = r.pick(PATCH_WINDOWS);
    if (r.chance(0.3)) tags.backup = r.pick(['daily', 'weekly', 'none']);
    if (env === 'prod' && r.chance(0.5)) tags.criticality = r.pick(['tier-0', 'tier-1', 'tier-2']);
  }
  if (isK8s) {
    const key = src === 'azure' ? 'aks-managed-cluster-name' : src === 'aws' ? 'eks:cluster-name' : src === 'gcp' ? 'goog-k8s-cluster-name' : 'lke-cluster';
    tags[key] = cluster;
  }

  const running = powerState === 'running';
  const isVm = kind === 'Virtual Machine' || kind === 'VMSS Instance';
  const defender = osDef ? genDefender(r, behind, isK8s ? 0.5 : cfg.defender, running) : undefined;
  const aum = src === 'azure' && isVm && r.chance(0.88) ? genPatch(r, behind, 'Azure Update Manager', running) : undefined;
  if (aum) aum.maintenanceConfig = r.chance(0.6) ? `mc-${env}-${r.pick(PATCH_WINDOWS)}` : 'None (assessment only)';
  const endpointCentral = osDef && !isK8s && r.chance(cfg.ec) ? genPatch(r, behind, 'ManageEngine Endpoint Central', running) : undefined;

  return withSearch({
    id: `${c.id}:${i}`,
    nativeId,
    name,
    source: src,
    connectorId: c.id,
    connectorName: c.name,
    kind,
    account: acct.name,
    accountId: acct.id,
    resourceGroup: group,
    region,
    size: size[0],
    osFamily: osDef?.family ?? '',
    os: osDef?.os ?? '',
    osVersion,
    osBuild,
    eol: osDef?.eol ?? false,
    cpu: size[1],
    memoryGb: size[2],
    diskGb: isStorage ? r.int(1, 8000) : isPaas ? r.pick([32, 64, 128, 256, 512, 1024]) : r.pick([30, 64, 128, 128, 256, 512]),
    privateIp,
    publicIp,
    mac: isPaas ? '' : r.mac(),
    powerState,
    tags,
    createdAt: NOW - r.int(1, 1500) * DAY,
    lastSeen: powerState === 'terminated' ? NOW - r.int(2, 30) * DAY : NOW - r.int(2, 240) * MIN,
    defender,
    aum,
    endpointCentral,
    search: '',
  });
}

function genCloud(c: Connector, src: CloudSource): RawAsset[] {
  const r = new Rng(c.seed);
  const org = orgName(c);
  const accts = makeAccounts(r, src, org, c.simulatedCount);
  const out = new Array<RawAsset>(c.simulatedCount);
  for (let i = 0; i < c.simulatedCount; i++) out[i] = genCloudAsset(r, c, src, accts, i, org);
  return out;
}

// ---------------------------------------------------------------- Intune generation

type Model = readonly [manufacturer: string, model: string];
const MODELS: Record<string, Model[]> = {
  winLaptop: [['Dell', 'Latitude 7440'], ['Dell', 'Latitude 5540'], ['Lenovo', 'ThinkPad T14 Gen 4'], ['Lenovo', 'ThinkPad X1 Carbon Gen 11'], ['HP', 'EliteBook 840 G10'], ['Microsoft Corporation', 'Surface Laptop 5']],
  winDesktop: [['Dell', 'OptiPlex 7010'], ['HP', 'EliteDesk 800 G9'], ['Lenovo', 'ThinkCentre M90q Gen 4']],
  macLaptop: [['Apple', 'MacBook Pro 14" (M3)'], ['Apple', 'MacBook Air 13" (M2)'], ['Apple', 'MacBook Pro 16" (M3 Max)']],
  macDesktop: [['Apple', 'Mac mini (M2)'], ['Apple', 'iMac 24" (M3)']],
  ios: [['Apple', 'iPhone 15'], ['Apple', 'iPhone 14'], ['Apple', 'iPhone 13'], ['Apple', 'iPad Air (5th gen)']],
  android: [['Samsung', 'Galaxy S24'], ['Samsung', 'Galaxy S23'], ['Google', 'Pixel 8'], ['Google', 'Pixel 7a']],
};

function genIntune(c: Connector): RawAsset[] {
  const r = new Rng(c.seed);
  const org = orgName(c);
  const prefix = org.toUpperCase().slice(0, 6);
  const domain = `${org.toLowerCase()}.com`;
  const tenantId = r.guid();
  const account = `${org} (${domain})`;
  const out = new Array<RawAsset>(c.simulatedCount);

  for (let i = 0; i < c.simulatedCount; i++) {
    const kind = r.weighted([['Laptop', 58], ['Desktop', 24], ['Mobile', 18]] as const);
    const isMobile = kind === 'Mobile';
    const family: OsFamily = isMobile
      ? (r.chance(0.6) ? 'iOS' : 'Android')
      : r.chance(kind === 'Laptop' ? 0.82 : 0.95) ? 'Windows' : 'macOS';
    const list = family === 'Windows' ? CLIENT_WIN : family === 'macOS' ? MAC : family === 'iOS' ? IOS : ANDROID;
    const osDef = r.weightedBy(list, wOs);
    const behind = latentBehind(r);
    const [osVersion, osBuild] = osDef.make(behind, r, 'generic');
    const models = family === 'Windows' ? (kind === 'Laptop' ? MODELS.winLaptop : MODELS.winDesktop)
      : family === 'macOS' ? (kind === 'Laptop' ? MODELS.macLaptop : MODELS.macDesktop)
      : family === 'iOS' ? MODELS.ios : MODELS.android;
    const [manufacturer, model] = r.pick(models);
    const first = r.pick(FIRST);
    const last = r.pick(LAST);
    const primaryUser = `${first}.${last}${r.chance(0.3) ? r.int(1, 99) : ''}@${domain}`.toLowerCase();
    const serial = manufacturer === 'Dell' ? r.chars(ALNUM, 7) : r.chars(ALNUM, family === 'Windows' ? 10 : 12);

    let name: string;
    if (family === 'Windows') name = `${prefix}-${kind === 'Laptop' ? 'LT' : 'DT'}-${serial.slice(-7)}`;
    else if (family === 'macOS') name = `${first}'s ${model.split(' (')[0]}`;
    else if (family === 'iOS') name = `${first}'s ${model.split(' (')[0]}`;
    else name = `${first.toLowerCase()}_Android_${r.int(1, 12)}/${r.int(1, 28)}/${r.int(2023, 2026)}`;

    const region = r.weighted([['Americas', 50], ['EMEA', 32], ['APAC', 18]] as const);
    const ageBucket = r.weighted([[0, 70], [1, 20], [2, 7], [3, 3]] as const);
    const lastSeen = NOW - (
      ageBucket === 0 ? r.int(1, 1440) * MIN
      : ageBucket === 1 ? r.int(1, 7) * DAY
      : ageBucket === 2 ? r.int(8, 30) * DAY
      : r.int(31, 180) * DAY);
    const powerState: PowerState = NOW - lastSeen < DAY ? 'online' : 'offline';
    const compliance = behind >= 6 || ageBucket === 3
      ? r.weighted([['Non-compliant', 70], ['In grace period', 30]] as const)
      : r.weighted([['Compliant', 93], ['Non-compliant', 4], ['In grace period', 3]] as const);
    const reporting = ageBucket <= 1;

    const defender = genDefender(r, behind, family === 'Windows' ? 0.96 : family === 'macOS' ? 0.85 : 0.45, reporting);
    const endpointCentral = !isMobile && r.chance(0.9) ? genPatch(r, behind, 'ManageEngine Endpoint Central', reporting) : undefined;
    const privateIp = r.chance(0.5) ? `192.168.${r.int(0, 10)}.${r.int(2, 254)}` : `10.${r.int(100, 140)}.${r.int(0, 255)}.${r.int(2, 254)}`;
    // Intune doesn't report egress IP; Defender does (lastExternalIpAddress).
    const publicIp = defender.onboarded && r.chance(0.8) ? `${r.pick([24, 73, 81, 86, 98, 109, 151, 203])}.${r.int(1, 254)}.${r.int(0, 255)}.${r.int(1, 254)}` : '';

    out[i] = withSearch({
      id: `${c.id}:${i}`,
      nativeId: r.guid(),
      name,
      source: 'intune',
      connectorId: c.id,
      connectorName: c.name,
      kind,
      account,
      accountId: tenantId,
      resourceGroup: '',
      region,
      size: '',
      osFamily: family,
      os: osDef.os,
      osVersion,
      osBuild,
      eol: osDef.eol ?? false,
      cpu: isMobile ? r.pick([6, 8]) : family === 'macOS' ? r.pick([8, 10, 12]) : r.pick([4, 8, 12, 16]),
      memoryGb: isMobile ? r.pick([4, 6, 8]) : r.pick([8, 16, 16, 32]),
      diskGb: isMobile ? r.pick([128, 256]) : r.pick([256, 512, 512, 1024]),
      privateIp,
      publicIp,
      mac: r.mac(),
      powerState,
      tags: {
        'device-category': isMobile ? r.pick(['Corporate', 'BYOD']) : r.weighted([['Corporate', 80], ['Developer', 12], ['Kiosk', 4], ['Shared', 4]] as const),
        'scope-tag': region,
        ownership: isMobile && r.chance(0.4) ? 'Personal' : 'Corporate',
        enrollment: family === 'Windows' ? r.weighted([['Autopilot', 75], ['Co-management', 15], ['Manual', 10]] as const)
          : family === 'Android' ? 'Android Enterprise' : 'Apple Business Manager',
      },
      createdAt: NOW - r.int(10, 1400) * DAY,
      lastSeen,
      primaryUser,
      serial,
      manufacturer,
      model,
      compliance,
      encrypted: r.chance(0.94),
      defender,
      endpointCentral,
      search: '',
    });
  }
  return out;
}

// ---------------------------------------------------------------- Public API

const cache = new Map<string, RawAsset[]>();

export function generateForConnector(c: Connector): RawAsset[] {
  const key = `${c.id}|${c.seed}|${c.simulatedCount}|${c.name}`;
  let v = cache.get(key);
  if (!v) {
    v = c.type === 'intune' ? genIntune(c) : genCloud(c, c.type as CloudSource);
    cache.set(key, v);
  }
  return v;
}
