// ═══════════════════════════════════════════════════════════════
// Ryujin page catalog — the single source of truth for the real pages
// the AI is allowed to navigate the operator to.
//
// Why this exists: navigate_to used to be a free-form { url } the model
// invented, so it shipped guesses like "admin.html#calendar" (a route
// that does not exist) straight into window.location.href. The prompt
// now lists ONLY these real pages (catalogForPrompt), and the server
// fail-closes every nav action through sanitizeNavAction so a bad URL
// can never reach the browser.
//
// Keep this list curated (operator destinations), not every one of the
// ~157 public/*.html files. Add a page here when the AI should be able
// to open it.
// ═══════════════════════════════════════════════════════════════

// id: stable key. url: the real path under public/. title: shown to the model.
// keywords: lowercase phrases used to repair a mislabeled nav (resolveByText).
// params: query params the page understands (informational for the prompt).
// advanced: true => valid for escalate_to_advanced but hidden from the
//           navigate_to list to keep that prompt section focused.
export const PAGES = [
  { id: 'cockpit', url: '/cockpit.html', title: 'Cockpit (operator home base)', keywords: ['home', 'cockpit', 'start', 'summon', 'main'] },
  { id: 'command-center', url: '/command-center.html', title: 'HQ Command Center', keywords: ['hq', 'command center', 'headquarters'] },
  { id: 'shell', url: '/shell.html', title: 'Ryujin (AI shell, ask anything)', keywords: ['shell', 'ryujin', 'ask', 'ai', 'ambient', 'assistant', 'chat'] },
  { id: 'dashboard', url: '/dashboard-v2.html', title: 'HQ Dashboard', keywords: ['dashboard'] },
  { id: 'admin', url: '/admin.html', title: 'Admin and Settings', keywords: ['admin', 'settings', 'configuration'] },
  { id: 'calendar', url: '/calendar.html', title: 'Service Calendar (installs, inspections, service calls, GHL bookings) - this IS "the calendar"', keywords: ['calendar', 'service calendar', 'schedule', 'bookings', 'booking', 'appointment', 'appointments'] },
  { id: 'production-calendar', url: '/production-calendar.html', title: 'Install / production schedule', keywords: ['production calendar', 'install schedule', 'install calendar'] },
  { id: 'production-schedule', url: '/production-schedule.html', title: 'Production schedule board', keywords: ['production schedule', 'crew schedule'] },
  { id: 'jobs', url: '/production-jobs.html', title: 'Jobs and Work Orders board', keywords: ['jobs', 'job board', 'work orders', 'workorders'] },
  { id: 'job', url: '/job.html', title: 'Job folder (one job)', params: ['wo', 'share', 'id', 'project_id'], keywords: ['job', 'job folder', 'job page'] },
  { id: 'workorders', url: '/production-workorders.html', title: 'Work order editor', params: ['wo'], keywords: ['work order', 'workorder', 'wo editor'] },
  { id: 'materials', url: '/production-materials.html', title: 'Material lists (purchase-ready)', keywords: ['materials', 'material list', 'purchase list', 'order list'] },
  { id: 'production-paysheet', url: '/production-paysheet.html', title: 'Sub paysheet (one job)', params: ['id', 'job'], keywords: ['paysheet', 'sub pay', 'subcontractor pay', 'pay sheet'] },
  { id: 'paysheet', url: '/paysheet.html', title: 'Paysheets', keywords: ['paysheets'] },
  { id: 'production', url: '/production.html', title: 'Production hub', keywords: ['production', 'production hub'] },
  { id: 'customers', url: '/customer-list.html', title: 'Customer list', keywords: ['customers', 'customer list', 'clients'] },
  { id: 'crm', url: '/crm.html', title: 'CRM follow-up engine (top-20 follow-up, warm leads, proposal activity)', keywords: ['crm', 'follow up', 'follow-up', 'top 20', 'top 50', 'warm leads', 'proposal activity', 'chase', 're-engage'] },
  { id: 'customer', url: '/customer-profile.html', title: 'Customer profile (one customer)', params: ['id'], keywords: ['customer profile', 'customer', 'client profile'] },
  { id: 'sales-customers', url: '/sales-customers.html', title: 'Sales customers', keywords: ['sales customers'] },
  { id: 'quests', url: '/admin-quests.html', title: 'Task board (quests)', keywords: ['tasks', 'task board', 'quests', 'to-do', 'todo', 'to do'] },
  { id: 'overview', url: '/admin-overview.html', title: 'Per-person overview and tasks', params: ['user_id'], keywords: ['my board', 'overview', 'my tasks', 'my day'] },
  { id: 'sales', url: '/sales.html', title: 'Sales hub', keywords: ['sales', 'sales hub'] },
  { id: 'sales-pipeline', url: '/sales-pipeline.html', title: 'Sales pipeline', keywords: ['pipeline', 'sales pipeline', 'deals'] },
  { id: 'proposals', url: '/sales-proposals.html', title: 'Proposals', keywords: ['proposals', 'proposal list', 'quotes sent'] },
  { id: 'estimates', url: '/admin.html#estimates', title: 'Estimates', keywords: ['estimates', 'estimate', 'quotes'] },
  { id: 'marketing', url: '/marketing.html', title: 'Marketing hub', keywords: ['marketing', 'marketing hub'] },
  { id: 'marketing-leads', url: '/marketing-leads.html', title: 'Marketing leads', keywords: ['leads', 'marketing leads'] },
  { id: 'ad-activity', url: '/ad-activity.html', title: 'Ad activity report (Meta spend, leads, CPL, 7d + 24h)', keywords: ['ads', 'ad activity', 'ad report', 'meta ads', 'facebook ads', 'spend', 'cpl', 'campaigns'] },
  { id: 'seo-scoreboard', url: '/seo-scoreboard.html', title: 'SEO scoreboard (rankings, GBP, content, action queue)', keywords: ['seo', 'scoreboard', 'rankings', 'gbp', 'google business', 'backlinks', 'search'] },
  { id: 'finance', url: '/finance.html', title: 'Finance hub', keywords: ['finance', 'finance hub', 'money'] },
  { id: 'receivables', url: '/finance-receivables.html', title: 'Receivables (money owed to us)', keywords: ['receivables', 'accounts receivable', 'ar', 'owed', 'outstanding'] },
  { id: 'payments', url: '/finance-payments.html', title: 'Payments', keywords: ['payments', 'paid'] },
  { id: 'service', url: '/service.html', title: 'Service hub', keywords: ['service', 'service hub'] },
  { id: 'service-tickets', url: '/service-tickets.html', title: 'Service tickets', keywords: ['tickets', 'service tickets', 'callbacks'] },
  { id: 'inbox', url: '/inbox.html', title: 'Inbox', keywords: ['inbox', 'email', 'emails'] },
  { id: 'messages', url: '/messages.html', title: 'Team messages', keywords: ['messages', 'team chat', 'dm'] },
  { id: 'approvals', url: '/approvals.html', title: 'Approvals queue', keywords: ['approvals', 'approve', 'pending approval'] },
  { id: 'pipeline-board', url: '/admin-pipeline.html', title: 'Production pipeline (job stage suggestions)', keywords: ['pipeline board', 'stages', 'stage suggestions'] },
  { id: 'cron-health', url: '/admin-cron-health.html', title: 'Agent and cron health', keywords: ['cron', 'agent health', 'agents status'] },
  { id: 'agent-ops', url: '/agent-ops.html', title: 'Agent ops health board', keywords: ['agent ops', 'agent health board', 'z fighters', 'agent freshness', 'cron agents'] },
  { id: 'team', url: '/admin-team.html', title: 'Team and Access (add crew logins)', keywords: ['team', 'crew access', 'add crew', 'logins'] },
  { id: 'pricing', url: '/admin-pricing.html', title: 'Pricing settings', keywords: ['pricing settings', 'rates', 'multipliers'] },
  { id: 'generator', url: '/generator.html', title: 'Content generator', keywords: ['generator', 'content generator', 'create content'] },
  { id: 'decks', url: '/decks.html', title: 'Decks', keywords: ['decks', 'slides', 'presentations'] },
  { id: 'instant-estimator', url: '/instant-estimator.html', title: 'Instant Estimator', keywords: ['instant estimator', 'estimator', 'self quote'] },
  // Advanced-mode targets (valid for escalate_to_advanced; hidden from the navigate list).
  { id: 'admin-advanced', url: '/admin-advanced.html', title: 'Admin (advanced)', advanced: true, keywords: ['admin advanced'] },
  { id: 'sales-advanced', url: '/sales-advanced.html', title: 'Sales (advanced)', advanced: true, keywords: ['sales advanced'] },
  { id: 'marketing-advanced', url: '/marketing-advanced.html', title: 'Marketing (advanced)', advanced: true, keywords: ['marketing advanced'] },
  { id: 'finance-advanced', url: '/finance-advanced.html', title: 'Finance (advanced)', advanced: true, keywords: ['finance advanced'] },
  { id: 'production-advanced', url: '/production-advanced.html', title: 'Production (advanced)', advanced: true, keywords: ['production advanced'] },
  { id: 'service-advanced', url: '/service-advanced.html', title: 'Service (advanced)', advanced: true, keywords: ['service advanced'] },
  { id: 'customer-advanced', url: '/customer-advanced.html', title: 'Customer (advanced)', advanced: true, keywords: ['customer advanced'] },
];

