import { useState } from 'react';
import { CONNECTOR_META, ENRICHMENT_TYPES, INVENTORY_TYPES, MAX_SIMULATED, RESOURCE_TYPES, defaultResourceTypes, type ResourceTypeDef } from '../data/connectors';
import type { Connector, ConnectorType } from '../data/types';
import { fmtNum, relTime } from '../lib/format';
import { Modal, Pill, SourceBadge, Switch } from './ui';

interface Props {
  connectors: Connector[];
  counts: Map<string, number>;
  dynamicStatus: Map<string, Partial<Connector>>;
  syncing: Set<string>;
  onUpdate: (c: Connector) => void;
  onAdd: (c: Connector) => void;
  onDelete: (id: string) => void;
  onSync: (id: string) => void;
  onReset: () => void;
}

const PLANNED = ['Microsoft Entra ID', 'VMware vSphere', 'Azure Arc', 'CrowdStrike Falcon', 'Qualys VMDR', 'Tenable', 'Jamf Pro', 'ServiceNow CMDB', 'Okta'];

export function ConnectorsView({ connectors, counts, dynamicStatus, syncing, onUpdate, onAdd, onDelete, onSync, onReset }: Props) {
  const [editing, setEditing] = useState<{ c: Connector; isNew: boolean } | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<Connector | null>(null);
  const [statusFor, setStatusFor] = useState<Connector | null>(null);

  const newConnector = (): Connector => ({
    id: `c-${Date.now().toString(36)}`,
    type: 'azure',
    name: '',
    enabled: true,
    status: 'healthy',
    lastSync: Date.now(),
    simulatedCount: CONNECTOR_META.azure.defaultCount,
    seed: Math.floor(Math.random() * 1e9),
    config: {},
  });

  const group = (types: ConnectorType[]) => connectors.filter((c) => types.includes(c.type));

  const card = (c: Connector) => {
    const m = CONNECTOR_META[c.type];
    const shown = { ...c, ...dynamicStatus.get(c.id) };
    const isSyncing = syncing.has(c.id);
    const count = m.category === 'inventory' ? (c.enabled ? counts.get(c.id) ?? 0 : c.simulatedCount) : counts.get(c.type) ?? 0;
    return (
      <div key={c.id} className={`conn-card${c.enabled ? '' : ' disabled'}`}>
        <div className="conn-head">
          <span className="conn-logo" style={{ background: m.color }}>{m.short}</span>
          <div className="conn-title">
            <div className="strong">{c.name}</div>
            <div className="muted small">{m.label}</div>
          </div>
          <Switch on={c.enabled} label={`Enable ${c.name}`} onChange={(enabled) => onUpdate({ ...c, enabled })} />
        </div>
        <div className="conn-stats">
          <div>
            <span className="muted small">{m.category === 'inventory' ? 'Assets' : 'Assets enriched'}</span>
            <b>{fmtNum(count)}</b>
          </div>
          <div>
            <span className="muted small">Last sync</span>
            <b>{isSyncing ? 'Syncing…' : relTime(c.lastSync)}</b>
          </div>
          <div>
            <span className="muted small">Status</span>
            {!c.enabled ? <Pill v="Disabled" />
              : isSyncing ? <span className="pill muted">Syncing</span>
              : shown.statusMessage ? (
                <button className="pill-btn" onClick={() => setStatusFor(shown)} title="View details">
                  <Pill v={shown.status} /> <span className="pill-info">ⓘ</span>
                </button>
              ) : <Pill v={shown.status} />}
          </div>
        </div>
        {isSyncing && <div className="progress"><i /></div>}
        <div className="conn-actions">
          <button className="btn" disabled={!c.enabled || isSyncing} onClick={() => onSync(c.id)}>Sync now</button>
          <button className="btn" onClick={() => setEditing({ c, isNew: false })}>Configure</button>
          <button className="btn ghost danger" onClick={() => setConfirmDelete(c)}>Remove</button>
        </div>
      </div>
    );
  };

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>Connectors</h1>
          <p className="muted">Inventory sources create asset records; enrichment sources correlate onto them to add security & patching context.</p>
        </div>
        <div className="row-gap">
          <button className="btn ghost" onClick={onReset}>Reset to demo defaults</button>
          <button className="btn primary" onClick={() => setEditing({ c: newConnector(), isNew: true })}>+ Add connector</button>
        </div>
      </div>

      <h2 className="section-title">Inventory sources</h2>
      <div className="conn-grid">{group(INVENTORY_TYPES).map(card)}</div>

      <h2 className="section-title">Enrichment sources – security, patching & DNS</h2>
      <div className="conn-grid">{group(ENRICHMENT_TYPES).map(card)}</div>

      <h2 className="section-title">Planned</h2>
      <div className="planned">
        {PLANNED.map((p) => <span key={p} className="planned-item">{p}</span>)}
      </div>

      {editing && (
        <ConnectorEditor
          initial={editing.c}
          isNew={editing.isNew}
          onCancel={() => setEditing(null)}
          onSave={(c) => {
            if (editing.isNew) onAdd(c);
            else onUpdate(c);
            setEditing(null);
          }}
        />
      )}

      {statusFor && (
        <Modal title={`Connector status – ${statusFor.name}`} onClose={() => setStatusFor(null)}>
          <div className="status-head">
            <Pill v={statusFor.status} />
            <span className="muted small">Last sync {relTime(statusFor.lastSync)}</span>
          </div>
          <div className={`conn-msg ${statusFor.status}`}>{statusFor.statusMessage}</div>
          {statusFor.statusDetails?.length ? (
            <div>
              <div className="muted small status-label">Details ({statusFor.statusDetails.length})</div>
              <ul className="status-list mono">
                {statusFor.statusDetails.map((d) => <li key={d}>{d}</li>)}
              </ul>
            </div>
          ) : null}
          {statusFor.statusRemediation && (
            <div>
              <div className="muted small status-label">Suggested fix</div>
              <p>{statusFor.statusRemediation}</p>
            </div>
          )}
          <div className="modal-foot">
            <button className="btn ghost" onClick={() => { setEditing({ c: connectors.find((x) => x.id === statusFor.id) ?? statusFor, isNew: false }); setStatusFor(null); }}>Configure</button>
            <button className="btn primary" onClick={() => { onSync(statusFor.id); setStatusFor(null); }}>Sync now</button>
          </div>
        </Modal>
      )}

      {confirmDelete && (
        <Modal title="Remove connector" onClose={() => setConfirmDelete(null)}>
          <p>Remove <b>{confirmDelete.name}</b>? Its assets will disappear from the inventory.</p>
          <div className="modal-foot">
            <button className="btn ghost" onClick={() => setConfirmDelete(null)}>Cancel</button>
            <button className="btn danger" onClick={() => { onDelete(confirmDelete.id); setConfirmDelete(null); }}>Remove</button>
          </div>
        </Modal>
      )}
    </div>
  );
}

