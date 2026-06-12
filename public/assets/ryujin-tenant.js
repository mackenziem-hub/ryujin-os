// ────────────────────────────────────────────────────────────────────
// Ryujin Tenant — business branding config.
// The platform is Ryujin OS. The TENANT is the actual business that
// customers see (Plus Ultra Roofing for tenant #1). Operator-facing and
// homeowner-facing UIs use this tenant info, not the platform brand.
// ────────────────────────────────────────────────────────────────────
(function(){
  const T = window.RyujinTenant = window.RyujinTenant || {};

  const DEFAULT = {
    slug: 'plus-ultra',
    name: 'Plus Ultra Roofing',
    nameShort: 'Plus Ultra',
    tagline: 'The most-reviewed roofer in Moncton.',
    phone: '(506) 540-1052',
    phoneRaw: '+15065401052',
    email: 'plusultraroofing@gmail.com',
    website: 'plusultraroofing.com',
    address: 'Riverview · Moncton NB',
    certifications: 'CertainTeed Certified · Licensed in NB · 3rd Generation',
    owner: 'Mackenzie Mazerolle',
    ownerTitle: 'Owner · Plus Ultra Roofing',
    ownerInitials: 'MM',
    // Sub-contractor business (shown on work orders / pay sheets)
    sub: { name: 'Atlantic Roofing', contact: 'Ryan', rateSQ: 140 },
    // Visual accent (kept cyan to match current design unless overridden)
    accent: '#22d3ee',
    accentGlow: 'rgba(34,211,238,0.35)',
    // HST, default province
    hstRate: 0.15,
    province: 'NB'
  };

  const KEY = 'ry_tenant_cfg';

  function load(){
    try {
      const saved = JSON.parse(localStorage.getItem(KEY) || 'null');
      if (saved) return Object.assign({}, DEFAULT, saved);
    } catch(e){}
    return Object.assign({}, DEFAULT);
  }
  function save(cfg){
    try { localStorage.setItem(KEY, JSON.stringify(cfg)); } catch(e){}
    document.dispatchEvent(new CustomEvent('ryujin-tenant-change', { detail: cfg }));
  }

  let cached = load();

  T.get = () => cached;
  T.set = (partial) => { cached = Object.assign({}, cached, partial); save(cached); return cached; };
  T.reset = () => { cached = Object.assign({}, DEFAULT); save(cached); return cached; };
  T.DEFAULT = DEFAULT;

  // Convenience: set any element's text to a tenant field via data-attr
  //   <span data-tenant="name"></span>   → "Plus Ultra Roofing"
  //   <span data-tenant="phone"></span>  → "(506) 540-1052"
  function apply(){
    document.querySelectorAll('[data-tenant]').forEach(el => {
      const key = el.getAttribute('data-tenant');
      const val = cached[key];
      if (val !== undefined) {
        // For anchors, set href for tel/mailto
        if (el.tagName === 'A' && key === 'phoneRaw') el.href = 'tel:' + val;
        else if (el.tagName === 'A' && key === 'email') el.href = 'mailto:' + val;
        else el.textContent = val;
      }
    });
  }
  T.apply = apply;

  // Replace the legacy "RYUJIN · <SECTOR>" header text with tenant name at boot
  // Keeps any other topbar content intact. Triggers on DOMContentLoaded + on change.
  function rebrand(){
    const name = cached.nameShort || cached.name;
    document.querySelectorAll('.brand-name').forEach(el => {
      // Replace only the initial "RYUJIN" word; keep the "· SECTOR" dim suffix
      const dim = el.querySelector('.dim');
      const suffix = dim ? dim.outerHTML : '';
      el.innerHTML = name.toUpperCase() + (suffix ? ' ' + suffix : '');
    });
    // Update page title prefix if still default
    if (document.title && document.title.startsWith('Ryujin OS')) {
      document.title = document.title.replace(/^Ryujin OS/, name);
    }
    apply();
  }
  T.rebrand = rebrand;

  // Hydrate tenant identity from tenant_settings via /api/tenant-branding, the
  // same source the v2 portal uses. This moves the internal-portal brand strings
  // off the hardcoded Plus Ultra DEFAULT and behind tenant_settings, across every
  // internal page that includes this helper.
  //
  // Scope is deliberately the lowest-risk subset: only name, phone, and email,
  // whose hardcoded DEFAULT already equals tenant_settings for plus-ultra. So
  // this is a zero-visible-change for tenant #1 while giving any other tenant its
  // own identity. tagline, accent, and website are intentionally NOT pulled here
  // because the helper's defaults differ from tenant_settings and changing them
  // would alter Plus Ultra's current look (a separate reconciliation PR, not the
  // lowest-risk batch). On any error the DEFAULT/localStorage config stands.
  // In-memory only (not persisted) so a shared browser is never pinned to one
  // tenant's branding.
  async function hydrateFromApi(){
    try {
      let slug = window.RYUJIN_TENANT_SLUG;
      if (!slug) { try { slug = localStorage.getItem('ry_tenant'); } catch(e){} }
      if (!slug) slug = cached.slug;
      const url = slug ? ('/api/tenant-branding?tenant=' + encodeURIComponent(slug)) : '/api/tenant-branding';
      const headers = {};
      try {
        const tok = localStorage.getItem('ryujin_token') || sessionStorage.getItem('ryujin_token');
        if (tok) headers.Authorization = 'Bearer ' + tok;
      } catch(e){}
      const res = await fetch(url, { headers, cache: 'no-store' });
      if (!res.ok) return;
      const body = await res.json();
      const b = (body && body.branding) || {};
      const patch = {};
      if (b.company_name) patch.name = b.company_name;
      if (b.company_phone) patch.phone = b.company_phone;
      if (b.company_email) patch.email = b.company_email;
      // Protocol-stripped + trailing-slash-trimmed so it matches the DEFAULT
      // format (plus-ultra DEFAULT is 'plusultraroofing.com', tenant_settings is
      // 'https://plusultraroofing.com'); keeps tenant #1 a zero-visible-change.
      if (b.company_website) patch.website = String(b.company_website).replace(/^https?:\/\//i, '').replace(/\/+$/, '');
      if (!Object.keys(patch).length) return;
      cached = Object.assign({}, cached, patch);
      rebrand();
    } catch(e){ /* keep DEFAULT */ }
  }
  T.hydrate = hydrateFromApi;

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', rebrand);
  } else {
    rebrand();
  }
  document.addEventListener('ryujin-tenant-change', rebrand);
  hydrateFromApi();
})();