// Set of valid pathnames (ignores query + hash). Built once at module load.
const PATHS = new Set(PAGES.map((p) => p.url.split('#')[0].split('?')[0]));
// Full path#hash forms, so an explicit hashed route (e.g. /admin.html#estimates)
// is allowed while a guessed hash on a real page (admin.html#calendar) is not.
const FULL_URLS = new Set(PAGES.map((p) => p.url.split('?')[0]));

// Resolve a nav target to a SAFE, catalog-relative url string, or null if it is
// not a real catalog destination. Strips any origin (so an absolute off-site URL
// whose path happens to match can never send the operator off-site) and rejects
// a guessed #hash on a real page (admin.html#calendar) unless the exact path#hash
// is an explicit catalog route (/admin.html#estimates). Parses the hash from the
// full string so a query before the hash cannot hide it.
function safeNavUrl(u) {
  const s = String(u || '').trim();
  if (!s) return null;
  let path = '', query = '', hash = '';
  try {
    if (/^https?:\/\//i.test(s)) {
      const parsed = new URL(s);
      path = parsed.pathname; query = parsed.search; hash = parsed.hash;
    } else {
      const hi = s.indexOf('#');
      hash = hi >= 0 ? s.slice(hi) : '';
      const rest = hi >= 0 ? s.slice(0, hi) : s;
      const qi = rest.indexOf('?');
      query = qi >= 0 ? rest.slice(qi) : '';
      path = qi >= 0 ? rest.slice(0, qi) : rest;
    }
  } catch (e) { return null; }
  if (path && path.charAt(0) !== '/') path = '/' + path;
  if (!PATHS.has(path)) return null;                      // unknown page
  if (hash && !FULL_URLS.has(path + hash)) return null;   // guessed hash on a real page
  return path + query + hash;                             // normalized, same-origin relative
}

