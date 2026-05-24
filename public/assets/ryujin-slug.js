// Ryujin OS — shared tenant-slug resolver.
//
// Why this exists:
// PR #46 (2026-05-24) added a 9-line IIFE tenant-slug resolver to 62
// inline scripts after codex caught three different load-order / format
// edge cases in the original `window.RyujinTenant?.get?.()?.slug` pattern.
// That copy-pasted block is now sitting in 62 files. If we discover
// another tenant-format edge case (the auth flow has already produced
// THREE different on-disk shapes), we'd need a third sweep.
//
// This file is the single source of truth. Two ways to use:
//
//   A) Immediate read (helper is loaded via <script src="..."> tag):
//       const TENANT = window.RYUJIN_TENANT_SLUG;
//
//   B) Late lookup (call from anywhere, anytime — recomputes from
//      localStorage in case the slug changed since boot):
//       const TENANT = window.getRyujinTenantSlug();
//
// Resolution priority (all match the existing inline IIFE):
//   1. localStorage 'ryujin_tenant' as JSON object with .slug
//      (set by login.html and magic.html)
//   2. localStorage 'ryujin_tenant' as bare slug string
//      (set by signup.html)
//   3. localStorage 'ry_tenant_cfg' as JSON object with .slug
//      (branding config — user changed brand without re-login)
//   4. 'plus-ultra' (dev / preview / first-tenant default)
//
// Bare-string slugs are validated against /^[a-z0-9-]{1,80}$/i to avoid
// sending malformed values as a tenant header.

(function () {
  function pick(key) {
    try {
      const raw = localStorage.getItem(key);
      if (!raw) return null;
      try { const o = JSON.parse(raw); if (o && o.slug) return o.slug; } catch (e) { /* not JSON */ }
      if (typeof raw === 'string' && /^[a-z0-9-]{1,80}$/i.test(raw.trim())) return raw.trim();
    } catch (e) { /* localStorage disabled */ }
    return null;
  }

  function getRyujinTenantSlug() {
    return pick('ryujin_tenant') || pick('ry_tenant_cfg') || 'plus-ultra';
  }

  // Cached resolved value at script-load time. Use this if you need a
  // synchronous answer in a hot path; use getRyujinTenantSlug() if you
  // want a fresh read (e.g., after the user logs in mid-session).
  window.RYUJIN_TENANT_SLUG = getRyujinTenantSlug();
  window.getRyujinTenantSlug = getRyujinTenantSlug;
})();
