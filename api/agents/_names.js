// ═══════════════════════════════════════════════════════════════
// AGENT DISPLAY NAMES - the single rename surface (owner directive
// 2026-06-12: DBZ names are an IP liability on the sellworthy track;
// neutral placeholder callsigns until branding lands).
//
// DISPLAY LAYER ONLY. Internal slugs, endpoint paths, cron paths, and
// snapshot section keys (agentReports.daily.vegeta etc.) are load-bearing
// and STAY STABLE. Anything Mac (or a future tenant) reads renders
// through this map; renaming again later is a one-file edit.
//
// android18 is RETIRED from the roster (its RunPod duty died; PR #411).
// The slug keeps resolving so old data renders, labeled as retired.
// ═══════════════════════════════════════════════════════════════

export const AGENT_NAMES = {
  vegeta:    { displayName: 'Vantage',  role: 'Sales & Pipeline' },
  piccolo:   { displayName: 'Keystone', role: 'Operations & Crew' },
  krillin:   { displayName: 'Relay',    role: 'Comms & Marketing' },
  gohan:     { displayName: 'Beacon',   role: 'Game Dev & Product' },
  trunks:    { displayName: 'Bulwark',  role: 'Security & Infra' },
  bulma:     { displayName: 'Compass',  role: 'Intel & Analytics' },
  android18: { displayName: 'Creative seat (retired)', role: 'Creative & Media', retired: true },
};

// Collective label. Replaces "Z Fighters" everywhere Mac reads.
export const FLEET_DISPLAY = 'Agent Fleet';

// Legacy display labels still sitting in old snapshot data / agent_runs rows.
const LEGACY_LABELS = {
  'vegeta': 'vegeta', 'piccolo': 'piccolo', 'krillin': 'krillin',
  'gohan': 'gohan', 'trunks': 'trunks', 'bulma': 'bulma',
  'android 18': 'android18', 'android18': 'android18',
};

// Resolve a slug OR a legacy display label to the current display name.
// Unknown names pass through untouched so non-roster sources (Cashflow,
// Inbox, Production) keep their own labels.
export function agentDisplay(slugOrName) {
  const raw = String(slugOrName || '').trim();
  if (!raw) return raw;
  const slug = LEGACY_LABELS[raw.toLowerCase()] || raw.toLowerCase();
  return AGENT_NAMES[slug] ? AGENT_NAMES[slug].displayName : raw;
}
