import type { Connector, ConnectorType } from './types';

export interface FieldDef {
  key: string;
  label: string;
  secret?: boolean;
  placeholder?: string;
}

export interface ConnectorMeta {
  label: string;
  labelShort: string;
  short: string;
  color: string;
  category: 'inventory' | 'enrichment';
  description: string;
  matchKeys?: string;
  fields: FieldDef[];
  defaultCount: number;
}

const entraFields: FieldDef[] = [
  { key: 'tenantId', label: 'Tenant ID', placeholder: '00000000-0000-0000-0000-000000000000' },
  { key: 'clientId', label: 'Client (app) ID', placeholder: '00000000-0000-0000-0000-000000000000' },
  { key: 'clientSecret', label: 'Client secret', secret: true },
];

export const CONNECTOR_META: Record<ConnectorType, ConnectorMeta> = {
  azure: {
    label: 'Microsoft Azure',
    labelShort: 'Azure',
    short: 'AZ',
    color: '#0078d4',
    category: 'inventory',
    description: 'Subscriptions, resource groups, VMs, scale sets, AKS nodes, SQL and storage via Azure Resource Graph.',
    fields: [...entraFields, { key: 'scope', label: 'Subscription scope', placeholder: 'All, or comma-separated subscription IDs' }],
    defaultCount: 5000,
  },
  aws: {
    label: 'Amazon Web Services',
    labelShort: 'AWS',
    short: 'AWS',
    color: '#ff9900',
    category: 'inventory',
    description: 'Organization accounts, EC2, EKS nodes, RDS and S3 via AWS Config aggregator / cross-account role.',
    fields: [
      { key: 'roleArn', label: 'Cross-account role ARN', placeholder: 'arn:aws:iam::123456789012:role/AssetInventoryReader' },
      { key: 'externalId', label: 'External ID', secret: true },
      { key: 'regions', label: 'Regions', placeholder: 'all' },
    ],
    defaultCount: 5000,
  },
  gcp: {
    label: 'Google Cloud',
    labelShort: 'GCP',
    short: 'GCP',
    color: '#4285f4',
    category: 'inventory',
    description: 'Projects, Compute Engine, GKE nodes and Cloud SQL via Cloud Asset Inventory.',
    fields: [
      { key: 'orgId', label: 'Organization ID', placeholder: '123456789012' },
      { key: 'serviceAccount', label: 'Service account key (JSON)', secret: true },
      { key: 'projectFilter', label: 'Project filter', placeholder: 'e.g. labels.env:prod' },
    ],
    defaultCount: 3000,
  },
  linode: {
    label: 'Akamai Linode',
    labelShort: 'Linode',
    short: 'LIN',
    color: '#02b159',
    category: 'inventory',
    description: 'Linodes and LKE nodes via the Linode API v4.',
    fields: [{ key: 'apiToken', label: 'Personal access token (read-only)', secret: true }],
    defaultCount: 1000,
  },
  intune: {
    label: 'Microsoft Intune',
    labelShort: 'Intune',
    short: 'INT',
    color: '#8661c5',
    category: 'inventory',
    description: 'Managed Windows, macOS, iOS and Android devices via Microsoft Graph (deviceManagement/managedDevices).',
    fields: [...entraFields, { key: 'filter', label: 'Device filter', placeholder: "e.g. operatingSystem eq 'Windows'" }],
    defaultCount: 5000,
  },
  defender: {
    label: 'Microsoft Defender for Endpoint',
    labelShort: 'Defender',
    short: 'MDE',
    color: '#d83b01',
    category: 'enrichment',
    description: 'Onboarding, sensor health, AV signature status, risk & exposure level, active alerts.',
    matchKeys: 'Azure VM ID, AAD device ID, hostname + MAC',
    fields: entraFields,
    defaultCount: 0,
  },
  aum: {
    label: 'Azure Update Manager',
    labelShort: 'Update Mgr',
    short: 'AUM',
    color: '#00a2ed',
    category: 'enrichment',
    description: 'Patch assessment & installation results for Azure VMs (patchassessmentresources).',
    matchKeys: 'Azure resource ID',
    fields: [...entraFields, { key: 'scope', label: 'Subscription scope', placeholder: 'All' }],
    defaultCount: 0,
  },
  endpointcentral: {
    label: 'ManageEngine Endpoint Central',
    labelShort: 'Endpoint Central',
    short: 'MEC',
    color: '#e8452c',
    category: 'enrichment',
    description: 'Agent status, missing patches by severity, last scan and reboot-pending state.',
    matchKeys: 'Hostname, serial number, MAC',
    fields: [
      { key: 'serverUrl', label: 'Server URL', placeholder: 'https://endpointcentral.contoso.com:8383' },
      { key: 'apiKey', label: 'API key', secret: true },
    ],
    defaultCount: 0,
  },
  cloudflare: {
    label: 'Cloudflare DNS',
    labelShort: 'Cloudflare',
    short: 'CF',
    color: '#f38020',
    category: 'enrichment',
    description: 'DNS A and CNAME records across zones, correlated to assets to show which hostnames point at them.',
    matchKeys: 'Public IP (A), provider FQDN (CNAME), CNAME chains',
    fields: [
      { key: 'accountId', label: 'Account ID', placeholder: '0123456789abcdef0123456789abcdef' },
      { key: 'apiToken', label: 'API token (Zone:DNS:Read)', secret: true },
      { key: 'zones', label: 'Zones', placeholder: 'All, or comma-separated zone names' },
    ],
    defaultCount: 0,
  },
};

