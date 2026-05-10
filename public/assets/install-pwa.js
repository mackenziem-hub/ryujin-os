// ═══════════════════════════════════════════════════════════════
// Ryujin OS — Install-on-phone client.
//
// Drop-in script that:
//   • Captures Android/desktop Chrome's beforeinstallprompt event.
//   • On iOS Safari, shows a modal with Share → Add to Home Screen
//     instructions (Apple doesn't allow programmatic prompts).
//   • Hides install affordances when the page is already running
//     as an installed PWA (display-mode: standalone / iOS standalone).
//
// Usage:
//   <script src="/assets/install-pwa.js" defer></script>
//   <a href="#" data-install-btn>Install on phone</a>
//
// Any element with [data-install-btn] becomes an install trigger.
// Also exposes window.Ryujin.installPWA() for custom invocations.
// ═══════════════════════════════════════════════════════════════
(function () {
  'use strict';

  const isStandalone =
    (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) ||
    window.navigator.standalone === true;

  const isIOS = /iPhone|iPad|iPod/.test(navigator.userAgent) && !window.MSStream;

  let deferredPrompt = null;

  window.addEventListener('beforeinstallprompt', (ev) => {
    ev.preventDefault();
    deferredPrompt = ev;
    setInstalledLabels(false);
  });

  window.addEventListener('appinstalled', () => {
    deferredPrompt = null;
    setInstalledLabels(true);
  });

  function setInstalledLabels(installed) {
    document.querySelectorAll('[data-install-btn]').forEach(btn => {
      if (installed || isStandalone) {
        btn.textContent = '✓ Ryujin installed';
        btn.setAttribute('aria-disabled', 'true');
        btn.style.pointerEvents = 'none';
        btn.style.opacity = '0.6';
      }
    });
  }

  function showIOSModal() {
    if (document.getElementById('ry-install-modal')) return;
    const wrap = document.createElement('div');
    wrap.id = 'ry-install-modal';
    wrap.setAttribute('role', 'dialog');
    wrap.setAttribute('aria-modal', 'true');
    wrap.style.cssText = 'position:fixed;inset:0;background:rgba(6,10,20,0.92);z-index:10000;display:flex;align-items:center;justify-content:center;padding:20px;font-family:system-ui,-apple-system,sans-serif';
    wrap.innerHTML = `
      <div style="background:rgba(20,30,50,0.97);border:1px solid rgba(34,211,238,0.3);border-radius:14px;padding:22px;max-width:340px;color:#d0daf0;box-shadow:0 20px 50px rgba(0,0,0,0.5)">
        <h2 style="margin:0 0 12px;font-size:1.05em;font-weight:700;letter-spacing:0.5px;color:#22d3ee">Install Ryujin on iPhone</h2>
        <ol style="padding-left:22px;line-height:1.65;font-size:0.93em;margin:0 0 18px;color:#d0daf0">
          <li>Tap the <strong>Share</strong> icon
            <svg viewBox="0 0 24 24" width="14" height="14" style="vertical-align:-2px;display:inline-block" fill="none" stroke="#22d3ee" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 16V4"/><path d="M7 9l5-5 5 5"/><path d="M5 12v7a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-7"/></svg>
            at the bottom of Safari.
          </li>
          <li>Scroll down and tap <strong>Add to Home Screen</strong>.</li>
          <li>Tap <strong>Add</strong> in the top-right corner.</li>
        </ol>
        <p style="font-size:0.78em;color:rgba(160,190,230,0.55);margin:0 0 14px;line-height:1.5">Tap the Ryujin icon any time to jump straight into your portal — no login screen.</p>
        <button type="button" id="ry-install-close" style="width:100%;padding:10px 14px;background:linear-gradient(135deg,#22d3ee,#7c3aed);color:#0a0e1a;font-family:inherit;font-weight:700;letter-spacing:1px;text-transform:uppercase;font-size:0.78em;border:none;border-radius:10px;cursor:pointer">Got it</button>
      </div>`;
    wrap.addEventListener('click', (e) => { if (e.target === wrap) wrap.remove(); });
    document.body.appendChild(wrap);
    document.getElementById('ry-install-close').addEventListener('click', () => wrap.remove());
  }

  function showDesktopHint() {
    if (document.getElementById('ry-install-modal')) return;
    const wrap = document.createElement('div');
    wrap.id = 'ry-install-modal';
    wrap.style.cssText = 'position:fixed;inset:0;background:rgba(6,10,20,0.92);z-index:10000;display:flex;align-items:center;justify-content:center;padding:20px;font-family:system-ui,-apple-system,sans-serif';
    wrap.innerHTML = `
      <div style="background:rgba(20,30,50,0.97);border:1px solid rgba(34,211,238,0.3);border-radius:14px;padding:22px;max-width:340px;color:#d0daf0">
        <h2 style="margin:0 0 12px;font-size:1.05em;font-weight:700;color:#22d3ee">Install on your phone</h2>
        <p style="font-size:0.92em;line-height:1.55;margin:0 0 18px">Open Ryujin on your phone (iPhone Safari or Android Chrome) and tap <strong>Install</strong> again from there.</p>
        <button type="button" id="ry-install-close" style="width:100%;padding:10px 14px;background:linear-gradient(135deg,#22d3ee,#7c3aed);color:#0a0e1a;font-weight:700;letter-spacing:1px;text-transform:uppercase;font-size:0.78em;border:none;border-radius:10px;cursor:pointer">Got it</button>
      </div>`;
    wrap.addEventListener('click', (e) => { if (e.target === wrap) wrap.remove(); });
    document.body.appendChild(wrap);
    document.getElementById('ry-install-close').addEventListener('click', () => wrap.remove());
  }

  async function install() {
    if (isStandalone) return;
    if (deferredPrompt) {
      try {
        deferredPrompt.prompt();
        const { outcome } = await deferredPrompt.userChoice;
        if (outcome === 'accepted') deferredPrompt = null;
      } catch (e) {
        console.warn('install prompt failed', e);
      }
      return;
    }
    if (isIOS) return showIOSModal();
    return showDesktopHint();
  }

  window.Ryujin = window.Ryujin || {};
  window.Ryujin.installPWA = install;

  function wire() {
    document.querySelectorAll('[data-install-btn]').forEach(btn => {
      if (btn.dataset.installWired) return;
      btn.dataset.installWired = '1';
      btn.addEventListener('click', (e) => { e.preventDefault(); install(); });
    });
    setInstalledLabels(isStandalone);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', wire);
  else wire();
})();
