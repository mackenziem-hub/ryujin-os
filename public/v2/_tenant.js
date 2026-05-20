/*
 * Ryujin OS · v2 tenant branding
 *
 * Fetches the tenant's settings from /api/settings and applies them
 * across the v2 portal surfaces:
 *   - Replaces all [data-tenant-name] with company_name
 *   - Replaces all [data-tenant-tagline] with tagline
 *   - Replaces all [data-tenant-phone] with company_phone
 *   - Injects accent_color as the primary action color override
 *   - Mounts logo_url into [data-tenant-logo] if present
 *
 * The Mi'kmaq palette stays the design language; the tenant only
 * overrides the action color and identity bits. If accent_color is
 * unset on the tenant, the default copper is preserved.
 *
 * Tenant slug resolution: ?tenant=<slug> in URL, then localStorage
 * ry_tenant, then the body's data-tenant attribute, falling back to
 * 'plus-ultra' for the current dev period.
 */

const STORAGE_KEY = 'ry_tenant';
const DEV_FALLBACK_TENANT = 'plus-ultra';

// Resolve the tenant slug. Priority:
//   1. ?tenant= query param (and persist it to localStorage)
//   2. localStorage ry_tenant
//   3. <body data-tenant="..."> attribute
//   4. On localhost / *.vercel.app: fall back to DEV_FALLBACK_TENANT
//   5. Otherwise return null so the API derives the tenant from the host
//      (this is the case that matters for custom-domain tenants, where
//      forcing plus-ultra would yank Plus Ultra's branding into someone
//      else's portal).
function isHostWithoutTenantInference() {
  const host = window.location.hostname;
  if (host === 'localhost' || host === '127.0.0.1') return true;
  if (host.endsWith('.vercel.app')) return true;
  return false;
}

function readTenantSlug() {
  const isDevHost = isHostWithoutTenantInference();

  // On custom domains, the host IS the tenant. Refuse to honor query
  // params, localStorage, or body attributes that could pin to a
  // different tenant and leak someone else's branding into this portal.
  if (!isDevHost) return null;

  // Dev host: full client-side selection chain.
  try {
    const url = new URL(window.location.href);
    const q = url.searchParams.get('tenant');
    if (q) {
      try { localStorage.setItem(STORAGE_KEY, q); } catch { /* ignore */ }
      return q;
    }
  } catch { /* ignore */ }
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) return stored;
  } catch { /* ignore */ }
  const bodyAttr = document.body.getAttribute('data-tenant');
  if (bodyAttr) return bodyAttr;
  return DEV_FALLBACK_TENANT;
}

function hexToRgb(hex) {
  if (!hex || typeof hex !== 'string') return null;
  const m = hex.replace('#', '');
  if (m.length !== 6 && m.length !== 3) return null;
  const full = m.length === 3 ? m.split('').map(c => c + c).join('') : m;
  const r = parseInt(full.slice(0, 2), 16);
  const g = parseInt(full.slice(2, 4), 16);
  const b = parseInt(full.slice(4, 6), 16);
  if ([r, g, b].some(Number.isNaN)) return null;
  return { r, g, b };
}

function shadeHex(hex, percent) {
  // negative percent darkens, positive lightens
  const rgb = hexToRgb(hex);
  if (!rgb) return hex;
  const factor = 1 + percent / 100;
  const clamp = (n) => Math.max(0, Math.min(255, Math.round(n)));
  const r = clamp(rgb.r * factor);
  const g = clamp(rgb.g * factor);
  const b = clamp(rgb.b * factor);
  return '#' + [r, g, b].map(n => n.toString(16).padStart(2, '0')).join('');
}

function applyAccent(hex) {
  if (!hex) return;
  const ok = hexToRgb(hex);
  if (!ok) return;
  const darker = shadeHex(hex, -12);
  const darkest = shadeHex(hex, -24);
  const lighter = shadeHex(hex, 18);
  const root = document.documentElement.style;
  root.setProperty('--rj-action-primary', hex);
  root.setProperty('--rj-action-primary-hover', darker);
  root.setProperty('--rj-action-primary-active', darkest);
  root.setProperty('--rj-copper-600', hex);
  root.setProperty('--rj-copper-700', darker);
  root.setProperty('--rj-copper-500', lighter);
  // Focus ring tinted by the tenant accent
  const rgb = hexToRgb(hex);
  if (rgb) {
    root.setProperty('--rj-focus-ring', `0 0 0 3px rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, 0.32)`);
  }
}

function applyText(branding) {
  if (branding.company_name) {
    // Pages opt into branding by marking elements with data-tenant-name.
    // Don't walk text nodes inside .rj-topbar-brand here; that approach
    // corrupted whitespace-only text nodes around the emblem.
    document.querySelectorAll('[data-tenant-name]').forEach(el => {
      el.textContent = branding.company_name;
    });
  }
  if (branding.tagline) {
    document.querySelectorAll('[data-tenant-tagline]').forEach(el => {
      el.textContent = branding.tagline;
    });
  }
  if (branding.company_phone) {
    document.querySelectorAll('[data-tenant-phone]').forEach(el => {
      el.textContent = branding.company_phone;
    });
  }
  if (branding.logo_url) {
    document.querySelectorAll('[data-tenant-logo]').forEach(el => {
      if (el.tagName === 'IMG') el.src = branding.logo_url;
      else el.style.backgroundImage = `url(${branding.logo_url})`;
    });
  }
  // Document title can take the tenant name as a prefix
  if (branding.company_name && document.title.startsWith('Ryujin OS')) {
    document.title = document.title.replace('Ryujin OS', branding.company_name);
  }
}

async function fetchSettings(slug) {
  // Use the branding-only endpoint, NOT /api/settings. The settings
  // endpoint returns pricing, margins, overhead, and other internal config
  // that must never reach the browser on a public page.
  const url = slug
    ? `/api/tenant-branding?tenant=${encodeURIComponent(slug)}`
    : '/api/tenant-branding';
  const res = await fetch(url, { cache: 'no-store' });
  if (!res.ok) throw new Error(`tenant-branding http ${res.status}`);
  const body = await res.json();
  // Response shape: { tenant: { id, slug }, branding: { ... } }.
  // Flatten so the rest of this module's branding-field plumbing stays simple.
  return body.branding || {};
}

async function init() {
  const slug = readTenantSlug();
  if (slug) document.body.setAttribute('data-tenant', slug);
  try {
    const settings = await fetchSettings(slug);
    const branding = {
      company_name: settings.company_name || null,
      tagline: settings.tagline || null,
      company_phone: settings.company_phone || null,
      logo_url: settings.logo_url || null,
      accent_color: settings.accent_color || null,
      proposal_header: settings.proposal_header || null
    };
    if (branding.accent_color) applyAccent(branding.accent_color);
    applyText(branding);
    document.dispatchEvent(new CustomEvent('rj-tenant-ready', { detail: { slug, branding } }));
    window.RyujinTenant = Object.freeze({ slug, branding });
  } catch (e) {
    console.warn('[ry-tenant] could not load settings, falling back to defaults', e);
    window.RyujinTenant = Object.freeze({ slug, branding: null });
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