export type ResourceGroup = 'Compute' | 'Containers' | 'Serverless & app hosting' | 'Data & storage' | 'Device platforms';

export interface ResourceTypeDef {
  /** Matches asset.kind (cloud) or asset.osFamily (Intune). */
  key: string;
  label: string;
  group: ResourceGroup;
  defaultOn: boolean;
  /** False when the POC generator has no sample data for this type yet. */
  simulated: boolean;
}

const rt = (key: string, label: string, group: ResourceGroup, defaultOn: boolean, simulated = true): ResourceTypeDef => ({ key, label, group, defaultOn, simulated });

export const RESOURCE_TYPES: Partial<Record<ConnectorType, ResourceTypeDef[]>> = {
  azure: [
    rt('Virtual Machine', 'Virtual Machines', 'Compute', true),
    rt('VMSS Instance', 'VM Scale Set instances', 'Compute', true),
    rt('Arc Server', 'Azure Arc-enabled servers', 'Compute', false, false),
    rt('AVD Session Host', 'Azure Virtual Desktop session hosts', 'Compute', false, false),
    rt('AKS Node', 'AKS nodes', 'Containers', true),
    rt('Container App', 'Container Apps', 'Containers', false, false),
    rt('Container Instance', 'Container Instances (ACI)', 'Containers', false, false),
    rt('Function App', 'Azure Functions', 'Serverless & app hosting', false, false),
    rt('Web App', 'App Service – Web Apps', 'Serverless & app hosting', false, false),
    rt('SQL Database', 'Azure SQL Database', 'Data & storage', false),
    rt('Storage Account', 'Storage accounts', 'Data & storage', false),
  ],
  aws: [
    rt('EC2 Instance', 'EC2 instances', 'Compute', true),
    rt('Lightsail Instance', 'Lightsail instances', 'Compute', false, false),
    rt('WorkSpace', 'WorkSpaces', 'Compute', false, false),
    rt('EKS Node', 'EKS nodes', 'Containers', true),
    rt('ECS Task', 'ECS / Fargate tasks', 'Containers', false, false),
    rt('Lambda Function', 'Lambda functions', 'Serverless & app hosting', false, false),
    rt('Beanstalk Environment', 'Elastic Beanstalk environments', 'Serverless & app hosting', false, false),
    rt('App Runner Service', 'App Runner services', 'Serverless & app hosting', false, false),
    rt('RDS Instance', 'RDS instances', 'Data & storage', false),
    rt('S3 Bucket', 'S3 buckets', 'Data & storage', false),
  ],
  gcp: [
    rt('Compute Instance', 'Compute Engine instances', 'Compute', true),
    rt('GKE Node', 'GKE nodes', 'Containers', true),
    rt('Cloud Run Service', 'Cloud Run services', 'Serverless & app hosting', false, false),
    rt('Cloud Function', 'Cloud Functions', 'Serverless & app hosting', false, false),
    rt('App Engine Service', 'App Engine services', 'Serverless & app hosting', false, false),
    rt('Cloud SQL', 'Cloud SQL instances', 'Data & storage', false),
  ],
  linode: [
    rt('Linode', 'Linodes', 'Compute', true),
    rt('LKE Node', 'LKE nodes', 'Containers', true),
  ],
  intune: [
    rt('Windows', 'Windows', 'Device platforms', true),
    rt('macOS', 'macOS', 'Device platforms', true),
    rt('iOS', 'iOS / iPadOS', 'Device platforms', true),
    rt('Android', 'Android', 'Device platforms', true),
    rt('Linux', 'Linux (Ubuntu / RHEL)', 'Device platforms', false, false),
  ],
};

