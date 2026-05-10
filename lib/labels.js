// ═══════════════════════════════════════════════════════════════
// Ryujin OS — Per-tenant label resolution.
//
// White-label feel without a layout builder. Every UI label gets a
// canonical key (`<pillar>.<scope>.<id>`); operators can rename via
// PATCH /api/settings { label_overrides: { <key>: <new> } } in
// advanced mode. The page reads through getLabel() with the tenant's
// settings + a sane fallback.
//
// Server-side usage:
//   import { getLabel } from './labels.js';
//   const label = getLabel(tenantSettings, 'sales.kpi.pipeline_value', 'Pipeline Value');
//
// Client-side: see public/assets/labels-client.js (mirror of this).
// ═══════════════════════════════════════════════════════════════

const KEY_PATTERN = /^[a-z][a-z0-9_]*\.[a-z][a-z0-9_]*\.[a-z][a-z0-9_]*$/;

export function isValidLabelKey(key) {
  return typeof key === 'string' && KEY_PATTERN.test(key);
}

export function getLabel(tenantSettings, key, fallback) {
  if (!isValidLabelKey(key)) return fallback ?? key;
  const overrides = tenantSettings?.label_overrides;
  if (overrides && Object.prototype.hasOwnProperty.call(overrides, key)) {
    const v = overrides[key];
    if (typeof v === 'string' && v.length > 0) return v;
  }
  return fallback ?? key;
}

// Bulk applier — useful when a server endpoint needs to render
// many labels for an inline-rendered HTML response.
export function applyLabels(tenantSettings, defaults) {
  const out = {};
  for (const [key, fallback] of Object.entries(defaults)) {
    out[key] = getLabel(tenantSettings, key, fallback);
  }
  return out;
}

// Validate a label_overrides patch before persisting (used by /api/settings).
// Rejects keys that don't match the namespace and values longer than 80 chars.
export function validateOverridesPatch(patch) {
  if (!patch || typeof patch !== 'object') return { ok: false, error: 'patch must be an object' };
  for (const [k, v] of Object.entries(patch)) {
    if (!isValidLabelKey(k)) return { ok: false, error: `invalid label key: ${k}` };
    if (v !== null && (typeof v !== 'string' || v.length > 80)) {
      return { ok: false, error: `value for ${k} must be a string ≤ 80 chars or null to clear` };
    }
  }
  return { ok: true };
}
