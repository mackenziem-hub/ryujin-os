// public/assets/claim-resolver.js
// Client-side resolver for the claims library (lib/claims.js + /api/claims).
//
// Usage in any HTML template:
//   1. Include this script: <script src="/assets/claim-resolver.js" defer></script>
//   2. Set window.RYUJIN_TENANT_ID before this script loads (or rely on default).
//   3. Mark spans/elements: <span data-claim="gl_2m_liability,licensed_and_operating_nb"></span>
//      The resolver fetches active claims, finds the FIRST matching key in priority
//      order (left → right), and substitutes its `copy` value.
//   4. If NONE of the listed keys are active, the element renders empty (graceful
//      degradation — never falls back to inaccurate hardcoded copy).
//
// Pattern B from docs/integration_proposal_client_claims.md. No template-engine
// changes required — drop the script tag in, mark the elements.

(function () {
  'use strict';

  const DEFAULT_TENANT_ID = '84c91cb9-df07-4424-8938-075e9c50cb3b'; // plus-ultra
  const CACHE_KEY = 'ryujin_claims_cache_v1';
  const CACHE_TTL_MS = 60_000;

  function getTenantId() {
    return (window.RYUJIN_TENANT_ID || DEFAULT_TENANT_ID).toString();
  }

  function readCache(tenantId) {
    try {
      const raw = sessionStorage.getItem(CACHE_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      if (parsed.tenant_id !== tenantId) return null;
      if (Date.now() - parsed.fetched_at > CACHE_TTL_MS) return null;
      return parsed.claims;
    } catch { return null; }
  }

  function writeCache(tenantId, claims) {
    try {
      sessionStorage.setItem(CACHE_KEY, JSON.stringify({
        tenant_id: tenantId,
        fetched_at: Date.now(),
        claims
      }));
    } catch { /* sessionStorage full or disabled — non-fatal */ }
  }

  async function fetchActiveClaims(tenantId) {
    const cached = readCache(tenantId);
    if (cached) return cached;

    const r = await fetch(`/api/claims?tenant_id=${encodeURIComponent(tenantId)}`, { cache: 'no-store' });
    if (!r.ok) throw new Error(`/api/claims returned ${r.status}`);
    const data = await r.json();
    const claims = data.claims || [];
    writeCache(tenantId, claims);
    return claims;
  }

  function resolveOne(claims, keysList) {
    const priority = keysList.split(',').map(s => s.trim()).filter(Boolean);
    for (const key of priority) {
      const match = claims.find(c => c.key === key);
      if (match) return match.copy;
    }
    return ''; // none active — render empty
  }

  async function resolveAll() {
    const elements = document.querySelectorAll('[data-claim]');
    if (elements.length === 0) return;

    let claims;
    try {
      claims = await fetchActiveClaims(getTenantId());
    } catch (e) {
      console.warn('[claim-resolver] fetch failed, leaving placeholders empty:', e.message);
      // On failure, render empty — never fall back to potentially-inaccurate template content
      elements.forEach(el => { el.textContent = ''; });
      return;
    }

    elements.forEach(el => {
      const keys = el.getAttribute('data-claim');
      if (!keys) return;
      const copy = resolveOne(claims, keys);
      // Use textContent to avoid HTML injection from claim copy
      el.textContent = copy;
      // Hide row entirely if no claim resolved (parent may want to drop the whole node)
      if (copy === '') {
        el.dataset.claimEmpty = 'true';
        // Caller can hook this to hide ancestors:
        //   document.querySelectorAll('.vs-row:has([data-claim-empty])').forEach(r => r.style.display='none');
      }
    });

    // Fire a custom event so templates can react after resolution
    document.dispatchEvent(new CustomEvent('ryujin:claims-resolved', {
      detail: { count: elements.length, claims }
    }));
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', resolveAll);
  } else {
    resolveAll();
  }

  // Expose for manual re-resolution after dynamic content insertion
  window.RyujinClaimResolver = { resolve: resolveAll, fetchActiveClaims };
})();
