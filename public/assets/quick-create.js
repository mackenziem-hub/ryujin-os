// Ryujin OS — Quick Create
// Universal "+ NEW" affordance: mobile FAB + desktop topbar pill.
// Drop in via <script src="/assets/quick-create.js" defer></script>.
//
// Actions: New Job · New Estimate · New Customer · Upload Media
//
// ─── "Posted 7 times" defense-in-depth ───────────────────────────────
// Layer 1 — Module-level guard: window.__ryujinQuickCreateLoaded ensures
//   the IIFE never runs twice in the same window, even if the <script>
//   tag is double-included.
// Layer 2 — Idempotent DOM injection: every ensure* function checks for
//   a data-ry-qc marker before creating. Re-running boot() is safe.
// Layer 3 — In-flight lockout: state.busy.<action> is checked at the top
//   of every submit handler. Re-entry while busy = silent no-op.
// Layer 4 — File-hash dedupe: hash of (name|size|lastModified) recorded
//   in sessionStorage with timestamp BEFORE the POST kicks off. Same
//   file within 60s = toast + reject. Survives across modal opens.
// Layer 5 — Submit button disable + visual "CREATING..." state, so the
//   user can't double-click during an in-flight request.
// Layer 6 — Single fetch, no auto-retry. Failures don't loop. Server-
//   side cron handles legitimate retries idempotently (see
//   api/marketing-publish.js publishClip skip rules).
// Layer 7 — fileInput.value = '' is set immediately after f = files[0]
//   so a subsequent same-file pick still triggers change, which is
//   then caught by the dedupe layer (not silently swallowed).
// Layer 8 — Nothing in boot() fires a POST. All actions are user-click
//   initiated. No auto-anything.

