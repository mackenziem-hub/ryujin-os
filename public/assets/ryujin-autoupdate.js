// Ryujin OS fleet auto-update.
//
// Open tabs and installed PWAs never re-fetch their HTML, so a new deploy can't
// reach them until a manual hard refresh. This watcher fingerprints the current
// document (ETag = content hash, changes every deploy) and reloads when a newer
// build has shipped: on a 2-minute timer and whenever the tab refocuses. It holds
// off while a dialog is open or text is half-typed so it never interrupts a task;
// the next check (or the next refocus) catches it.
//
// Self-contained. Drop `<script src="/assets/ryujin-autoupdate.js"></script>` before
// </body> on any page to make it self-heal. (field.html + companion.html carry an
// equivalent inline copy from PR #762.)
(function () {
  var boot = null;

  function liveTag() {
    return fetch(location.pathname, { method: 'HEAD', cache: 'no-store' })
      .then(function (r) { return r.headers.get('etag') || r.headers.get('last-modified'); })
      .catch(function () { return null; });
  }

  function busy() {
    try {
      if (document.querySelector('dialog[open]')) return true;
      if (document.querySelector('.ai-overlay.on, .modal.open, .modal.on, .overlay.on, .sheet.on')) return true;
      var els = document.querySelectorAll('textarea, input');
      for (var i = 0; i < els.length; i++) {
        var t = (els[i].type || '').toLowerCase();
        if (t === 'file' || t === 'checkbox' || t === 'radio' || t === 'hidden' || t === 'submit' || t === 'button' || t === 'range') continue;
        if ((els[i].value || '').trim()) return true;
      }
    } catch (e) {}
    return false;
  }

  function check() {
    liveTag().then(function (t) {
      if (!t) return;
      if (!boot) { boot = t; return; }
      if (t !== boot && !busy()) location.reload();
    });
  }

  check();
  setInterval(check, 120000);
  document.addEventListener('visibilitychange', function () { if (!document.hidden) check(); });
})();
