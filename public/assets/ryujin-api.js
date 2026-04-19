// ────────────────────────────────────────────────────────────────────
// Ryujin API — tenant-aware fetch wrapper with offline queue fallback.
// Usage:
//   RyujinAPI.post('/api/outputs?type=proposal', { ...payload })
//   RyujinAPI.get('/api/customers')
//   RyujinAPI.tenant()  // current tenant slug
//
// Default tenant is 'plus-ultra'. Override via localStorage 'ry_tenant'
// or <meta name="ry-tenant" content="slug">.
// ────────────────────────────────────────────────────────────────────
(function(){
  const API = window.RyujinAPI = window.RyujinAPI || {};

  function tenant(){
    try {
      const stored = localStorage.getItem('ry_tenant');
      if (stored) return stored;
    } catch(e){}
    const meta = document.querySelector('meta[name="ry-tenant"]');
    if (meta && meta.content) return meta.content;
    return 'plus-ultra';
  }

  function base(){
    // Relative when deployed; allow override for local dev
    try {
      const override = localStorage.getItem('ry_api_base');
      if (override) return override;
    } catch(e){}
    return '';
  }

  async function req(method, path, body){
    // SANDBOX: intercept and return mock data, log the call, don't hit network
    if (window.RyujinMode && window.RyujinMode.isSandbox()) {
      return sandboxResponse(method, path, body);
    }
    const url = base() + path;
    const headers = {
      'Content-Type': 'application/json',
      'x-tenant-id': tenant()
    };
    const opts = { method, headers, credentials: 'same-origin' };
    if (body !== undefined) opts.body = JSON.stringify(body);
    try {
      const res = await fetch(url, opts);
      const ct = res.headers.get('content-type') || '';
      const data = ct.includes('json') ? await res.json() : await res.text();
      if (!res.ok) {
        const err = new Error((data && data.error) || res.statusText || 'API error');
        err.status = res.status;
        err.body = data;
        throw err;
      }
      return data;
    } catch(e){
      // Queue offline for later retry
      queueOffline(method, path, body);
      throw e;
    }
  }

  // Offline queue — best-effort retry when connection returns
  const QUEUE_KEY = 'ry_api_queue';
  function queueOffline(method, path, body){
    if (method === 'GET') return; // don't queue reads
    try {
      const q = JSON.parse(localStorage.getItem(QUEUE_KEY) || '[]');
      q.push({ method, path, body, queuedAt: Date.now() });
      localStorage.setItem(QUEUE_KEY, JSON.stringify(q.slice(-50)));
    } catch(e){}
  }
  async function flushQueue(){
    if (!navigator.onLine) return;
    let q;
    try { q = JSON.parse(localStorage.getItem(QUEUE_KEY) || '[]'); } catch(e){ return; }
    if (!q.length) return;
    const remaining = [];
    for (const item of q) {
      try { await req(item.method, item.path, item.body); }
      catch(e){ remaining.push(item); }
    }
    localStorage.setItem(QUEUE_KEY, JSON.stringify(remaining));
  }
  window.addEventListener('online', flushQueue);
  setTimeout(flushQueue, 2500);

  // ── Sandbox mock responder ──
  async function sandboxResponse(method, path, body){
    // Ghost latency so it feels real
    await new Promise(r => setTimeout(r, 180 + Math.random() * 220));
    // Log every sandbox call for the simulator dashboard
    try {
      const log = JSON.parse(localStorage.getItem('ry_sb_api_log') || '[]');
      log.push({ method, path, body: body || null, at: Date.now() });
      localStorage.setItem('ry_sb_api_log', JSON.stringify(log.slice(-100)));
    } catch(e){}
    // Toast on write so user knows it didn't go live
    if (method !== 'GET' && window.RyujinToast) {
      window.RyujinToast('🎮 Sandbox · not sent live', 'rgba(250,204,21,0.85)');
    }
    // XP awards on writes
    if (window.RyujinXP && method !== 'GET') {
      const award = /outputs.*proposal/.test(path) ? 50
        : /estimates/.test(path) ? 30
        : /tickets/.test(path) ? 15
        : /customers/.test(path) ? 10 : 5;
      window.RyujinXP.award(method + ' ' + path.split('?')[0], award);
    }
    // Return scenario data for reads, echo for writes
    if (method === 'GET' && window.RyujinScenario) {
      return window.RyujinScenario.respond(path);
    }
    return { ok: true, sandbox: true, id: 'sb-' + Math.random().toString(36).slice(2, 10), echoed: body || null };
  }

  API.tenant = tenant;
  API.setTenant = (slug) => { try { localStorage.setItem('ry_tenant', slug); } catch(e){} };
  API.get = (path) => req('GET', path);
  API.post = (path, body) => req('POST', path, body || {});
  API.put = (path, body) => req('PUT', path, body || {});
  API.del = (path) => req('DELETE', path);
  API.flushQueue = flushQueue;
  API.queueSize = () => {
    try { return JSON.parse(localStorage.getItem(QUEUE_KEY) || '[]').length; } catch(e){ return 0; }
  };
})();