(function () {
  if (window.__ryujinQuickCreateLoaded) return;
  window.__ryujinQuickCreateLoaded = true;

  // Tenant slug resolution. Same dual-key logic the sweep PR applied to all
  // inline TENANT consts: auth-set 'ryujin_tenant' first (authoritative for
  // non-default tenants), then branding 'ry_tenant_cfg', then default.
  // window.RyujinTenant.get() reads only the branding key, which leaves
  // non-Plus-Ultra logged-in users scoped to plus-ultra. Avoid.
  const TENANT = (function () {
    try { const a = JSON.parse(localStorage.getItem('ryujin_tenant') || 'null'); if (a && a.slug) return a.slug; } catch (e) {}
    try { const c = JSON.parse(localStorage.getItem('ry_tenant_cfg') || 'null'); if (c && c.slug) return c.slug; } catch (e) {}
    return 'plus-ultra';
  })();
  const MOBILE_BP = 768;
  const UPLOAD_DEDUPE_WINDOW_MS = 60 * 1000;
  const UPLOAD_DEDUPE_KEY = 'ry_qc_upload_hashes';

  // /api/customers + /api/estimates are wrapped in
  // requirePortalSessionAndTenant, which reads the session token from
  // Authorization / x-ryujin-token headers (NOT cookies). So we must
  // forward the same Bearer token that auth-guard.js stores in localStorage,
  // or those endpoints 401. Workorders / marketing only need x-tenant-id
  // but it's harmless to send the auth header to them as well.
  function authHeaders(extra) {
    const h = { 'x-tenant-id': TENANT };
    try {
      const tok = localStorage.getItem('ryujin_token')
        || sessionStorage.getItem('ryujin_token')
        || null;
      if (tok) h['Authorization'] = `Bearer ${tok}`;
    } catch { /* storage disabled, fall through */ }
    return extra ? Object.assign(h, extra) : h;
  }

  const state = {
    open: false,
    busy: { job: false, estimate: false, customer: false, upload: false },
    activeModal: null,
  };

  const esc = (s) => String(s == null ? '' : s)
    .replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  const isMobile = () => window.matchMedia(`(max-width: ${MOBILE_BP}px)`).matches;

  // ── Upload dedupe ──────────────────────────────────────────────────
  function fileHashKey(file) {
    if (!file) return null;
    return [file.name || '', file.size || 0, file.lastModified || 0].join('|');
  }

  function readStore() {
    try { return JSON.parse(sessionStorage.getItem(UPLOAD_DEDUPE_KEY) || '{}'); }
    catch { return {}; }
  }

  function writeStore(obj) {
    try { sessionStorage.setItem(UPLOAD_DEDUPE_KEY, JSON.stringify(obj)); } catch { /* quota / disabled */ }
  }

  function isDuplicateUpload(file) {
    const key = fileHashKey(file);
    if (!key) return false;
    const store = readStore();
    const now = Date.now();
    let pruned = false;
    for (const k of Object.keys(store)) {
      if (now - store[k] > UPLOAD_DEDUPE_WINDOW_MS) { delete store[k]; pruned = true; }
    }
    if (pruned) writeStore(store);
    return Boolean(store[key]);
  }

  function recordUpload(file) {
    const key = fileHashKey(file);
    if (!key) return;
    const store = readStore();
    store[key] = Date.now();
    writeStore(store);
  }

  // ── CSS ────────────────────────────────────────────────────────────
  function injectCss() {
    if (document.getElementById('ry-qc-styles')) return;
    const style = document.createElement('style');
    style.id = 'ry-qc-styles';
    style.textContent = `
      .ry-qc-fab {
        position: fixed; right: 18px;
        /* 88px clears portal-mobile.html's inline tabbar (74px + safe-area)
           AND the portal-tabbar.js injected nav (64px + safe-area). */
        bottom: calc(88px + env(safe-area-inset-bottom));
        width: 56px; height: 56px; border-radius: 50%;
        background: linear-gradient(135deg, #2dd4bf, #14b8a6);
        border: none; cursor: pointer; z-index: 9998;
        display: flex; align-items: center; justify-content: center;
        color: #061018;
        box-shadow: 0 8px 24px rgba(45,212,191,0.35), 0 2px 6px rgba(0,0,0,0.3);
        transition: transform 0.18s, box-shadow 0.18s;
        -webkit-tap-highlight-color: transparent;
      }
      .ry-qc-fab:active { transform: scale(0.94); }
      .ry-qc-fab svg { width: 26px; height: 26px; stroke: currentColor; fill: none; stroke-width: 2.6; stroke-linecap: round; }
      .ry-qc-fab.open { transform: rotate(45deg); }

      .ry-qc-pill {
        display: inline-flex; align-items: center; gap: 6px;
        padding: 7px 14px; border-radius: 8px; margin: 0 6px;
        background: linear-gradient(135deg, rgba(45,212,191,0.22), rgba(20,184,166,0.10));
        border: 1px solid rgba(45,212,191,0.45);
        color: #2dd4bf; cursor: pointer;
        font-family: 'Orbitron', 'Inter', sans-serif;
        font-size: 0.68em; font-weight: 800; letter-spacing: 1.5px;
        transition: box-shadow 0.18s, background 0.18s;
      }
      .ry-qc-pill:hover { box-shadow: 0 0 14px rgba(45,212,191,0.4); background: linear-gradient(135deg, rgba(45,212,191,0.32), rgba(20,184,166,0.16)); }
      .ry-qc-pill svg { width: 14px; height: 14px; stroke: currentColor; fill: none; stroke-width: 2.6; stroke-linecap: round; }

      .ry-qc-sheet-back {
        position: fixed; inset: 0;
        background: rgba(3,6,17,0.55);
        backdrop-filter: blur(6px); -webkit-backdrop-filter: blur(6px);
        z-index: 10000; display: none;
        align-items: flex-end; justify-content: center;
        animation: ry-qc-back-in 0.18s ease-out;
      }
      .ry-qc-sheet-back.open { display: flex; }
      @keyframes ry-qc-back-in { from { opacity: 0; } to { opacity: 1; } }

      .ry-qc-sheet {
        background: linear-gradient(180deg, #0e1426, #0a0e1a);
        border-top: 1px solid rgba(45,212,191,0.25);
        width: 100%; max-width: 480px;
        border-radius: 22px 22px 0 0;
        padding: 10px 16px calc(16px + env(safe-area-inset-bottom)) 16px;
        display: flex; flex-direction: column; gap: 8px;
        font-family: 'Inter', system-ui, sans-serif;
        animation: ry-qc-sheet-in 0.22s ease-out;
      }
      @keyframes ry-qc-sheet-in { from { transform: translateY(20px); } to { transform: translateY(0); } }
      .ry-qc-sheet-handle {
        width: 40px; height: 4px; border-radius: 2px;
        background: rgba(255,255,255,0.15);
        margin: 4px auto 8px;
      }
      .ry-qc-sheet-title {
        font-size: 0.78em; font-weight: 600; letter-spacing: 1.5px;
        color: rgba(255,255,255,0.55); text-transform: uppercase;
        padding: 4px 6px 6px;
      }
      .ry-qc-action {
        display: flex; align-items: center; gap: 14px;
        padding: 14px; border-radius: 14px;
        background: rgba(255,255,255,0.04);
        border: 1px solid rgba(255,255,255,0.06);
        color: #eaf0fa; cursor: pointer;
        font-size: 1em; font-weight: 600;
        transition: background 0.15s, border-color 0.15s;
        text-align: left; width: 100%;
        -webkit-tap-highlight-color: transparent;
      }
      .ry-qc-action:active, .ry-qc-action:hover {
        background: rgba(45,212,191,0.08);
        border-color: rgba(45,212,191,0.35);
      }
      .ry-qc-action[disabled] { opacity: 0.5; cursor: wait; pointer-events: none; }
      .ry-qc-action-icon {
        width: 40px; height: 40px; border-radius: 12px;
        background: rgba(45,212,191,0.12);
        display: flex; align-items: center; justify-content: center;
        color: #2dd4bf; flex-shrink: 0;
      }
      .ry-qc-action-icon svg { width: 20px; height: 20px; stroke: currentColor; fill: none; stroke-width: 2; stroke-linecap: round; stroke-linejoin: round; }
      .ry-qc-action-text { flex: 1; min-width: 0; }
      .ry-qc-action-title { display: block; font-size: 0.98em; font-weight: 600; }
      .ry-qc-action-desc { display: block; font-size: 0.78em; color: rgba(255,255,255,0.5); margin-top: 2px; font-weight: 400; }

      .ry-qc-sheet-back.dropdown {
        background: transparent;
        backdrop-filter: none; -webkit-backdrop-filter: none;
        align-items: flex-start; justify-content: flex-end;
        padding: 70px 14px 0 0;
      }
      .ry-qc-sheet-back.dropdown .ry-qc-sheet {
        max-width: 340px; border-radius: 14px;
        border: 1px solid rgba(45,212,191,0.3);
        box-shadow: 0 12px 32px rgba(0,0,0,0.5), 0 0 20px rgba(45,212,191,0.15);
        animation: ry-qc-drop-in 0.16s ease-out;
        padding: 10px;
      }
      .ry-qc-sheet-back.dropdown .ry-qc-sheet-handle { display: none; }
      .ry-qc-sheet-back.dropdown .ry-qc-action { padding: 10px 12px; }
      @keyframes ry-qc-drop-in { from { transform: translateY(-8px); opacity: 0; } to { transform: translateY(0); opacity: 1; } }

      .ry-qc-modal-back {
        position: fixed; inset: 0;
        background: rgba(3,6,17,0.78);
        backdrop-filter: blur(8px); -webkit-backdrop-filter: blur(8px);
        z-index: 10001; display: none;
        align-items: center; justify-content: center;
        padding: 20px;
        animation: ry-qc-back-in 0.18s ease-out;
      }
      .ry-qc-modal-back.open { display: flex; }
      .ry-qc-modal {
        background: linear-gradient(180deg, #0e1426, #0a0e1a);
        border: 1px solid rgba(45,212,191,0.3);
        border-radius: 18px;
        width: 100%; max-width: 460px;
        max-height: 90vh; overflow-y: auto;
        padding: 22px;
        display: flex; flex-direction: column; gap: 14px;
        font-family: 'Inter', system-ui, sans-serif;
        box-shadow: 0 20px 60px rgba(0,0,0,0.5);
      }
      .ry-qc-modal h2 {
        font-family: 'Orbitron', 'Inter', sans-serif;
        font-size: 0.95em; font-weight: 800; letter-spacing: 1.5px;
        color: #2dd4bf; margin: 0;
      }
      .ry-qc-modal form { display: flex; flex-direction: column; gap: 12px; }
      .ry-qc-modal label {
        display: block; font-size: 0.74em; font-weight: 600;
        color: rgba(255,255,255,0.55); letter-spacing: 0.5px;
        margin-bottom: 4px; text-transform: uppercase;
      }
      .ry-qc-modal input, .ry-qc-modal select, .ry-qc-modal textarea {
        width: 100%; padding: 10px 12px;
        background: rgba(0,0,0,0.3);
        border: 1px solid rgba(255,255,255,0.1);
        border-radius: 10px;
        color: #eaf0fa; font-size: 0.95em;
        font-family: inherit;
        outline: none; transition: border-color 0.15s;
      }
      .ry-qc-modal input:focus, .ry-qc-modal select:focus, .ry-qc-modal textarea:focus {
        border-color: rgba(45,212,191,0.5);
      }
      .ry-qc-modal textarea { resize: vertical; min-height: 70px; }
      .ry-qc-modal-actions { display: flex; gap: 10px; justify-content: flex-end; margin-top: 6px; }
      .ry-qc-btn {
        padding: 10px 18px; border-radius: 10px;
        font-family: 'Orbitron', 'Inter', sans-serif;
        font-size: 0.72em; font-weight: 800; letter-spacing: 1.3px;
        cursor: pointer; border: 1px solid; transition: box-shadow 0.18s;
      }
      .ry-qc-btn-ghost {
        background: transparent;
        border-color: rgba(255,255,255,0.15);
        color: rgba(255,255,255,0.6);
      }
      .ry-qc-btn-ghost:hover { color: #fff; border-color: rgba(255,255,255,0.3); }
      .ry-qc-btn-primary {
        background: linear-gradient(135deg, rgba(45,212,191,0.3), rgba(45,212,191,0.12));
        border-color: rgba(45,212,191,0.55); color: #2dd4bf;
      }
      .ry-qc-btn-primary:hover { box-shadow: 0 0 16px rgba(45,212,191,0.35); }
      .ry-qc-btn[disabled] { opacity: 0.5; cursor: wait; pointer-events: none; }

      .ry-qc-toast {
        /* 160px on mobile = above FAB (FAB top is at ~144px on mobile) */
        position: fixed; bottom: calc(160px + env(safe-area-inset-bottom)); left: 50%;
        transform: translateX(-50%) translateY(10px);
        background: rgba(14,22,40,0.95);
        border: 1px solid rgba(45,212,191,0.4);
        border-radius: 10px;
        padding: 10px 18px;
        font-family: 'Share Tech Mono', 'Inter', monospace;
        font-size: 0.82em; letter-spacing: 0.4px;
        color: #eaf0fa;
        z-index: 10002;
        opacity: 0; pointer-events: none;
        transition: opacity 0.25s, transform 0.25s;
        max-width: 360px; text-align: center;
        backdrop-filter: blur(12px); -webkit-backdrop-filter: blur(12px);
      }
      .ry-qc-toast.show { opacity: 1; transform: translateX(-50%) translateY(0); }
      .ry-qc-toast.error { border-color: rgba(248,113,113,0.6); color: #ffd5d5; }
      @media (min-width: ${MOBILE_BP + 1}px) {
        .ry-qc-toast { bottom: 24px; }
      }
    `;
    document.head.appendChild(style);
  }

  // ── Mobile FAB ─────────────────────────────────────────────────────
  function ensureFab() {
    const existing = document.querySelector('[data-ry-qc="fab"]');
    if (!isMobile()) {
      if (existing) existing.remove();
      return;
    }
    if (existing) return;
    const btn = document.createElement('button');
    btn.dataset.ryQc = 'fab';
    btn.className = 'ry-qc-fab';
    btn.type = 'button';
    btn.setAttribute('aria-label', 'Quick create');
    btn.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>';
    btn.addEventListener('click', openSheet);
    document.body.appendChild(btn);
  }

  // ── Desktop pill (in topbar) ───────────────────────────────────────
  function ensurePill() {
    if (isMobile()) {
      document.querySelectorAll('[data-ry-qc="pill"]').forEach((p) => { p.style.display = 'none'; });
      return;
    }
    document.querySelectorAll('[data-ry-qc="pill"]').forEach((p) => { p.style.display = ''; });

    const topbar = document.querySelector('.topbar');
    if (!topbar) return;
    if (topbar.querySelector('[data-ry-qc="pill"]')) return;

    const pill = document.createElement('button');
    pill.dataset.ryQc = 'pill';
    pill.className = 'ry-qc-pill';
    pill.type = 'button';
    pill.setAttribute('aria-label', 'Quick create');
    pill.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>NEW';
    pill.addEventListener('click', openSheet);

    const spacer = topbar.querySelector('.tb-spacer');
    if (spacer && spacer.nextSibling) {
      topbar.insertBefore(pill, spacer.nextSibling);
    } else {
      topbar.appendChild(pill);
    }
  }

  // ── Action sheet ───────────────────────────────────────────────────
  function ensureSheet() {
    if (document.querySelector('[data-ry-qc="sheet-back"]')) return;
    const back = document.createElement('div');
    back.dataset.ryQc = 'sheet-back';
    back.className = 'ry-qc-sheet-back';
    back.innerHTML = `
      <div class="ry-qc-sheet" role="dialog" aria-label="Quick create actions">
        <div class="ry-qc-sheet-handle"></div>
        <div class="ry-qc-sheet-title">Create new</div>
        <button class="ry-qc-action" data-action="job" type="button">
          <span class="ry-qc-action-icon">
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 7h18M3 12h18M3 17h18"/><path d="M3 4h18v16H3z"/></svg>
          </span>
          <span class="ry-qc-action-text">
            <span class="ry-qc-action-title">New job</span>
            <span class="ry-qc-action-desc">Work order, scheduled date, package</span>
          </span>
        </button>
        <button class="ry-qc-action" data-action="estimate" type="button">
          <span class="ry-qc-action-icon">
            <svg viewBox="0 0 24 24" aria-hidden="true"><polyline points="14 2 14 8 20 8"/><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><line x1="8" y1="13" x2="16" y2="13"/><line x1="8" y1="17" x2="13" y2="17"/></svg>
          </span>
          <span class="ry-qc-action-text">
            <span class="ry-qc-action-title">New estimate</span>
            <span class="ry-qc-action-desc">Pull customer into estimator</span>
          </span>
        </button>
        <button class="ry-qc-action" data-action="customer" type="button">
          <span class="ry-qc-action-icon">
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
          </span>
          <span class="ry-qc-action-text">
            <span class="ry-qc-action-title">New customer</span>
            <span class="ry-qc-action-desc">Name, phone, address</span>
          </span>
        </button>
        <button class="ry-qc-action" data-action="upload" type="button">
          <span class="ry-qc-action-icon">
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
          </span>
          <span class="ry-qc-action-text">
            <span class="ry-qc-action-title">Upload media</span>
            <span class="ry-qc-action-desc">Photo or video, then approve caption</span>
          </span>
        </button>
      </div>
      <input type="file" data-ry-qc="file-input" accept="video/mp4,video/quicktime,video/webm,video/x-m4v,image/jpeg,image/png,image/heic,image/heif,image/webp" style="display:none">
    `;
    document.body.appendChild(back);

    back.addEventListener('click', (e) => { if (e.target === back) closeSheet(); });
    back.querySelectorAll('.ry-qc-action').forEach((btn) => {
      btn.addEventListener('click', () => {
        const a = btn.dataset.action;
        closeSheet();
        if (a === 'job') openJobModal();
        else if (a === 'estimate') openEstimateModal();
        else if (a === 'customer') openCustomerModal();
        else if (a === 'upload') triggerUpload();
      });
    });

    const fileInput = back.querySelector('[data-ry-qc="file-input"]');
    fileInput.addEventListener('change', () => handleFileSelected(fileInput));
  }

  function openSheet() {
    ensureSheet();
    const back = document.querySelector('[data-ry-qc="sheet-back"]');
    back.classList.toggle('dropdown', !isMobile());
    back.classList.add('open');
    state.open = true;
    document.querySelector('[data-ry-qc="fab"]')?.classList.add('open');
  }

  function closeSheet() {
    const back = document.querySelector('[data-ry-qc="sheet-back"]');
    back?.classList.remove('open');
    state.open = false;
    document.querySelector('[data-ry-qc="fab"]')?.classList.remove('open');
  }

  // ── Upload (the high-risk action) ──────────────────────────────────
  function triggerUpload() {
    // ensureSheet() injects the file input as a sibling of the sheet. If
    // a caller invokes RyujinQuickCreate.actions.upload() directly without
    // ever opening the sheet first (chat-driven, deep-link, etc.) the
    // input wouldn't exist yet and we'd silently no-op. ensure first.
    ensureSheet();
    const fileInput = document.querySelector('[data-ry-qc="file-input"]');
    if (!fileInput) return;
    fileInput.value = ''; // allow re-pick of same file to trigger change
    fileInput.click();
  }

  async function handleFileSelected(fileInput) {
    const f = fileInput.files && fileInput.files[0];
    fileInput.value = ''; // clear immediately so further change events are clean
    if (!f) return;

    if (isDuplicateUpload(f)) {
      toast(`"${f.name}" was just uploaded — open Creatives to see status.`, true);
      return;
    }
    if (state.busy.upload) {
      toast('Upload already in progress, wait for it to finish.', true);
      return;
    }

    state.busy.upload = true;
    recordUpload(f); // record BEFORE the network call

    const defaultTitle = f.name.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ');
    toast(`Uploading "${defaultTitle}"...`);

    try {
      const fd = new FormData();
      fd.append('file', f);
      fd.append('title', defaultTitle);
      fd.append('platforms', 'facebook,instagram');
      const r = await fetch('/api/marketing', {
        method: 'POST',
        headers: authHeaders(),
        body: fd,
      });
      if (!r.ok) {
        const txt = await r.text().catch(() => '');
        throw new Error(`HTTP ${r.status} ${txt.slice(0, 140)}`);
      }
      toast('Uploaded. Rendering in background. Review caption in Creatives before it posts.');
    } catch (e) {
      toast(`Upload failed: ${e.message}`, true);
    } finally {
      state.busy.upload = false;
    }
  }

  // ── Generic modal (used by Job / Estimate / Customer) ──────────────
  function openModal({ title, fields, onSubmit, busyKey }) {
    document.querySelectorAll('[data-ry-qc="modal-back"]').forEach((m) => m.remove());

    const back = document.createElement('div');
    back.dataset.ryQc = 'modal-back';
    back.className = 'ry-qc-modal-back';
    back.innerHTML = `
      <div class="ry-qc-modal" role="dialog" aria-label="${esc(title)}">
        <h2>${esc(title)}</h2>
        <form data-ry-qc-form>
          ${fields.map((f) => `
            <div>
              <label>${esc(f.label)}${f.required ? ' *' : ''}</label>
              ${f.type === 'select'
                ? `<select name="${esc(f.name)}"${f.required ? ' required' : ''}>${f.options.map((o) => `<option value="${esc(o.value)}">${esc(o.label)}</option>`).join('')}</select>`
                : f.type === 'textarea'
                  ? `<textarea name="${esc(f.name)}" rows="3"${f.required ? ' required' : ''}${f.placeholder ? ` placeholder="${esc(f.placeholder)}"` : ''}></textarea>`
                  : `<input type="${esc(f.type || 'text')}" name="${esc(f.name)}"${f.required ? ' required' : ''}${f.placeholder ? ` placeholder="${esc(f.placeholder)}"` : ''}${f.step ? ` step="${esc(f.step)}"` : ''}>`}
            </div>
          `).join('')}
          <div class="ry-qc-modal-actions">
            <button type="button" class="ry-qc-btn ry-qc-btn-ghost" data-ry-qc-cancel>CANCEL</button>
            <button type="submit" class="ry-qc-btn ry-qc-btn-primary" data-ry-qc-submit>CREATE</button>
          </div>
        </form>
      </div>
    `;
    document.body.appendChild(back);
    back.classList.add('open');
    state.activeModal = back;

    const form = back.querySelector('[data-ry-qc-form]');
    const submitBtn = back.querySelector('[data-ry-qc-submit]');
    const cancelBtn = back.querySelector('[data-ry-qc-cancel]');

    cancelBtn.addEventListener('click', () => closeModal());
    back.addEventListener('click', (e) => { if (e.target === back) closeModal(); });

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      if (state.busy[busyKey]) return;
      state.busy[busyKey] = true;
      submitBtn.disabled = true;
      const originalLabel = submitBtn.textContent;
      submitBtn.textContent = 'CREATING...';
      try {
        const fd = new FormData(form);
        const data = {};
        for (const [k, v] of fd.entries()) {
          const trimmed = typeof v === 'string' ? v.trim() : v;
          if (trimmed !== '') data[k] = trimmed;
        }
        const out = await onSubmit(data);
        if (out !== false) closeModal();
      } catch (err) {
        toast(`Failed: ${err.message}`, true);
        submitBtn.disabled = false;
        submitBtn.textContent = originalLabel;
      } finally {
        state.busy[busyKey] = false;
      }
    });

    setTimeout(() => back.querySelector('input,select,textarea')?.focus(), 50);
  }

  function closeModal() {
    state.activeModal?.remove();
    state.activeModal = null;
  }

  function openJobModal() {
    openModal({
      title: 'New Job',
      busyKey: 'job',
      fields: [
        { name: 'customer_name', label: 'Customer name', required: true, placeholder: 'e.g. Brian Dorken' },
        { name: 'address', label: 'Address', required: true, placeholder: '1530 Route 475, Wellington NB' },
        { name: 'phone', label: 'Phone', type: 'tel', placeholder: '506-...' },
        { name: 'start_date', label: 'Start date', type: 'date' },
        { name: 'package_tier', label: 'Package', type: 'select', options: [
          { value: '', label: '(none yet)' },
          { value: 'gold', label: 'Gold' },
          { value: 'platinum', label: 'Platinum' },
          { value: 'diamond', label: 'Diamond' },
          { value: 'shell', label: 'Shell (siding)' },
          { value: 'combined', label: 'Combined (roof + shell)' },
          { value: 'service', label: 'Service / repair' },
        ] },
        { name: 'total_sq', label: 'Total SQ (if known)', type: 'number', step: '0.01', placeholder: 'e.g. 22' },
        { name: 'notes', label: 'Notes', type: 'textarea' },
      ],
      onSubmit: async (data) => {
        const body = { ...data, status: 'draft' };
        if (body.total_sq) body.total_sq = Number(body.total_sq);
        const r = await fetch('/api/workorders', {
          method: 'POST',
          headers: authHeaders({ 'Content-Type': 'application/json' }),
          body: JSON.stringify(body),
        });
        if (!r.ok) {
          const txt = await r.text().catch(() => '');
          throw new Error(`HTTP ${r.status} ${txt.slice(0, 140)}`);
        }
        const wo = await r.json();
        toast(`Job created: ${wo.customer_name || wo.address || wo.id}`);
        setTimeout(() => { window.location.href = `/job.html?wo=${encodeURIComponent(wo.id)}`; }, 600);
      },
    });
  }

  function openEstimateModal() {
    openModal({
      title: 'New Estimate',
      busyKey: 'estimate',
      fields: [
        { name: 'full_name', label: 'Customer name', required: true },
        { name: 'address', label: 'Address', required: true },
        { name: 'phone', label: 'Phone', type: 'tel' },
        { name: 'email', label: 'Email', type: 'email' },
        { name: 'proposal_mode', label: 'Type', type: 'select', options: [
          { value: 'Roof Only', label: 'Roof Only' },
          { value: 'Roof + Shell', label: 'Roof + Shell' },
          { value: 'Shell Only', label: 'Shell Only' },
          { value: 'Service', label: 'Service / repair' },
        ] },
      ],
      onSubmit: async (data) => {
        const body = {
          customer: {
            full_name: data.full_name,
            address: data.address,
            phone: data.phone || null,
            email: data.email || null,
          },
          proposal_mode: data.proposal_mode || 'Roof Only',
          status: 'draft',
        };
        const r = await fetch('/api/estimates', {
          method: 'POST',
          headers: authHeaders({ 'Content-Type': 'application/json' }),
          body: JSON.stringify(body),
        });
        if (!r.ok) {
          const txt = await r.text().catch(() => '');
          throw new Error(`HTTP ${r.status} ${txt.slice(0, 140)}`);
        }
        const est = await r.json();
        const id = est.id || est.estimate?.id;
        toast('Estimate created');
        if (id) setTimeout(() => { window.location.href = `/sales-proposal.html?id=${encodeURIComponent(id)}`; }, 600);
      },
    });
  }

  function openCustomerModal() {
    openModal({
      title: 'New Customer',
      busyKey: 'customer',
      fields: [
        { name: 'full_name', label: 'Name', required: true },
        { name: 'phone', label: 'Phone', type: 'tel' },
        { name: 'email', label: 'Email', type: 'email' },
        { name: 'address', label: 'Address' },
        { name: 'notes', label: 'Notes', type: 'textarea' },
      ],
      onSubmit: async (data) => {
        const r = await fetch('/api/customers', {
          method: 'POST',
          headers: authHeaders({ 'Content-Type': 'application/json' }),
          body: JSON.stringify(data),
        });
        if (!r.ok) {
          const txt = await r.text().catch(() => '');
          throw new Error(`HTTP ${r.status} ${txt.slice(0, 140)}`);
        }
        toast('Customer added');
      },
    });
  }

  // ── Toast ──────────────────────────────────────────────────────────
  let toastTimer;
  function toast(msg, isError) {
    let t = document.querySelector('[data-ry-qc="toast"]');
    if (!t) {
      t = document.createElement('div');
      t.dataset.ryQc = 'toast';
      t.className = 'ry-qc-toast';
      document.body.appendChild(t);
    }
    t.textContent = msg;
    t.classList.toggle('error', !!isError);
    t.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.remove('show'), 4000);
  }

  // ── Boot ───────────────────────────────────────────────────────────
  function boot() {
    injectCss();
    ensureFab();
    ensurePill();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }

  let lastIsMobile = isMobile();
  window.addEventListener('resize', () => {
    const curr = isMobile();
    if (curr !== lastIsMobile) {
      lastIsMobile = curr;
      ensureFab();
      ensurePill();
    }
  });

  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    if (state.activeModal) closeModal();
    else if (state.open) closeSheet();
  });

  // Expose minimal API for chat-driven invocations (no auto-firing of any action).
  window.RyujinQuickCreate = {
    open: openSheet,
    close: closeSheet,
    actions: { job: openJobModal, estimate: openEstimateModal, customer: openCustomerModal, upload: triggerUpload },
  };
})();
