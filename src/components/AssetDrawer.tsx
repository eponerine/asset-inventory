import { useEffect, useState, type ReactNode } from 'react';
import { CONNECTOR_META } from '../data/connectors';
import { providerFqdn } from '../data/dns';
import type { Asset, PatchInfo } from '../data/types';
import { fmtDate, relTime } from '../lib/format';
import { Pill, SourceBadge, StateDot, TagList } from './ui';

type Row = [label: string, value: ReactNode, mono?: boolean];

function KV({ rows }: { rows: Row[] }) {
  return (
    <dl className="kv">
      {rows.map(([k, v, mono]) => (
        <div key={k}>
          <dt>{k}</dt>
          <dd className={mono ? 'mono' : undefined}>{v === '' || v == null ? '—' : v}</dd>
        </div>
      ))}
    </dl>
  );
}

function Section({ title, badge, children }: { title: string; badge?: ReactNode; children: ReactNode }) {
  return (
    <section className="d-section">
      <h3>{badge}{title}</h3>
      {children}
    </section>
  );
}

const ACCOUNT_LABEL = { azure: 'Subscription', aws: 'AWS account', gcp: 'Project', linode: 'Account', intune: 'Tenant' } as const;
const GROUP_LABEL = { azure: 'Resource group', aws: 'VPC', gcp: 'Network', linode: 'Group', intune: 'Group' } as const;

function PatchRows({ p }: { p: PatchInfo }) {
  return (
    <KV
      rows={[
        ['Status', <Pill v={p.status} />],
        ['Missing critical', <span className={p.missingCritical ? 'text-bad strong' : ''}>{p.missingCritical}</span>],
        ['Missing security', p.missingSecurity],
        ['Missing other', p.missingOther],
        ['Reboot pending', p.rebootPending ? <Pill v="Yes" small /> : 'No'],
        ['Last assessed', `${relTime(p.lastAssessed)} (${fmtDate(p.lastAssessed)})`],
        ['Last patched', `${relTime(p.lastPatched)}`],
        ...(p.maintenanceConfig ? [['Maintenance config', p.maintenanceConfig] as Row] : []),
        ...(p.agentVersion ? [['Agent version', p.agentVersion, true] as Row] : []),
      ]}
    />
  );
}

