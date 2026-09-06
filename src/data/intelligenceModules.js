export const INTELLIGENCE_ACCESS_LEVELS = Object.freeze([
  'registered',
  'verified',
  'analyst',
  'owner',
]);

export const INTELLIGENCE_MODULES = Object.freeze([
  ['overview', 'Global Overview', 'Operations', 'registered', 'Cross-source operational summary and provider health.'],
  ['cctv-global', 'Global CCTV Network', 'Operations', 'registered', 'Viewport-loaded public camera catalogs, previews, and source health.'],
  ['live-news', 'Live News Network', 'Operations', 'registered', 'Geolocated broadcaster streams and source-linked reporting.'],
  ['conflicts', 'Conflict Monitor', 'Operations', 'registered', 'Source-linked conflict reporting with explicit verification state.'],
  ['frontlines', 'Frontline Monitor', 'Operations', 'verified', 'Third-party frontline geometry treated as unverified reporting.'],
  ['air-quality', 'Air Quality', 'Environment', 'registered', 'Open air-quality observations and station health.'],
  ['severe-weather', 'Severe Weather', 'Environment', 'registered', 'Live radar, warning polygons, and storm events on the operations globe.'],
  ['space-weather', 'Space Weather', 'Environment', 'registered', 'NOAA geomagnetic, solar flare, and alert telemetry.'],
  ['sentinel-imagery', 'Sentinel Imagery', 'Environment', 'verified', 'Public STAC scene discovery for an authorized area of interest.'],
  ['nuclear-infrastructure', 'Nuclear Infrastructure', 'Infrastructure', 'registered', 'Public facility records with source dates and nearby event context.'],
  ['arcgis-discovery', 'ArcGIS Discovery', 'Infrastructure', 'verified', 'Search public ArcGIS datasets without copying restricted layers.'],
  ['region-dossier', 'Region Dossier', 'Infrastructure', 'registered', 'Place, jurisdiction, public-knowledge, and event context.'],
  ['supply-chain', 'Supply Chain Risk', 'Infrastructure', 'verified', 'Supplier and logistics exposure correlated with public events.'],
  ['country-risk', 'Country Conditions', 'Infrastructure', 'registered', 'Transparent source-backed indicators; no opaque hard-coded risk score.'],
  ['internet-outages', 'Internet Outages', 'Cyber Defense', 'registered', 'Public IODA and configured Cloudflare Radar outage telemetry.'],
  ['cyber-threats', 'Cyber Threats', 'Cyber Defense', 'registered', 'CISA exploited-vulnerability intelligence and defensive threat feeds.'],
  ['malware-live', 'Malware Infrastructure', 'Cyber Defense', 'verified', 'URLhaus and attributed malicious-infrastructure observations.'],
  ['market-watch', 'Market Watch', 'Financial', 'registered', 'Reference market prices and historical context.'],
  ['chain-brief', 'Chain Threat Brief', 'Financial', 'verified', 'Public exploit, CVE, and sanctioned-wallet reporting.'],
  ['wallet-intel', 'Wallet Intelligence', 'Financial', 'verified', 'Public-chain address activity and sanctions screening.'],
  ['dns', 'DNS Records', 'Domain & Network', 'verified', 'Passive DNS record lookup.'],
  ['whois', 'RDAP / WHOIS', 'Domain & Network', 'verified', 'Registration and ownership records from RDAP.'],
  ['certificates', 'Certificate Transparency', 'Domain & Network', 'verified', 'Public certificate-transparency history.'],
  ['ip-intel', 'IP Intelligence', 'Domain & Network', 'verified', 'Public ASN, organization, geolocation, and hosting indicators.'],
  ['bgp', 'BGP Intelligence', 'Domain & Network', 'verified', 'Public prefix and autonomous-system context.'],
  ['mac', 'MAC Vendor', 'Domain & Network', 'verified', 'Hardware vendor lookup without probing a device.'],
  ['shodan', 'InternetDB Exposure', 'Domain & Network', 'analyst', 'Passive Shodan InternetDB observations for a specific IP.'],
  ['cve', 'CVE Intelligence', 'Domain & Network', 'registered', 'MITRE CVE details and remediation references.'],
  ['security-headers', 'Security Headers', 'Authorized Testing', 'analyst', 'HTTP security-header inspection of a verified asset.'],
  ['ssl', 'TLS Inspection', 'Authorized Testing', 'analyst', 'Certificate and protocol inspection of a verified asset.'],
  ['tech-detect', 'Technology Detection', 'Authorized Testing', 'analyst', 'Technology fingerprinting for a verified asset.'],
  ['subdomains', 'Subdomain Inventory', 'Authorized Testing', 'analyst', 'Attack-surface inventory for a verified domain.'],
  ['port-scan', 'Restricted Port Check', 'Authorized Testing', 'analyst', 'Bounded service check for a verified asset.'],
  ['vulnerability-scan', 'Vulnerability Assessment', 'Authorized Testing', 'analyst', 'Rate-limited assessment for a verified asset.'],
  ['ip-sweep', 'Network Exposure Review', 'Authorized Testing', 'owner', 'Owner-only bounded review of an explicitly verified network.'],
  ['username', 'Username Presence', 'Identity & Exposure', 'analyst', 'Case-bound public-account presence checks.'],
  ['github', 'GitHub Profile', 'Identity & Exposure', 'verified', 'Public GitHub profile and repository context.'],
  ['phone', 'Phone Metadata', 'Identity & Exposure', 'analyst', 'Case-bound carrier and numbering metadata.'],
  ['breaches', 'Personal Breach Check', 'Identity & Exposure', 'verified', 'Self-service exposure check for the signed-in email address.'],
  ['infostealer', 'Infostealer Exposure', 'Identity & Exposure', 'owner', 'Owner-approved exposure investigation with strict auditing.'],
  ['sanctions', 'Sanctions Screening', 'Identity & Exposure', 'analyst', 'Public sanctions dataset search with source attribution.'],
  ['aoi', 'Areas of Interest', 'Workspace', 'registered', 'Draw, save, share, and export geographic work areas.'],
  ['watchlists', 'Watchlists & Alerts', 'Workspace', 'registered', 'Saved entities and source-backed change alerts.'],
  ['saved-views', 'Saved Views', 'Workspace', 'registered', 'Shareable viewpoints, filters, and console layouts.'],
  ['style-studio', 'Style Studio', 'Workspace', 'registered', 'Personal visualization styles without altering source data.'],
  ['sdk-ingest', 'External Data Ingest', 'Integrations', 'analyst', 'Authenticated ingestion of organization-owned telemetry.'],
  ['webhooks', 'Verified Webhooks', 'Integrations', 'analyst', 'Signed outbound and inbound integration events.'],
  ['ai-analysis', 'AI Analyst', 'Intelligence', 'verified', 'Source-grounded overview, briefing, and entity analysis.'],
]);

export const INTELLIGENCE_MODULE_BY_ID = new Map(
  INTELLIGENCE_MODULES.map(([id, name, group, access, description]) => [id, {
    id, name, group, access, description,
  }]),
);

const ACCESS_RANK = Object.freeze({ registered: 0, verified: 1, analyst: 2, owner: 3 });

export function normalizeIntelligenceAccess(value) {
  return INTELLIGENCE_ACCESS_LEVELS.includes(value) ? value : 'registered';
}

export function intelligenceAccessAllows(actual, required) {
  return ACCESS_RANK[normalizeIntelligenceAccess(actual)] >= ACCESS_RANK[normalizeIntelligenceAccess(required)];
}