export const defaultResourceTypes = (t: ConnectorType) => (RESOURCE_TYPES[t] ?? []).filter((r) => r.defaultOn).map((r) => r.key);

export const enabledResourceTypes = (c: Connector) => new Set(c.resourceTypes ?? defaultResourceTypes(c.type));

export const INVENTORY_TYPES: ConnectorType[] = ['azure', 'aws', 'gcp', 'linode', 'intune'];
export const ENRICHMENT_TYPES: ConnectorType[] = ['defender', 'aum', 'endpointcentral', 'cloudflare'];

export const isInventory = (t: ConnectorType) => CONNECTOR_META[t].category === 'inventory';

const MIN = 60_000;
const now = Date.now();

export const DEFAULT_CONNECTORS: Connector[] = [
  { id: 'az-contoso', type: 'azure', name: 'Contoso – Azure (Production tenant)', enabled: true, status: 'healthy', lastSync: now - 7 * MIN, simulatedCount: 16000, seed: 101, config: { tenantId: '72f988bf-0000-0000-0000-2d7cd011db47', clientId: 'b1e2c3d4-0000-0000-0000-000000000001', scope: 'All' } },
  { id: 'az-fabrikam', type: 'azure', name: 'Fabrikam – Azure (Acquired tenant)', enabled: true, status: 'warning', statusMessage: '2 subscriptions returned 403 – Reader role missing', statusDetails: ['Fabrikam-Legacy-Prod (5d1e0c2a-7b44-4f0e-9a31-0c8e2f6b1a90) – 403 AuthorizationFailed', 'Fabrikam-SAP-NonProd (a83f19d4-2c6e-4b8a-b0f5-7e1d93c4a2b6) – 403 AuthorizationFailed'], statusRemediation: 'Grant the connector service principal the Reader role on the affected subscriptions (or at the management group), then run Sync now.', lastSync: now - 22 * MIN, simulatedCount: 3500, seed: 202, config: { tenantId: 'a0b1c2d3-0000-0000-0000-fab000000001', clientId: 'c1e2c3d4-0000-0000-0000-000000000002', scope: 'All' } },
  { id: 'aws-org', type: 'aws', name: 'Contoso – AWS Organization', enabled: true, status: 'healthy', lastSync: now - 12 * MIN, simulatedCount: 14000, seed: 303, config: { roleArn: 'arn:aws:iam::111122223333:role/AssetInventoryReader', regions: 'all' } },
  { id: 'gcp-org', type: 'gcp', name: 'Contoso – GCP Organization', enabled: true, status: 'healthy', lastSync: now - 18 * MIN, simulatedCount: 6000, seed: 404, config: { orgId: '482910374651' } },
  { id: 'linode', type: 'linode', name: 'Contoso – Linode', enabled: true, status: 'healthy', lastSync: now - 4 * MIN, simulatedCount: 1500, seed: 505, config: {} },
  { id: 'intune', type: 'intune', name: 'Contoso – Intune', enabled: true, status: 'healthy', lastSync: now - 9 * MIN, simulatedCount: 12000, seed: 606, config: { tenantId: '72f988bf-0000-0000-0000-2d7cd011db47', clientId: 'd1e2c3d4-0000-0000-0000-000000000003' } },
  { id: 'mde', type: 'defender', name: 'Microsoft Defender for Endpoint', enabled: true, status: 'healthy', lastSync: now - 6 * MIN, simulatedCount: 0, seed: 0, config: { tenantId: '72f988bf-0000-0000-0000-2d7cd011db47' } },
  { id: 'aum', type: 'aum', name: 'Azure Update Manager', enabled: true, status: 'healthy', lastSync: now - 31 * MIN, simulatedCount: 0, seed: 0, config: { tenantId: '72f988bf-0000-0000-0000-2d7cd011db47', scope: 'All' } },
  { id: 'mec', type: 'endpointcentral', name: 'ManageEngine Endpoint Central', enabled: true, status: 'warning', statusMessage: 'API key expires in 9 days', statusDetails: ['Key ID: mec-api-7f3a (created 2025-10-11)', 'Expires: 2026-10-11 00:00 UTC', 'Last successful call: 47 minutes ago'], statusRemediation: 'Generate a new API key in Endpoint Central (Admin → API Explorer) and update it under Configure.', lastSync: now - 47 * MIN, simulatedCount: 0, seed: 0, config: { serverUrl: 'https://endpointcentral.contoso.com:8383' } },
  { id: 'cf', type: 'cloudflare', name: 'Contoso – Cloudflare', enabled: true, status: 'healthy', lastSync: now - 3 * MIN, simulatedCount: 0, seed: 707, config: { accountId: '9f2c4e1a7b3d5f60819a2b3c4d5e6f70', zones: 'All' } },
];

