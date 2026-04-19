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
    certifications: 'CertainTeed Certified · Fully Insured · 3rd Generation',
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

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', rebrand);
  } else {
    rebrand();
  }
  document.addEventListener('ryujin-tenant-change', rebrand);
})();
