/* Ryujin Drive - the "controlling computer" layer.
 *
 * Mounted fleet-wide by auth-guard.js (operator pages only). Renders the SSE
 * events api/chat already emits (tool_start / navigate / tool_end / pending_approval
 * / text) as a VISIBLE real-OS takeover: a synthetic cursor glides, a step rail
 * narrates, the screen wipes, the REAL page loads, and on arrival the presence
 * speaks the answer and points at the relevant element. It feels instant because
 * it is prewired - chat.js returns a catalog-validated destination + the tool
 * steps; this layer just choreographs them. Not computer-use.
 *
 * Firm wall: any outbound step comes back as pending_approval. The drive PAUSES
 * and surfaces the approval card - it NEVER auto-confirms. Mac signs off.
 *
 * Fail-soft contract (same as the other auth-guard injectors): any error hides
 * the overlay and leaves the underlying page fully usable. No build step. No em dashes.
 */
(function () {
  "use strict";
  if (window.__ryujinDriveInjected) return;
  window.__ryujinDriveInjected = true;

  var REDUCED = false;
  try { REDUCED = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches; } catch (e) {}

  var RESUME_KEY = "ryujin_drive_resume";
  var RESUME_TTL = 12000;

  // ---- helpers ----------------------------------------------------------
  function headers() {
    var h = { "Content-Type": "application/json", "Accept": "text/event-stream" };
    try { if (window.RyujinAuth && window.RyujinAuth.headers) Object.assign(h, window.RyujinAuth.headers()); } catch (e) {}
    return h;
  }
  function el(tag, cls, html) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (html != null) n.innerHTML = html;
    return n;
  }
  function pageName(url) {
    try {
      var path = (url || "").split("?")[0].split("#")[0];
      if (window.RyujinPages && window.RyujinPages.titleFor) {
        var t = window.RyujinPages.titleFor(path);
        if (t) return t;
      }
      var base = path.replace(/^\//, "").replace(/\.html$/, "") || "home";
      return base.replace(/[-_]/g, " ");
    } catch (e) { return "a page"; }
  }
  function landmarkHint(url) {
    var path = (url || "").split("?")[0].split("#")[0];
    return path.replace(/^\//, "").replace(/\.html$/, "") || "main";
  }

  // ---- overlay DOM ------------------------------------------------------
  var root, veil, cursor, rail, say, orb, cmdForm, cmdInput, approvalEl;
  var abort = null, steps = {}, answerAcc = "", pendingNav = null, pendingApproval = null, idleTimer = null;

  function build() {
    if (root) return;
    root = el("div", "rjd-root");
    root.id = "ryujin-drive";
    root.setAttribute("data-state", "idle");
    root.setAttribute("aria-hidden", "true");
    if (location.pathname === "/shell.html") root.classList.add("rjd-on-shell");

    veil = el("div", "rjd-veil");
    cursor = el("div", "rjd-cursor", '<span class="rjd-cursor-ring"></span><span class="rjd-cursor-dot"></span><span class="rjd-cursor-label"></span>');
    rail = el("div", "rjd-rail");
    rail.setAttribute("role", "status");
    rail.setAttribute("aria-live", "polite");
    say = el("div", "rjd-say");
    approvalEl = el("div", "rjd-approval");

    orb = el("button", "rjd-orb", '<span class="rjd-orb-core"></span>');
    orb.type = "button";
    orb.title = "Command Ryujin (Ctrl + .)";
    orb.setAttribute("aria-label", "Command Ryujin");

    cmdForm = el("form", "rjd-cmd");
    cmdInput = el("input", "rjd-cmd-input");
    cmdInput.type = "text";
    cmdInput.placeholder = "Tell Ryujin what to do";
    cmdInput.setAttribute("aria-label", "Command Ryujin");
    cmdInput.autocomplete = "off";
    cmdForm.appendChild(cmdInput);

    root.appendChild(veil);
    root.appendChild(rail);
    root.appendChild(say);
    root.appendChild(approvalEl);
    root.appendChild(cursor);
    root.appendChild(orb);
    root.appendChild(cmdForm);
    document.body.appendChild(root);

    orb.addEventListener("click", toggleCmd);
    cmdForm.addEventListener("submit", function (e) {
      e.preventDefault();
      var q = cmdInput.value.trim();
      if (!q) return;
      cmdInput.value = "";
      closeCmd();
      run(q);
    });
    document.addEventListener("keydown", function (e) {
      if (e.key === "." && (e.ctrlKey || e.metaKey)) { e.preventDefault(); toggleCmd(); }
      else if (e.key === "Escape") { if (root.getAttribute("data-state") === "driving") cancel(); else closeCmd(); }
    });
  }

  function setState(s) { if (root) root.setAttribute("data-state", s); }

  function toggleCmd() {
    if (!root) return;
    if (root.classList.contains("rjd-cmd-open")) closeCmd();
    else { root.classList.add("rjd-cmd-open"); setTimeout(function () { try { cmdInput.focus(); } catch (e) {} }, 30); }
  }
  function closeCmd() { if (root) root.classList.remove("rjd-cmd-open"); }

  // ---- cursor + steps ---------------------------------------------------
  function moveCursor(x, y, label) {
    if (!cursor) return;
    cursor.style.transform = "translate(" + Math.round(x) + "px," + Math.round(y) + "px)";
    var lab = cursor.querySelector(".rjd-cursor-label");
    if (lab) lab.textContent = label || "";
  }
  function moveCursorToEl(node, label) {
    try {
      var r = node.getBoundingClientRect();
      moveCursor(r.left + r.width / 2, r.top + r.height / 2, label);
    } catch (e) {}
  }
  function moveCursorCenter(label) { moveCursor(window.innerWidth / 2, window.innerHeight * 0.42, label); }

  function addStep(id, label) {
    if (!rail) return;
    var row = el("div", "rjd-step rjd-step--run");
    row.setAttribute("data-step", id || ("s" + Date.now()));
    row.innerHTML = '<span class="rjd-step-glyph"></span><span class="rjd-step-label"></span>';
    row.querySelector(".rjd-step-label").textContent = label || "Working";
    rail.appendChild(row);
    steps[row.getAttribute("data-step")] = row;
    // keep the rail short
    while (rail.children.length > 6) rail.removeChild(rail.firstChild);
  }
  function markStep(id, status) {
    var row = steps[id];
    if (!row) { var last = rail && rail.lastChild; row = last; }
    if (!row) return;
    row.classList.remove("rjd-step--run");
    row.classList.add(status === "error" ? "rjd-step--err" : status === "pending_approval" ? "rjd-step--hold" : "rjd-step--ok");
  }

  function presenceSay(text) {
    if (!say) return;
    say.textContent = text || "";
    say.classList.toggle("show", !!text);
  }

  // ---- the run loop -----------------------------------------------------
  function run(command, opts) {
    opts = opts || {};
    try { if (abort) abort.abort(); } catch (e) {}
    abort = (typeof AbortController !== "undefined") ? new AbortController() : null;
    if (idleTimer) { clearTimeout(idleTimer); idleTimer = null; }

    build();
    steps = {}; answerAcc = ""; pendingNav = null; pendingApproval = null;
    if (rail) rail.innerHTML = "";
    approvalEl.innerHTML = ""; approvalEl.classList.remove("show");
    setState("driving");
    root.classList.add("rjd-active");
    moveCursorCenter("");
    presenceSay("");
    addStep("think", "Ryujin is reading the request");

    fetch("/api/chat", {
      method: "POST",
      cache: "no-store",
      headers: headers(),
      body: JSON.stringify({ message: command, current_page: location.pathname, mode: "agent" }),
      signal: abort ? abort.signal : undefined
    }).then(function (resp) {
      if (!resp.ok) throw new Error("chat " + resp.status);
      markStep("think", "ok");
      if (resp.body && resp.body.getReader && typeof TextDecoder !== "undefined") {
        var reader = resp.body.getReader(), dec = new TextDecoder(), buf = "";
        function pump() {
          return reader.read().then(function (res) {
            if (res.done) { if (buf.trim()) handleBlock(buf); finish(); return; }
            buf += dec.decode(res.value, { stream: true });
            var blocks = buf.split(/\r?\n\r?\n/);
            buf = blocks.pop();
            blocks.forEach(handleBlock);
            return pump();
          });
        }
        return pump();
      }
      return resp.text().then(function (txt) { txt.split(/\r?\n\r?\n/).forEach(handleBlock); finish(); });
    }).catch(function (err) {
      if (err && err.name === "AbortError") return;
      markStep("think", "error");
      presenceSay("I could not reach the system just now.");
      goIdle(2600);
    });
  }

  function handleBlock(block) {
    if (!block) return;
    var lines = block.split(/\r?\n/);
    for (var i = 0; i < lines.length; i++) {
      var line = lines[i];
      if (line.indexOf("data:") !== 0) continue;
      var payload = line.slice(5).trim();
      if (!payload || payload === "[DONE]") continue;
      var evt;
      try { evt = JSON.parse(payload); } catch (e) { continue; }
      try { dispatch(evt); } catch (e) {}
    }
  }

  function dispatch(evt) {
    if (evt.text) { answerAcc += evt.text; presenceSay(answerAcc.trim()); }
    if (evt.tool_start) { addStep(evt.tool_start.id, evt.tool_start.label); nudgeCursor(); }
    if (evt.tool_end) {
      if (evt.tool_end.status === "pending_approval" || evt.tool_end.code) {
        pendingApproval = { code: evt.tool_end.code || null, label: lastStepLabel() };
        markStep(evt.tool_end.id, "pending_approval");
      } else {
        markStep(evt.tool_end.id, evt.tool_end.status || "ok");
      }
    }
    if (evt.navigate && evt.navigate.url) { pendingNav = evt.navigate.url; beginTakeoverHint(evt.navigate.url); }
    if (evt.error) { presenceSay(typeof evt.error === "string" ? evt.error : "Something went wrong."); }
    if (evt.done) { /* handled by stream end via finish() */ }
  }

  function lastStepLabel() {
    try { return rail.lastChild.querySelector(".rjd-step-label").textContent; } catch (e) { return "an action"; }
  }
  function nudgeCursor() {
    var x = window.innerWidth * (0.4 + Math.min(0.2, rail ? rail.children.length * 0.03 : 0));
    moveCursor(x, window.innerHeight * 0.5, "");
  }
  function beginTakeoverHint(url) {
    root.classList.add("rjd-takeover");
    moveCursorCenter("Opening " + pageName(url));
  }

  function finish() {
    // firm wall first: an outbound step needs sign-off, so we PAUSE here.
    if (pendingApproval) { showApproval(pendingApproval); return; }
    if (pendingNav) { commitTakeover(pendingNav); return; }
    // pure answer, no navigation
    if (!answerAcc.trim()) presenceSay("Done.");
    markAllRunStepsOk();
    goIdle(4200);
  }
  function markAllRunStepsOk() {
    if (!rail) return;
    [].slice.call(rail.querySelectorAll(".rjd-step--run")).forEach(function (r) {
      r.classList.remove("rjd-step--run"); r.classList.add("rjd-step--ok");
    });
  }

  // ---- the real takeover navigation ------------------------------------
  function commitTakeover(url) {
    markAllRunStepsOk();
    try {
      sessionStorage.setItem(RESUME_KEY, JSON.stringify({
        url: url, answer: answerAcc.trim(), hint: landmarkHint(url), ts: Date.now()
      }));
    } catch (e) {}
    var go = function () { try { window.location.href = url; } catch (e) {} };
    if (REDUCED) { go(); return; }
    root.classList.add("rjd-wipe");
    moveCursorCenter("Opening " + pageName(url));
    setTimeout(go, 620);
  }

  // ---- landing on the destination page ---------------------------------
  function tryLanding() {
    var raw;
    try { raw = sessionStorage.getItem(RESUME_KEY); } catch (e) { return; }
    if (!raw) return;
    try { sessionStorage.removeItem(RESUME_KEY); } catch (e) {}
    var data;
    try { data = JSON.parse(raw); } catch (e) { return; }
    if (!data || (Date.now() - (data.ts || 0)) > RESUME_TTL) return;
    var here = location.pathname.replace(/\.html$/, "");
    var want = (data.url || "").split("?")[0].split("#")[0].replace(/\.html$/, "");
    if (here !== want) return;

    build();
    setState("landing");
    root.classList.add("rjd-active");
    presenceSay(data.answer || "Here it is.");
    var target = findLandmark(data.hint);
    var label = "Here";
    if (REDUCED) { if (target) highlight(target); goIdle(5000); return; }
    if (target) {
      try { target.scrollIntoView({ behavior: "smooth", block: "center" }); } catch (e) {}
      setTimeout(function () { moveCursorToEl(target, label); highlight(target); }, 260);
    } else {
      moveCursorCenter(label);
    }
    goIdle(5200);
  }

  function findLandmark(hint) {
    var sel;
    try {
      if (hint) { sel = document.querySelector('[data-ryujin-landmark="' + cssEscape(hint) + '"]'); if (sel) return sel; }
    } catch (e) {}
    return document.querySelector("[data-ryujin-landmark]") ||
           document.querySelector("main, [role=main], #main, .main") || null;
  }
  function cssEscape(s) { return String(s).replace(/["\\\]]/g, "\\$&"); }
  function highlight(node) {
    try {
      node.classList.add("rjd-target-highlight");
      setTimeout(function () { node.classList.remove("rjd-target-highlight"); }, 2400);
    } catch (e) {}
  }

  // ---- firm-wall approval card -----------------------------------------
  function showApproval(info) {
    setState("approval");
    root.classList.remove("rjd-takeover", "rjd-wipe");
    presenceSay("This needs your sign off before it can go out.");
    approvalEl.innerHTML = "";
    var card = el("div", "rjd-approval-card");
    card.appendChild(el("div", "rjd-approval-title", "Approval required"));
    card.appendChild(el("div", "rjd-approval-body", (info.label || "An outbound action") +
      " is held as a draft. Nothing was sent." + (info.code ? " Code " + escapeHtml(info.code) + "." : "")));
    var row = el("div", "rjd-approval-actions");
    var openBtn = el("a", "rjd-btn rjd-btn--primary", "Review in Approvals");
    openBtn.href = "/approvals.html";
    var dismiss = el("button", "rjd-btn", "Dismiss");
    dismiss.type = "button";
    dismiss.addEventListener("click", function () { goIdle(0); });
    row.appendChild(openBtn); row.appendChild(dismiss);
    card.appendChild(row);
    approvalEl.appendChild(card);
    approvalEl.classList.add("show");
  }
  function escapeHtml(s) { return String(s).replace(/[&<>"]/g, function (c) { return ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]; }); }

  // ---- idle / cancel ----------------------------------------------------
  function goIdle(delay) {
    if (idleTimer) clearTimeout(idleTimer);
    idleTimer = setTimeout(function () {
      setState("idle");
      root.classList.remove("rjd-active", "rjd-takeover", "rjd-wipe");
      presenceSay("");
      if (approvalEl) approvalEl.classList.remove("show");
    }, delay || 0);
  }
  function cancel() {
    try { if (abort) abort.abort(); } catch (e) {}
    goIdle(0);
  }

  // ---- boot -------------------------------------------------------------
  function boot() {
    try {
      build();
      tryLanding();
      window.RyujinDrive = { run: run, open: toggleCmd, close: closeCmd, cancel: cancel };
    } catch (e) { /* fail soft: leave the page untouched */ }
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})();
