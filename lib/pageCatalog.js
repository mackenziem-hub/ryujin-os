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

// A hash that is not part of an explicit catalog route is a hallucination
// signal (the model guessed admin.html#calendar instead of /calendar.html),
// even though the base page is real.
function hasUnknownHash(u) {
  const s = String(u || '');
  if (s.indexOf('#') === -1) return false;
  return !FULL_URLS.has(s.split('?')[0]);
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
  if (!opt || (opt.kind !== 'navigate_to' && opt.kind !== 'escalate_to_advanced')) return opt;
  const url = opt.payload && opt.payload.url;
  if (validateUrl(url) && !hasUnknownHash(url)) return opt;
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

// Render the navigate_to allow-list for the system prompt.
export function catalogForPrompt() {
  return PAGES
    .filter((p) => !p.advanced)
    .map((p) => `  ${p.url}${p.params ? ' (?' + p.params.join(', ?') + ')' : ''} - ${p.title}`)
    .join('\n');
}
