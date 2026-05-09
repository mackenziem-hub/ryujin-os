// ═══════════════════════════════════════════════════════════════
// META CONFIG AUDIT — Verify every active ad set is optimizing
// for the right conversion event.
//
// GET /api/meta-config-audit
//   → returns { totalAdSets, activeAdSets, flaggedCount, flagged[], adSets[] }
//
// Flags any active ad set on a lead/sales campaign that's optimizing for
// a low-intent goal (LANDING_PAGE_VIEWS, LINK_CLICKS, etc.) or has no
// conversion event set at all.
// ═══════════════════════════════════════════════════════════════

import { auditAdSetConfig, checkTokenHealth } from '../lib/meta.js';

export default async function handler(req, res) {
  const startTime = Date.now();
  try {
    const tokenHealth = await checkTokenHealth();
    if (!tokenHealth.valid) {
      return res.status(401).json({
        error: 'Meta token invalid',
        detail: tokenHealth.error,
        fix: 'Generate a new token in Meta Business Settings (System User preferred) and update META_ACCESS_TOKEN in Vercel'
      });
    }
    const audit = await auditAdSetConfig();
    res.json({
      ...audit,
      tokenHealth: {
        valid: tokenHealth.valid,
        expiresAt: tokenHealth.expiresAt,
        daysLeft: tokenHealth.daysLeft,
        expiryWarning: tokenHealth.expiryWarning
      },
      duration: `${Date.now() - startTime}ms`
    });
  } catch (e) {
    res.status(500).json({ error: e.message, duration: `${Date.now() - startTime}ms` });
  }
}