const STORAGE_KEY = 'asset-inventory.connectors.v1';
const REMOVED_KEY = 'asset-inventory.removedDefaults.v1';

function removedDefaults(): Set<string> {
  try {
    const v: unknown = JSON.parse(localStorage.getItem(REMOVED_KEY) ?? '[]');
    return new Set(Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);
  } catch {
    return new Set();
  }
}

export function markDefaultRemoved(id: string) {
  if (!DEFAULT_CONNECTORS.some((d) => d.id === id)) return;
  localStorage.setItem(REMOVED_KEY, JSON.stringify([...removedDefaults().add(id)]));
}
export const MAX_SIMULATED = 100_000;

export function loadConnectors(): Connector[] {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null');
    if (Array.isArray(parsed)) {
      const valid = parsed.filter(
        (c): c is Connector =>
          c && typeof c.id === 'string' && typeof c.name === 'string' && c.type in CONNECTOR_META &&
          typeof c.simulatedCount === 'number' && c.simulatedCount >= 0 && c.simulatedCount <= MAX_SIMULATED &&
          typeof c.seed === 'number' && typeof c.config === 'object' && c.config !== null &&
          (c.resourceTypes === undefined || (Array.isArray(c.resourceTypes) && c.resourceTypes.every((k: unknown) => typeof k === 'string'))),
      );
      if (valid.length) {
        // Add defaults introduced since the user last loaded, without resurrecting ones they removed.
        const removed = removedDefaults();
        const added = DEFAULT_CONNECTORS.filter((d) => !removed.has(d.id) && !valid.some((c) => c.id === d.id));
        return [...valid.map((c) => {
          const d = DEFAULT_CONNECTORS.find((x) => x.id === c.id);
          return d && c.statusMessage === d.statusMessage
            ? { ...c, statusDetails: d.statusDetails, statusRemediation: d.statusRemediation }
            : c;
        }), ...added];
      }
    }
  } catch {
    /* fall through to defaults */
  }
  return DEFAULT_CONNECTORS;
}

/** Secret fields are kept in memory only; never written to localStorage. */
export function saveConnectors(connectors: Connector[]) {
  const safe = connectors.map((c) => {
    const secretKeys = new Set(CONNECTOR_META[c.type].fields.filter((f) => f.secret).map((f) => f.key));
    const config = Object.fromEntries(Object.entries(c.config).filter(([k]) => !secretKeys.has(k)));
    return { ...c, config };
  });
  localStorage.setItem(STORAGE_KEY, JSON.stringify(safe));
}

export function clearSavedConnectors() {
  localStorage.removeItem(STORAGE_KEY);
  localStorage.removeItem(REMOVED_KEY);
}
