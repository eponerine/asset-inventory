export type SourceType = 'azure' | 'aws' | 'gcp' | 'linode' | 'intune';
export type EnrichmentType = 'defender' | 'aum' | 'endpointcentral' | 'cloudflare';
export type ConnectorType = SourceType | EnrichmentType;
export type OsFamily = 'Windows' | 'Linux' | 'macOS' | 'iOS' | 'Android';
export type PowerState = 'running' | 'stopped' | 'deallocated' | 'terminated' | 'online' | 'offline' | 'available';

export interface Connector {
  id: string;
  type: ConnectorType;
  name: string;
  enabled: boolean;
  status: 'healthy' | 'warning' | 'error';
  statusMessage?: string;
  /** Per-item detail lines behind the status message (e.g. affected subscriptions). */
  statusDetails?: string[];
  /** Suggested fix shown in the status modal. */
  statusRemediation?: string;
  lastSync: number;
  /** POC only: how many fake assets this connector produces. */
  simulatedCount: number;
  seed: number;
  config: Record<string, string>;
  /** Resource types to inventory; undefined = connector defaults. */
  resourceTypes?: string[];
}

export interface DefenderInfo {
  onboarded: boolean;
  machineId: string;
  sensorHealth: 'Active' | 'Inactive' | 'Misconfigured' | '—';
  avStatus: 'Up to date' | 'Out of date' | 'Disabled' | 'Passive mode' | 'Not reporting' | 'Not onboarded';
  riskLevel: 'None' | 'Low' | 'Medium' | 'High' | 'Unknown';
  exposureLevel: 'Low' | 'Medium' | 'High' | 'Unknown';
  exposureScore: number;
  signatureVersion: string;
  engineVersion: string;
  lastScan: number;
  activeAlerts: number;
}

export type PatchStatus = 'Up to date' | 'Security missing' | 'Critical missing' | 'Stale assessment';

export interface PatchInfo {
  source: 'Azure Update Manager' | 'ManageEngine Endpoint Central';
  status: PatchStatus;
  missingCritical: number;
  missingSecurity: number;
  missingOther: number;
  lastAssessed: number;
  lastPatched: number;
  rebootPending: boolean;
  maintenanceConfig?: string;
  agentVersion?: string;
}

export interface RawAsset {
  id: string;
  nativeId: string;
  name: string;
  source: SourceType;
  connectorId: string;
  connectorName: string;
  kind: string;
  account: string;
  accountId: string;
  resourceGroup: string;
  region: string;
  size: string;
  osFamily: OsFamily | '';
  os: string;
  osVersion: string;
  osBuild: string;
  eol: boolean;
  cpu: number;
  memoryGb: number;
  diskGb: number;
  privateIp: string;
  publicIp: string;
  mac: string;
  powerState: PowerState;
  tags: Record<string, string>;
  createdAt: number;
  lastSeen: number;
  primaryUser?: string;
  serial?: string;
  manufacturer?: string;
  model?: string;
  compliance?: string;
  encrypted?: boolean;
  defender?: DefenderInfo;
  aum?: PatchInfo;
  endpointCentral?: PatchInfo;
  /** Pre-computed lowercase haystack for free-text search. */
  search: string;
}

export interface DnsRecord {
  id: string;
  zone: string;
  name: string;
  type: 'A' | 'CNAME';
  content: string;
  proxied: boolean;
  /** 1 = Cloudflare "Auto". */
  ttl: number;
  modifiedOn: number;
}

export interface DnsMatch extends DnsRecord {
  matchedBy: 'Public IP' | 'Provider FQDN' | 'CNAME chain';
}

/** A raw asset after enrichment connectors have been applied/correlated. */
export interface Asset extends RawAsset {
  seenBy: ConnectorType[];
  dns: DnsMatch[];
  patch?: PatchInfo;
  av: string;
  risk: string;
  patchStatus: string;
  missingCritical: number | null;
}
