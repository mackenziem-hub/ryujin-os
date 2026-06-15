/* Ryujin OS · Artifact Registry
 *
 * The fleet-wide source of truth for "what artifacts exist and when each last
 * changed", read by assets/unread-badge.js to decide which nav items / tiles /
 * index entries get the yellow "!" quest marker.
 *
 * When you ship or materially update an artifact, bump its updatedAt here (ISO
 * 8601). The badge shows on any element wired to that id whose updatedAt is newer
 * than the viewing operator's per-user lastSeenAt (see /api/artifact-seen).
 *
 * An artifact PAGE that declares its own freshness on <html data-artifact-id="x"
 * data-updated-at="..."> overrides this file for that id when the page is open, so
 * a self-describing artifact stays correct even if this list lags. This registry is
 * what lets NAV items light up without their target page being loaded.
 *
 * No build step, no deps. Loaded by auth-guard.js before unread-badge.js.
 */
window.RYUJIN_ARTIFACTS = [
  { id: 'ad-activity', label: 'Ad Activity',    href: '/ad-activity.html',    updatedAt: '2026-06-15T12:05:00Z' },
  { id: 'crm',         label: 'CRM Follow-up',  href: '/crm.html',            updatedAt: '2026-06-15T12:00:00Z' },
  { id: 'seo-scoreboard', label: 'SEO Scoreboard', href: '/seo-scoreboard.html', updatedAt: '2026-06-15T12:00:00Z' }
];
