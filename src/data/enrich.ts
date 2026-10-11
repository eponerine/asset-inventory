import type { Asset, ConnectorType, DnsMatch, RawAsset } from './types';

export interface EnrichmentFlags {
  defender: boolean;
  aum: boolean;
  endpointcentral: boolean;
}

const NO_DNS: DnsMatch[] = [];

/** Correlates enrichment data onto inventory records, honouring which enrichment connectors are enabled. */
export function enrich(raw: RawAsset[], en: EnrichmentFlags, dnsByAsset?: Map<string, DnsMatch[]>): Asset[] {
  return raw.map((r) => {
    const defender = en.defender ? r.defender : undefined;
    const aum = en.aum ? r.aum : undefined;
    const endpointCentral = en.endpointcentral ? r.endpointCentral : undefined;
    const dns = dnsByAsset?.get(r.id) ?? NO_DNS;
    const patch = aum ?? endpointCentral;
    const seenBy: ConnectorType[] = [r.source];
    if (defender?.onboarded) seenBy.push('defender');
    if (aum) seenBy.push('aum');
    if (endpointCentral) seenBy.push('endpointcentral');
    if (dns.length) seenBy.push('cloudflare');
    const hasOs = r.osFamily !== '';
    const isMobile = r.osFamily === 'iOS' || r.osFamily === 'Android';
    return {
      ...r,
      search: dns.length ? `${r.search} ${dns.map((d) => d.name).join(' ')}` : r.search,
      defender,
      aum,
      endpointCentral,
      dns,
      patch,
      seenBy,
      av: defender ? defender.avStatus : hasOs ? 'No coverage' : 'N/A',
      risk: defender?.onboarded ? defender.riskLevel : hasOs ? 'Unknown' : 'N/A',
      patchStatus: patch ? patch.status : hasOs && !isMobile ? 'No coverage' : 'N/A',
      missingCritical: patch ? patch.missingCritical : null,
    };
  });
}