export function AssetDrawer({ asset: a, onClose }: { asset: Asset; onClose: () => void }) {
  const [showRaw, setShowRaw] = useState(false);
  useEffect(() => {
    const h = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [onClose]);

  const d = a.defender;
  const hasOs = a.osFamily !== '';
  const { search: _search, ...raw } = a;

  return (
    <aside className="drawer" aria-label={`Asset details for ${a.name}`}>
      <header className="drawer-head">
        <div className="drawer-title-wrap">
          <SourceBadge type={a.source} />
          <div>
            <div className="drawer-title">{a.name}</div>
            <div className="muted small">{a.kind} · {a.connectorName}</div>
          </div>
        </div>
        <button className="icon-btn" onClick={onClose} aria-label="Close">×</button>
      </header>

      <div className="drawer-body">
        <div className="drawer-status">
          <StateDot state={a.powerState} />
          {a.av !== 'N/A' && <Pill v={a.av} />}
          {a.patchStatus !== 'N/A' && <Pill v={a.patchStatus} />}
          {a.risk !== 'N/A' && a.risk !== 'Unknown' && <span className="muted small">Risk</span>}
          {a.risk !== 'N/A' && a.risk !== 'Unknown' && <Pill v={a.risk} />}
          {a.eol && <Pill v="End-of-life OS" />}
        </div>

        <Section title="Correlated sources">
          <div className="seen-by">
            {a.seenBy.map((t) => (
              <span key={t} className="seen-item"><SourceBadge type={t} /> {CONNECTOR_META[t].label}</span>
            ))}
          </div>
        </Section>

        <Section title="Overview">
          <KV
            rows={[
              [ACCOUNT_LABEL[a.source], a.account],
              [`${ACCOUNT_LABEL[a.source]} ID`, a.accountId, true],
              [GROUP_LABEL[a.source], a.resourceGroup],
              ['Region', a.region],
              ['Size / SKU', a.size],
              ['Created', fmtDate(a.createdAt)],
              ['Last seen', `${relTime(a.lastSeen)} (${fmtDate(a.lastSeen)})`],
              ['Resource ID', a.nativeId, true],
            ]}
          />
        </Section>

        {hasOs && (
          <Section title="Operating system">
            <KV rows={[['OS', a.os], ['Family', a.osFamily], ['Version', a.osVersion], ['Build', a.osBuild, true], ['Lifecycle', a.eol ? <Pill v="End of life" /> : 'Supported']]} />
          </Section>
        )}

        <Section title="Hardware & network">
          <KV
            rows={[
              ['vCPU / cores', a.cpu || ''],
              ['Memory', a.memoryGb ? `${a.memoryGb} GB` : ''],
              ['Disk', a.diskGb ? `${a.diskGb.toLocaleString()} GB` : ''],
              ['Private IP', a.privateIp, true],
              ['Public IP', a.publicIp, true],
              ['MAC', a.mac, true],
              ...(providerFqdn(a) ? [['Provider FQDN', providerFqdn(a), true] as Row] : []),
            ]}
          />
        </Section>

        {a.dns.length > 0 && (
          <Section title={`Cloudflare DNS (${a.dns.length})`} badge={<SourceBadge type="cloudflare" />}>
            <table className="dns-table">
              <thead>
                <tr><th>Name</th><th>Type</th><th>Content</th><th>Proxy</th><th>Matched by</th></tr>
              </thead>
              <tbody>
                {a.dns.map((d) => (
                  <tr key={d.id}>
                    <td className="mono">{d.name}</td>
                    <td>{d.type}</td>
                    <td className="mono">{d.content}</td>
                    <td>{d.proxied ? <span className="cf-cloud" title="Proxied through Cloudflare">● Proxied</span> : <span className="muted">DNS only</span>}</td>
                    <td className="muted">{d.matchedBy}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Section>
        )}

        {a.source === 'intune' && (
          <Section title="Intune" badge={<SourceBadge type="intune" />}>
            <KV
              rows={[
                ['Primary user', a.primaryUser],
                ['Compliance', a.compliance ? <Pill v={a.compliance} /> : ''],
                ['Manufacturer', a.manufacturer],
                ['Model', a.model],
                ['Serial number', a.serial, true],
                ['Encrypted', a.encrypted ? 'Yes' : <Pill v="No" small />],
              ]}
            />
          </Section>
        )}

        <Section title="Tags">
          <TagList tags={a.tags} />
        </Section>

        {hasOs && (
          <Section title="Microsoft Defender for Endpoint" badge={<SourceBadge type="defender" />}>
            {!d ? (
              <p className="muted">No Defender data – connector disabled.</p>
            ) : !d.onboarded ? (
              <p><Pill v="Not onboarded" /> <span className="muted">Seen by inventory but not onboarded to MDE.</span></p>
            ) : (
              <KV
                rows={[
                  ['Sensor health', <Pill v={d.sensorHealth} />],
                  ['AV status', <Pill v={d.avStatus} />],
                  ['Risk level', <Pill v={d.riskLevel} />],
                  ['Exposure', `${d.exposureLevel} (${d.exposureScore})`],
                  ['Active alerts', <span className={d.activeAlerts ? 'text-bad strong' : ''}>{d.activeAlerts}</span>],
                  ['Signature version', d.signatureVersion, true],
                  ['Engine version', d.engineVersion, true],
                  ['Last scan', relTime(d.lastScan)],
                  ['Machine ID', d.machineId, true],
                ]}
              />
            )}
          </Section>
        )}

        {a.aum && (
          <Section title="Azure Update Manager" badge={<SourceBadge type="aum" />}>
            <PatchRows p={a.aum} />
          </Section>
        )}
        {a.endpointCentral && (
          <Section title="ManageEngine Endpoint Central" badge={<SourceBadge type="endpointcentral" />}>
            <PatchRows p={a.endpointCentral} />
          </Section>
        )}
        {hasOs && !a.aum && !a.endpointCentral && a.patchStatus === 'No coverage' && (
          <Section title="Patching">
            <p><Pill v="No coverage" /> <span className="muted">No patch management source reports this asset.</span></p>
          </Section>
        )}

        <Section title="Raw record">
          <button className="link small" onClick={() => setShowRaw((v) => !v)}>{showRaw ? 'Hide' : 'Show'} JSON</button>
          {showRaw && <pre className="raw">{JSON.stringify(raw, null, 2)}</pre>}
        </Section>
      </div>
    </aside>
  );
}
