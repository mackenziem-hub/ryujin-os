// ────────────────────────────────────────────────────────────────────
// Ryujin Auto-Tutor — drop-in for any tool page that doesn't have a
// bespoke tutorial yet. Scans the DOM for obvious anchors (topbar title,
// first main panel, action buttons) and registers a 3-4 step tour.
// Usage: include AFTER ryujin-tutor.js. No manual wiring needed.
// Override with <meta name="ry-page" content="my-page-id"> if desired.
// ────────────────────────────────────────────────────────────────────
(function(){
  if (!window.RyujinTutor) return;
  // Wait a tick so bespoke tutorials register first, then skip if any exist
  setTimeout(run, 80);
  function run(){
  if (window.RyujinTutor.any && window.RyujinTutor.any()) return;

  // Skip on command-center (has its own) and hub shells (subhub handles it)
  const path = location.pathname.split('/').pop() || 'index.html';
  const SKIP = ['command-center.html','boot.html','login.html','onboarding.html','index.html','landing.html','proposal-client.html','sales.html','marketing.html','production.html','post-production.html','administration.html'];
  if (SKIP.includes(path)) return;

  const meta = document.querySelector('meta[name="ry-page"]');
  const pageId = meta ? meta.content : path.replace(/\.html$/, '');

  // Infer a nice label from the page filename
  const parts = pageId.split('-');
  const parent = parts[0]; // sales, marketing, production, post, admin
  const tool = parts.slice(1).join(' ').toUpperCase() || pageId.toUpperCase();

  // Find anchors lazily
  function anchorOrCenter(sel){
    return document.querySelector(sel) ? sel : '__center__';
  }

  const steps = [
    {
      target: anchorOrCenter('.tb-title, .proposal-title, .topbar h1, .topbar .brand-name, .section-title'),
      title: tool + ' is online.',
      body: 'This is your dedicated <b>' + tool.toLowerCase() + '</b> workspace. Everything you need for this job is on this page.',
      position: 'bottom'
    },
    {
      target: anchorOrCenter('.panel, .content, main, .main, .grid'),
      title: 'Your live data',
      body: 'The panels below are wired to <b>real systems</b> (GHL, Supabase, Vercel). Click, edit, or drag items — everything auto-saves.',
      position: 'right'
    },
    {
      target: anchorOrCenter('.btn.success, .btn.primary, button[class*=primary]'),
      title: 'Ship it',
      body: 'Primary action is highlighted. <b>Right-click</b> or press <b>Esc</b> to go back. Press <b>/</b> to search, <b>?</b> to replay this tour.',
      position: 'left'
    },
    {
      target: '__center__',
      title: 'You\'re operational.',
      body: 'Need a refresher anytime — just press <b>?</b>. The dragon\'s always listening.',
      position: 'top'
    }
  ];

  RyujinTutor.register(pageId, steps);
  // Do NOT auto-fire — user presses ? when they want the walkthrough.
  // Manual replay hotkey
  document.addEventListener('keydown', e => {
    if ((e.key === '?' || e.key === 'h' || e.key === 'H') && !e.ctrlKey && !e.metaKey) {
      const tag = (document.activeElement && document.activeElement.tagName) || '';
      if (/^(INPUT|TEXTAREA|SELECT)$/.test(tag)) return;
      e.preventDefault();
      RyujinTutor.start(pageId);
    }
  });
  }
})();