function ResourceTypePicker({ types, selected, onChange }: { types: ResourceTypeDef[]; selected: string[]; onChange: (keys: string[]) => void }) {
  const groups = [...new Set(types.map((t) => t.group))];
  const toggle = (key: string) => onChange(selected.includes(key) ? selected.filter((k) => k !== key) : [...selected, key]);
  const setGroup = (group: string, on: boolean) => {
    const keys = types.filter((t) => t.group === group).map((t) => t.key);
    onChange(on ? [...new Set([...selected, ...keys])] : selected.filter((k) => !keys.includes(k)));
  };
  return (
    <div className="rt-groups">
      {groups.map((g) => {
        const items = types.filter((t) => t.group === g);
        const allOn = items.every((t) => selected.includes(t.key));
        return (
          <div key={g} className="rt-group">
            <div className="rt-group-head">
              <span>{g}</span>
              <button type="button" className="link small" onClick={() => setGroup(g, !allOn)}>{allOn ? 'None' : 'All'}</button>
            </div>
            {items.map((t) => (
              <label key={t.key} className="check-row">
                <input type="checkbox" checked={selected.includes(t.key)} onChange={() => toggle(t.key)} />
                <span>{t.label}</span>
                {!t.simulated && <span className="rt-nodata" title="The POC generator has no sample data for this type yet">no sample data</span>}
              </label>
            ))}
          </div>
        );
      })}
    </div>
  );
}

