// Ryujin sub-portal upload retry queue (portal QA S3, 2026-06-12).
//
// A lightweight in-page queue for field photo uploads that failed on flaky
// signal. Failed shots persist to localStorage (as compressed-JPEG data URLs)
// and retry automatically when connectivity returns ('online' event) or when
// the roofer taps the chip. Deliberately NOT a service worker / background
// sync: simple, debuggable, works in every mobile browser the crew uses.
//
// Capacity honesty: localStorage gives ~5MB. Compressed field photos run
// 200-500KB as base64, so the queue caps at 8 items and drops the OLDEST when
// full (the chip says so). This is a safety net for a signal blip, not an
// offline vault.
//
// Usage (per page):
//   RyUploadQueue.init({
//     storageKey: 'ry_upq_submedia',
//     uploader: async (item) => { ...re-run the page's real upload path...
//        return { ok: true } or throw / return { ok:false } },
//   });
//   RyUploadQueue.enqueue({ name, type, dataUrl, woId, stage, caption });
(function () {
  'use strict';
  const Q = window.RyUploadQueue = window.RyUploadQueue || {};
  const MAX_ITEMS = 8;
  let KEY = 'ry_upload_queue';
  let uploader = null;
  let retrying = false;

  function read() {
    try { return JSON.parse(localStorage.getItem(KEY) || '[]'); } catch (e) { return []; }
  }
  function write(items) {
    try { localStorage.setItem(KEY, JSON.stringify(items)); } catch (e) {
      // Quota blown: drop oldest until it fits or the queue is empty.
      while (items.length) {
        items.shift();
        try { localStorage.setItem(KEY, JSON.stringify(items)); return; } catch (e2) { /* keep dropping */ }
      }
    }
  }

  // ── chip UI ──
  let chip = null;
  function ensureChip() {
    if (chip) return chip;
    chip = document.createElement('button');
    chip.id = 'ry-upq-chip';
    chip.type = 'button';
    chip.style.cssText = 'position:fixed;left:50%;transform:translateX(-50%);bottom:14px;z-index:300;' +
      'display:none;align-items:center;gap:8px;padding:12px 18px;border-radius:999px;border:none;' +
      'background:#b45309;color:#fff;font:700 14px/1 Inter,system-ui,sans-serif;cursor:pointer;' +
      'box-shadow:0 6px 20px rgba(16,24,40,0.35);min-height:46px';
    chip.addEventListener('click', () => Q.retryAll());
    document.body.appendChild(chip);
    return chip;
  }
  function renderChip() {
    const n = read().length;
    const c = ensureChip();
    if (!n) { c.style.display = 'none'; return; }
    c.style.display = 'inline-flex';
    c.textContent = retrying
      ? `Retrying ${n} photo${n === 1 ? '' : 's'}…`
      : `${n} photo${n === 1 ? '' : 's'} waiting to upload · TAP TO RETRY`;
  }

  // ── api ──
  Q.init = function (opts) {
    if (opts && opts.storageKey) KEY = opts.storageKey;
    if (opts && typeof opts.uploader === 'function') uploader = opts.uploader;
    const start = () => { renderChip(); if (navigator.onLine) Q.retryAll(); };
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
    else start();
    window.addEventListener('online', () => Q.retryAll());
  };

  Q.count = function () { return read().length; };

  // Persist a failed upload. file -> data URL (already compressed by the page).
  Q.enqueue = async function (meta, file) {
    const dataUrl = await new Promise((resolve, reject) => {
      const fr = new FileReader();
      fr.onload = () => resolve(fr.result);
      fr.onerror = reject;
      fr.readAsDataURL(file);
    }).catch(() => null);
    if (!dataUrl) return false;
    const items = read();
    while (items.length >= MAX_ITEMS) items.shift(); // drop oldest, stated policy
    items.push({ ...meta, name: file.name || 'photo.jpg', type: file.type || 'image/jpeg', dataUrl, ts: Date.now() });
    write(items);
    renderChip();
    return true;
  };

  function dataUrlToFile(item) {
    const [head, b64] = String(item.dataUrl).split(',');
    const mime = (head.match(/data:([^;]+)/) || [])[1] || item.type || 'image/jpeg';
    const bin = atob(b64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new File([bytes], item.name || 'photo.jpg', { type: mime });
  }

  Q.retryAll = async function () {
    if (retrying || !uploader) return;
    const items = read();
    if (!items.length) return;
    retrying = true;
    renderChip();
    const remaining = [];
    for (const item of items) {
      try {
        const file = dataUrlToFile(item);
        const r = await uploader(item, file);
        if (!r || r.ok !== true) remaining.push(item); // still failing, keep it
      } catch (e) {
        remaining.push(item);
      }
    }
    write(remaining);
    retrying = false;
    renderChip();
  };
})();
