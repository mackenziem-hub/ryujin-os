/*
 * Ryujin OS · Agent dock
 *
 * Self-mounting persistent chat surface for the internal portal layer.
 * Sits across all three view modes (Graph, Canvas, River). Collapsed
 * as a FAB at bottom-right by default; expands to a right-side dock.
 *
 * Phase 1 scope: visual shell + composer + suggestion chips + local
 * echo so users can experience the interaction. Real backend wiring
 * happens later by listening for the 'rj-agent-send' event.
 *
 * Drop-in usage:
 *   <link rel="stylesheet" href="/assets/agent-dock.css">
 *   <script type="module" src="/assets/agent-dock.js"></script>
 *
 * Public API:
 *   window.RyujinAgent.open();
 *   window.RyujinAgent.close();
 *   window.RyujinAgent.toggle();
 *   window.RyujinAgent.send(text);       // dispatches and echoes
 *   window.RyujinAgent.append(role, html); // role: 'user' | 'agent' | 'meta'
 *
 * Events:
 *   'rj-agent-send'   { text }          // user submitted; wire to backend
 *   'rj-agent-toggle' { open: boolean }
 */

const OPEN_STORAGE_KEY = 'ry_agent_dock_open';

const EMBLEM_SVG = `<svg viewBox="0 0 28 16" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" aria-hidden="true">
  <path d="M2 8 Q 7 1 12 8 Q 17 15 22 8 Q 26 3 26 3"/>
  <circle cx="14" cy="8" r="1.8" fill="currentColor"/>
</svg>`;

const SEND_SVG = `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
  <path d="M2 8 L 14 8 M 9 3 L 14 8 L 9 13"/>
</svg>`;

const DEFAULT_SUGGESTIONS = [
  'Where are we on today\'s queue?',
  'Pull MTD signed total',
  'Draft a follow-up'
];

const STUB_GREETING = 'I can pull anything from across your business. Try one of the chips, or ask freely.';

function el(tag, props = {}, children = []) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k === 'class') node.className = v;
    else if (k === 'html') node.innerHTML = v;
    else if (k.startsWith('on') && typeof v === 'function') node.addEventListener(k.slice(2), v);
    else if (v !== undefined && v !== null) node.setAttribute(k, v);
  }
  for (const child of [].concat(children)) {
    if (child == null) continue;
    node.appendChild(typeof child === 'string' ? document.createTextNode(child) : child);
  }
  return node;
}

function nowLabel() {
  const d = new Date();
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

let dockEl = null;
let threadEl = null;
let inputEl = null;
let sendBtnEl = null;

function readOpen() {
  try { return localStorage.getItem(OPEN_STORAGE_KEY) === 'true'; }
  catch { return false; }
}

function writeOpen(open) {
  try { localStorage.setItem(OPEN_STORAGE_KEY, String(open)); } catch { /* ignore */ }
}

function setOpen(open) {
  if (!dockEl) return;
  dockEl.setAttribute('data-open', String(!!open));
  document.body.classList.toggle('rj-agent-open', !!open);
  writeOpen(open);
  document.dispatchEvent(new CustomEvent('rj-agent-toggle', { detail: { open: !!open } }));
  if (open) {
    setTimeout(() => inputEl?.focus(), 60);
    scrollThreadToBottom();
  }
}

function isOpen() {
  return dockEl?.getAttribute('data-open') === 'true';
}

function scrollThreadToBottom() {
  if (!threadEl) return;
  requestAnimationFrame(() => { threadEl.scrollTop = threadEl.scrollHeight; });
}

function append(role, htmlOrText) {
  if (!threadEl) return;
  const classMap = { user: 'rj-msg rj-msg-user', agent: 'rj-msg rj-msg-agent', meta: 'rj-msg-meta' };
  const cls = classMap[role] || classMap.agent;
  const node = el('div', { class: cls, html: String(htmlOrText) });
  threadEl.appendChild(node);
  scrollThreadToBottom();
  return node;
}

function send(text) {
  const trimmed = String(text || '').trim();
  if (!trimmed) return;
  append('user', escapeHtml(trimmed));
  document.dispatchEvent(new CustomEvent('rj-agent-send', { detail: { text: trimmed } }));
  // Phase 1 stub: local echo so the dock feels alive.
  setTimeout(() => {
    append('agent', `Heard. (Phase 1 stub: agent backend wires in next phase.) You said: <em>${escapeHtml(trimmed)}</em>`);
  }, 320);
  if (inputEl) inputEl.value = '';
  updateSendDisabled();
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function updateSendDisabled() {
  if (!sendBtnEl || !inputEl) return;
  sendBtnEl.disabled = inputEl.value.trim().length === 0;
}

function buildSuggestionChips() {
  const chips = el('div', { class: 'rj-agent-suggestions' });
  DEFAULT_SUGGESTIONS.forEach((label) => {
    chips.appendChild(el('button', {
      class: 'rj-agent-chip',
      type: 'button',
      onclick: () => send(label)
    }, label));
  });
  return chips;
}

function buildComposer() {
  inputEl = el('textarea', {
    class: 'rj-agent-input',
    placeholder: 'Ask Ryujin anything...',
    rows: '1',
    'aria-label': 'Message Ryujin agent',
    oninput: (e) => {
      e.target.style.height = 'auto';
      e.target.style.height = Math.min(120, e.target.scrollHeight) + 'px';
      updateSendDisabled();
    },
    onkeydown: (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        send(inputEl.value);
      }
    }
  });
  sendBtnEl = el('button', {
    class: 'rj-agent-send',
    type: 'button',
    'aria-label': 'Send',
    html: SEND_SVG,
    disabled: 'disabled',
    onclick: () => send(inputEl.value)
  });
  return el('div', { class: 'rj-agent-composer' }, [inputEl, sendBtnEl]);
}

function buildPanel() {
  threadEl = el('div', { class: 'rj-agent-thread', 'aria-live': 'polite' });
  append('meta', `Agent ready · ${nowLabel()}`);
  append('agent', STUB_GREETING);

  const header = el('div', { class: 'rj-agent-header' }, [
    el('div', { class: 'rj-agent-title' }, [
      el('span', { html: EMBLEM_SVG }),
      'Agent',
      el('span', { class: 'status' }, 'online')
    ]),
    el('button', {
      class: 'rj-agent-close',
      type: 'button',
      'aria-label': 'Close agent dock',
      onclick: () => setOpen(false)
    }, '×')
  ]);

  return el('div', { class: 'rj-agent-panel' }, [
    header,
    threadEl,
    buildSuggestionChips(),
    buildComposer()
  ]);
}

function buildFab() {
  return el('button', {
    class: 'rj-agent-fab',
    type: 'button',
    'aria-label': 'Open Ryujin agent',
    html: EMBLEM_SVG,
    onclick: () => setOpen(true)
  });
}

function init() {
  // Avoid double-mounting if the script runs twice.
  if (document.querySelector('.rj-agent-dock')) return;

  dockEl = el('div', { class: 'rj-agent-dock', 'data-open': 'false' });
  dockEl.appendChild(buildFab());
  dockEl.appendChild(buildPanel());
  document.body.appendChild(dockEl);

  setOpen(readOpen());
  updateSendDisabled();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}

window.RyujinAgent = Object.freeze({
  open:   () => setOpen(true),
  close:  () => setOpen(false),
  toggle: () => setOpen(!isOpen()),
  send,
  append,
  isOpen
});