function ConnectorEditor({ initial, isNew, onSave, onCancel }: { initial: Connector; isNew: boolean; onSave: (c: Connector) => void; onCancel: () => void }) {
  const [type, setType] = useState<ConnectorType>(initial.type);
  const [name, setName] = useState(initial.name);
  const [count, setCount] = useState(initial.simulatedCount);
  const [config, setConfig] = useState<Record<string, string>>(initial.config);
  const [resourceTypes, setResourceTypes] = useState<string[]>(initial.resourceTypes ?? defaultResourceTypes(initial.type));
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const meta = CONNECTOR_META[type];
  const rtDefs = RESOURCE_TYPES[type];

  const pickType = (t: ConnectorType) => {
    setType(t);
    setCount(CONNECTOR_META[t].defaultCount);
    setConfig({});
    setResourceTypes(defaultResourceTypes(t));
  };

  const save = () =>
    onSave({
      ...initial,
      type,
      name: name.trim(),
      config,
      resourceTypes: rtDefs ? resourceTypes : undefined,
      simulatedCount: meta.category === 'inventory' ? Math.max(0, Math.min(MAX_SIMULATED, Math.floor(count) || 0)) : 0,
    });

  return (
    <Modal title={isNew ? 'Add connector' : `Configure – ${initial.name}`} onClose={onCancel} wide={isNew}>
      {isNew && (
        <div className="type-grid">
          {[...INVENTORY_TYPES, ...ENRICHMENT_TYPES].map((t) => (
            <button key={t} className={`type-card${t === type ? ' on' : ''}`} onClick={() => pickType(t)}>
              <SourceBadge type={t} />
              <span>{CONNECTOR_META[t].label}</span>
              <span className="muted tiny-text">{CONNECTOR_META[t].category}</span>
            </button>
          ))}
        </div>
      )}
      <label className="field">
        <span>Display name</span>
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder={`e.g. Contoso – ${meta.labelShort}`} maxLength={80} autoFocus />
      </label>
      {meta.fields.map((f) => (
        <label key={f.key} className="field">
          <span>{f.label}</span>
          <input
            type={f.secret ? 'password' : 'text'}
            autoComplete="off"
            placeholder={f.secret ? '•••••••• (not persisted in POC)' : f.placeholder}
            value={config[f.key] ?? ''}
            onChange={(e) => setConfig((c) => ({ ...c, [f.key]: e.target.value }))}
          />
        </label>
      ))}
      {meta.category === 'inventory' && (
        <label className="field">
          <span>Simulated asset count <span className="muted">(POC only)</span></span>
          <input type="number" min={0} max={MAX_SIMULATED} step={500} value={count} onChange={(e) => setCount(Number(e.target.value))} />
        </label>
      )}
      {rtDefs && (
        <div className="advanced">
          <button type="button" className="advanced-toggle" aria-expanded={advancedOpen} onClick={() => setAdvancedOpen((o) => !o)}>
            <span>{advancedOpen ? '▾' : '▸'} Advanced – resource types to inventory</span>
            <span className="muted small">{resourceTypes.length} of {rtDefs.length} selected</span>
          </button>
          {advancedOpen && <ResourceTypePicker types={rtDefs} selected={resourceTypes} onChange={setResourceTypes} />}
        </div>
      )}
      <div className="notice">POC: no outbound calls are made and secrets are never written to storage. Assets are generated locally from a seeded random generator.</div>
      <div className="modal-foot">
        <button className="btn ghost" onClick={onCancel}>Cancel</button>
        <button className="btn primary" disabled={!name.trim()} onClick={save}>{isNew ? 'Add connector' : 'Save'}</button>
      </div>
    </Modal>
  );
}