// Normalize any nav target to a leading-slash pathname (drop origin/query/hash).
function normPath(u) {
  try {
    let s = String(u || '').trim();
    if (!s) return '';
    if (/^https?:\/\//i.test(s)) s = new URL(s).pathname;
    s = s.split('#')[0].split('?')[0];
    if (!s) return '';
    if (s.charAt(0) !== '/') s = '/' + s;
    return s;
  } catch (e) { return ''; }
}

// True only if the url's pathname is a real catalog page. Query + hash are allowed.
export function validateUrl(u) {
  const p = normPath(u);
  return !!p && PATHS.has(p);
}

// Resolve a page url from free text (a button label/why) by keyword hit count.
// Used to repair a mislabeled nav before falling back to cockpit.
export function resolveByText(text) {
  const t = String(text || '').toLowerCase();
  if (!t) return null;
  let best = null, bestScore = 0;
  for (const p of PAGES) {
    if (p.advanced) continue;
    let score = 0;
    for (const k of (p.keywords || [])) { if (t.indexOf(k) !== -1) score += k.length; }
    if (score > bestScore) { bestScore = score; best = p; }
  }
  return best ? best.url : null;
}

// Fail-closed sanitizer for a single AI option/action. For navigate_to and
// escalate_to_advanced, guarantee payload.url is a real page: keep it if valid,
// else repair from the label text, else fall back to /cockpit.html. Never lets a
// hallucinated path reach the browser; never drops the button.
export function sanitizeNavAction(opt) {
  if (!opt) return opt;
  // Deep-link kinds resolve to a concrete catalog url, then ride the normal
  // navigate_to path the clients already handle. Fail-closed: an unresolvable
  // deep-link becomes a noop rather than a broken/guessed nav.
  if (DEEP_LINK_KINDS.has(opt.kind)) {
    const url = resolveDeepLink(opt.kind, opt.payload);
    if (url) return Object.assign({}, opt, { kind: 'navigate_to', payload: Object.assign({}, opt.payload || {}, { url }) });
    return Object.assign({}, opt, { kind: 'noop', payload: {} });
  }
  if (opt.kind !== 'navigate_to' && opt.kind !== 'escalate_to_advanced') return opt;
  const url = opt.payload && opt.payload.url;
  const safe = safeNavUrl(url);
  if (safe) {
    if (safe === url) return opt;                    // already clean + relative
    // valid page that needed normalizing (e.g. absolute -> relative): rewrite quietly
    return Object.assign({}, opt, { payload: Object.assign({}, opt.payload || {}, { url: safe }) });
  }
  const repaired = resolveByText((opt.label || '') + ' ' + (opt.why || '')) || '/cockpit.html';
  return Object.assign({}, opt, {
    payload: Object.assign({}, opt.payload || {}, {
      url: repaired,
      nav_corrected: true,
      nav_original: url || null,
    }),
  });
}

// Map a whole options/actions array through the sanitizer.
export function sanitizeNavActions(arr) {
  return Array.isArray(arr) ? arr.map(sanitizeNavAction) : arr;
}

// Resolve a navigate-tool target to a SAFE catalog url, or null when it can't be
// matched (the caller fails closed — never navigates to a guessed page). Tries
// the exact url first (origin-stripped, hash-guarded), then repairs from free
// text (the model's reason/label) via keyword match.
export function resolveNavUrl(url, text) {
  return safeNavUrl(url) || resolveByText(text || '') || null;
}

// Deep-link action kinds — open a SPECIFIC record, not just a page. The model
// emits these with a small payload (a wo number) sourced from the observations;
// sanitizeNavAction resolves them to a concrete catalog url.
// (open_calendar_date is intentionally NOT here yet: calendar.html builds its
// window from today and has no ?date anchor, so a dated link would silently land
// on the current week. Add it once the calendar honors a query date.)
export const DEEP_LINK_KINDS = new Set(['open_job', 'open_workorder']);

// Classify a WO reference. Strips the "WO #" / "WO-" / "WO " prefix operators
// use, then accepts EITHER the visible wo_number (digits, what the observations
// show) OR a workorder UUID (what current_page can surface from an internal
// /job.html?wo=<uuid> link). Returns { num } | { id } | null. null fails closed:
// junk, spaces, and injection attempts all reject.
function classifyWo(raw) {
  const s = String(raw ?? '').trim().replace(/^wo\s*[#-]?\s*/i, '').trim();
  if (/^\d{1,8}$/.test(s)) return { num: s };
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s)) return { id: s };
  return null;
}

// Resolve a deep-link kind + payload to a SAFE catalog url, or null (caller
// fails closed). Routes each WO form to the key the target page understands:
// job.html ?wo opens both a wo_number and a UUID; production-workorders.html
// opens ?wo=<wo_number> or ?id=<uuid>.
export function resolveDeepLink(kind, params) {
  const p = params || {};
  if (kind === 'open_job') {
    const w = classifyWo(p.wo ?? p.wo_number ?? p.id);
    return w ? `/job.html?wo=${encodeURIComponent(w.num || w.id)}` : null;
  }
  if (kind === 'open_workorder') {
    const w = classifyWo(p.wo ?? p.wo_number ?? p.id);
    if (!w) return null;
    return w.num
      ? `/production-workorders.html?wo=${encodeURIComponent(w.num)}`
      : `/production-workorders.html?id=${encodeURIComponent(w.id)}`;
  }
  return null;
}

// pathname -> catalog page, for current-page lookups. First entry wins so the
// canonical page (e.g. /admin.html "Admin") beats a hashed alias
// (/admin.html#estimates) that shares the pathname.
const BY_PATH = (() => {
  const m = new Map();
  for (const p of PAGES) {
    const key = p.url.split('#')[0].split('?')[0];
    if (!m.has(key)) m.set(key, p);
  }
  return m;
})();

// Catalogued hash routes (e.g. /admin.html#estimates) keyed by path#hash, so a
// hash-backed page resolves to its OWN title instead of the bare-pathname entry
// (which would otherwise mislabel "Estimates" as "Admin").
const BY_FULL = (() => {
  const m = new Map();
  for (const p of PAGES) {
    if (p.url.indexOf('#') !== -1) m.set(p.url.split('?')[0], p);
  }
  return m;
})();

// Query params that name a record, in priority order (check wo before id).
// share is intentionally omitted — it is a capability token, not an entity.
const ENTITY_PARAMS = [
  ['wo', 'work order'],
  ['project_id', 'job'],
  ['estimate_id', 'estimate'],
  ['customer_id', 'customer'],
  ['user_id', 'person'],
  ['id', 'record'],
];

// Entity IDs are wo numbers, uuids, or short slugs. Only inject a value that
// matches this safe charset + length cap. A crafted query value
// (e.g. ?wo=%0AIgnore+previous+instructions) decodes to text with newlines /
// spaces / punctuation and is REJECTED, closing the prompt-injection path —
// the pathname allow-list does not protect the entity value, so this must.
const SAFE_ENTITY_ID = /^[A-Za-z0-9_-]{1,64}$/;

// Build a one-line "the operator is currently on X" sentence from a
// client-reported { path } (pathname[+?query]). FAIL-CLOSED: returns '' unless
// the pathname is a real catalog page, so a spoofed/garbage path can never
// inject misleading location context into a system prompt. The page title comes
// from the curated catalog (not the client) and the entity is parsed from the
// real query params, so the only client-trusted input is the pathname itself
// (which is validated against the allow-list).
export function describeCurrentPage(cp) {
  if (!cp || typeof cp !== 'object') return '';
  const rawPath = String(cp.path || '').trim();
  if (!rawPath) return '';
  // Split off hash first, then query (URL order is path?query#hash).
  const hi = rawPath.indexOf('#');
  const hash = hi >= 0 ? rawPath.slice(hi) : '';
  const beforeHash = hi >= 0 ? rawPath.slice(0, hi) : rawPath;
  const qi = beforeHash.indexOf('?');
  const search = qi >= 0 ? beforeHash.slice(qi) : '';
  let pathname = qi >= 0 ? beforeHash.slice(0, qi) : beforeHash;
  if (pathname.charAt(0) !== '/') pathname = '/' + pathname;
  // Prefer an explicit catalogued hash route (e.g. /admin.html#estimates),
  // else fall back to the bare-pathname page.
  const hashPage = hash ? BY_FULL.get(pathname + hash) : null;
  const page = hashPage || BY_PATH.get(pathname);
  if (!page) return '';
  const displayPath = hashPage ? pathname + hash : pathname;
  let entity = '';
  if (search) {
    try {
      const params = new URLSearchParams(search);
      for (const [key, label] of ENTITY_PARAMS) {
        if (!params.has(key)) continue;
        const v = params.get(key);
        // First present entity param decides; if its value fails the safe
        // pattern (injection attempt / junk), inject no entity rather than
        // falling through to a lower-priority param the attacker doesn't own.
        if (v && SAFE_ENTITY_ID.test(v)) entity = `, viewing ${label} ${v}`;
        break;
      }
    } catch { /* malformed query — skip entity */ }
  }
  return `The operator is currently on ${displayPath} (${page.title})${entity}.`;
}

// Render the navigate_to allow-list for the system prompt.
export function catalogForPrompt() {
  return PAGES
    .filter((p) => !p.advanced)
    .map((p) => `  ${p.url}${p.params ? ' (?' + p.params.join(', ?') + ')' : ''} - ${p.title}`)
    .join('\n');
}
