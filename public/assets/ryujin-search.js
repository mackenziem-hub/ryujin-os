// Global Ryujin search overlay.
// Press "/" anywhere (except inside a text input) to open.
// Searches: hardcoded business index (customers / deals / jobs / follow-ups / tools).
// Enter opens the result. Esc closes.
(function(){
  const INDEX = [
    // Sector shortcuts
    { type:'sector', label:'Dashboard', sub:'live AI command center', url:'dashboard-v2.html', tag:'DASH' },
    { type:'sector', label:'Marketing', sub:'ads \u00B7 campaigns \u00B7 creatives \u00B7 leads \u00B7 strategy', url:'marketing.html', tag:'MKT' },
    { type:'sector', label:'Sales', sub:'pipeline \u00B7 proposals \u00B7 follow-ups \u00B7 customers \u00B7 transcripts', url:'sales.html', tag:'SLS' },
    { type:'sector', label:'Production', sub:'jobs \u00B7 schedule \u00B7 pay sheets \u00B7 materials', url:'production.html', tag:'PROD' },
    { type:'sector', label:'Post-Production', sub:'close-out \u00B7 walk-through \u00B7 reviews \u00B7 warranties', url:'post-production.html', tag:'POST' },
    { type:'sector', label:'Administration', sub:'pricing \u00B7 team \u00B7 integrations', url:'administration.html', tag:'ADMIN' },
    // Tools
    { type:'tool', label:'New Proposal', sub:'generate a customer proposal', url:'sales-proposal.html', tag:'PROP' },
    { type:'tool', label:'Pay Sheet Generator', sub:'sub contractor pay', url:'production-paysheet.html', tag:'PAY' },
    { type:'tool', label:'Campaign Creator', sub:'launch a new ad campaign', url:'marketing-campaign.html', tag:'CAMP' },
    { type:'tool', label:'Walk-Through Tool', sub:'14-point checklist + signature', url:'post-production-walkthrough.html', tag:'WALK' },
    { type:'tool', label:'Pricing Engine Editor', sub:'edit tenant rates live', url:'admin-pricing.html', tag:'PRICE' },
    { type:'tool', label:'Marketing Strategy', sub:'Hormozi Core Four \u00B7 Martell hierarchy', url:'marketing-strategy.html', tag:'STRAT' },
    // Customers (the hot ones)
    { type:'customer', label:'Robert Partridge', sub:'Moncton \u00B7 $44.4K \u00B7 quote sent \u00B7 3 views', url:'sales-customers.html#partridge', tag:'CUST' },
    { type:'customer', label:'Shelagh Peach', sub:'Moncton \u00B7 $19.7K \u00B7 Darcy presenting Apr 20', url:'sales-customers.html#peach', tag:'CUST' },
    { type:'customer', label:'Nadine Lipton', sub:'Dieppe \u00B7 $27.4K \u00B7 metal SS \u00B7 cooling', url:'sales-customers.html#lipton', tag:'CUST' },
    { type:'customer', label:'Diaa Juha', sub:'Moncton \u00B7 $20.5K \u00B7 cooling 5d', url:'sales-customers.html#juha', tag:'CUST' },
    { type:'customer', label:'APHL \u00B7 Kevin Chase', sub:'Riverview \u00B7 $16.2K \u00B7 Tara Court', url:'sales-customers.html#aphl', tag:'CUST' },
    { type:'customer', label:'Richard Seyeau', sub:'Shediac \u00B7 $29.9K \u00B7 Edgewater complete', url:'sales-customers.html#seyeau', tag:'CUST' },
    { type:'customer', label:'Jim Faulkner', sub:'178 Summerhill \u00B7 $18.4K \u00B7 scheduled Wed', url:'sales-customers.html#faulkner', tag:'CUST' },
    { type:'customer', label:'Northrup', sub:'repair \u00B7 $3.1K \u00B7 paid', url:'sales-customers.html#northrup', tag:'CUST' },
    // Jobs
    { type:'job', label:'10 Edgewater \u00B7 Seyeau', sub:'mansard + caulk \u00B7 Diego', url:'production-jobs.html', tag:'JOB' },
    { type:'job', label:'105 Rue Fortune', sub:'asphalt \u00B7 AJ starting', url:'production-jobs.html', tag:'JOB' },
    { type:'job', label:'178 Summerhill \u00B7 Faulkner', sub:'pushed Wed \u00B7 3-day window', url:'production-jobs.html', tag:'JOB' },
    { type:'job', label:'810 Route 124 \u00B7 Gould', sub:'repair \u00B7 overdue 2d', url:'production-jobs.html', tag:'JOB' },
    // Follow-ups / high-priority actions
    { type:'action', label:'Handle Gould overdue', sub:'apologize + reassign Friday', url:'sales-followups.html#gould', tag:'ACT' },
    { type:'action', label:'Ben Crocker Zoom', sub:'Tue 1 PM \u00B7 NanoSeal partnership', url:'sales-followups.html#crocker', tag:'ACT' },
    { type:'action', label:'Ulnooweg IYE follow-up', sub:'Apr 22 \u00B7 $25K funding app', url:'sales-followups.html#ulnooweg', tag:'ACT' }
  ];

  const STYLES = `
  #rs-overlay{position:fixed;inset:0;z-index:9800;display:none;align-items:flex-start;justify-content:center;padding-top:90px;font-family:'Inter',system-ui,sans-serif}
  #rs-overlay.on{display:flex}
  #rs-bd{position:absolute;inset:0;background:rgba(3,6,17,0.78);backdrop-filter:blur(8px)}
  #rs-card{position:relative;width:min(620px,calc(100vw - 32px));background:rgba(10,18,34,0.96);border:1px solid rgba(34,211,238,0.35);border-radius:14px;backdrop-filter:blur(20px);box-shadow:0 24px 70px rgba(0,0,0,0.65),0 0 40px rgba(34,211,238,0.15);overflow:hidden;animation:rsPop 0.2s cubic-bezier(.2,.8,.3,1.05)}
  @keyframes rsPop{from{opacity:0;transform:translateY(-8px) scale(0.98)}to{opacity:1;transform:translateY(0) scale(1)}}
  #rs-card::before{content:'';position:absolute;top:0;left:0;right:0;height:2px;background:linear-gradient(90deg,transparent,#22d3ee,#7c3aed,transparent);opacity:0.7}
  #rs-input{width:100%;padding:18px 22px;background:transparent;border:none;border-bottom:1px solid rgba(34,211,238,0.15);color:#e0e6f0;font-family:inherit;font-size:1em;outline:none}
  #rs-input::placeholder{color:rgba(160,190,230,0.4)}
  #rs-results{max-height:60vh;overflow-y:auto}
  .rs-row{display:flex;align-items:center;gap:12px;padding:11px 18px;cursor:pointer;border-bottom:1px solid rgba(34,211,238,0.06);transition:background 0.15s}
  .rs-row:last-child{border:none}
  .rs-row.on,.rs-row:hover{background:rgba(34,211,238,0.09)}
  .rs-tag{font-family:'Orbitron',sans-serif;font-size:0.55em;font-weight:800;letter-spacing:1.2px;padding:3px 8px;border-radius:5px;min-width:46px;text-align:center;flex-shrink:0}
  .rs-tag.DASH,.rs-tag.SLS,.rs-tag.PROP,.rs-tag.CUST{background:rgba(34,211,238,0.12);color:#22d3ee;border:1px solid rgba(34,211,238,0.3)}
  .rs-tag.MKT,.rs-tag.CAMP,.rs-tag.STRAT{background:rgba(124,58,237,0.12);color:#a78bfa;border:1px solid rgba(124,58,237,0.3)}
  .rs-tag.PROD,.rs-tag.JOB,.rs-tag.PAY{background:rgba(251,146,60,0.12);color:#fb923c;border:1px solid rgba(251,146,60,0.3)}
  .rs-tag.POST,.rs-tag.WALK{background:rgba(74,222,128,0.12);color:#4ade80;border:1px solid rgba(74,222,128,0.3)}
  .rs-tag.ADMIN,.rs-tag.PRICE{background:rgba(74,158,255,0.12);color:#4a9eff;border:1px solid rgba(74,158,255,0.3)}
  .rs-tag.ACT{background:rgba(250,204,21,0.12);color:#facc15;border:1px solid rgba(250,204,21,0.3)}
  .rs-body{flex:1;min-width:0}
  .rs-label{font-size:0.88em;font-weight:600;color:#e0e6f0}
  .rs-sub{font-size:0.72em;color:rgba(160,190,230,0.62);font-family:'Share Tech Mono',monospace;letter-spacing:0.3px;margin-top:2px}
  .rs-hint{padding:10px 18px;font-family:'Share Tech Mono',monospace;font-size:0.64em;color:rgba(160,190,230,0.35);letter-spacing:1px;background:rgba(6,10,20,0.4);border-top:1px solid rgba(34,211,238,0.08);display:flex;justify-content:space-between}
  .rs-hint kbd{padding:1px 6px;background:rgba(34,211,238,0.08);border:1px solid rgba(34,211,238,0.2);border-radius:3px;color:#22d3ee;margin:0 2px}
  .rs-empty{padding:40px 20px;text-align:center;color:rgba(160,190,230,0.4);font-size:0.82em;font-family:'Share Tech Mono',monospace}
  `;

  let selected = 0;
  let results = [];
  function inject(){
    if (document.getElementById('rs-overlay')) return;
    const s = document.createElement('style'); s.textContent = STYLES; document.head.appendChild(s);
    const root = document.createElement('div');
    root.id = 'rs-overlay';
    root.innerHTML = `
      <div id="rs-bd"></div>
      <div id="rs-card">
        <input id="rs-input" type="text" placeholder="Search customers, jobs, tools, or type a sector name..." autocomplete="off"/>
        <div id="rs-results"></div>
        <div class="rs-hint">
          <span><kbd>\u2191</kbd><kbd>\u2193</kbd> navigate \u00B7 <kbd>Enter</kbd> open \u00B7 <kbd>Esc</kbd> close</span>
          <span>Press <kbd>/</kbd> anywhere to open</span>
        </div>
      </div>`;
    document.body.appendChild(root);
    root.querySelector('#rs-bd').addEventListener('click', close);
    document.getElementById('rs-input').addEventListener('input', e => render(e.target.value));
    document.getElementById('rs-input').addEventListener('keydown', onKey);
  }
  function open(){
    inject();
    document.getElementById('rs-overlay').classList.add('on');
    const input = document.getElementById('rs-input');
    input.value = ''; input.focus();
    render('');
  }
  function close(){ const o = document.getElementById('rs-overlay'); if (o) o.classList.remove('on'); }
  function render(q){
    const lower = (q || '').toLowerCase();
    results = lower ? INDEX.filter(r => (r.label + ' ' + r.sub + ' ' + r.type + ' ' + r.tag).toLowerCase().includes(lower)) : INDEX.slice(0, 12);
    selected = 0;
    const el = document.getElementById('rs-results');
    if (!results.length) { el.innerHTML = '<div class="rs-empty">No matches. Try a customer name or a sector word.</div>'; return; }
    el.innerHTML = results.map((r, i) =>
      `<div class="rs-row ${i === 0 ? 'on' : ''}" data-idx="${i}"><div class="rs-tag ${r.tag}">${r.tag}</div><div class="rs-body"><div class="rs-label">${r.label}</div><div class="rs-sub">${r.sub}</div></div></div>`
    ).join('');
    el.querySelectorAll('.rs-row').forEach(row => {
      row.addEventListener('mouseenter', () => setSelected(parseInt(row.dataset.idx, 10)));
      row.addEventListener('click', () => go(parseInt(row.dataset.idx, 10)));
    });
  }
  function setSelected(i){
    selected = Math.max(0, Math.min(results.length - 1, i));
    document.querySelectorAll('.rs-row').forEach((row, idx) => row.classList.toggle('on', idx === selected));
    const on = document.querySelector('.rs-row.on');
    if (on) on.scrollIntoView({ block: 'nearest' });
  }
  function go(i){
    const r = results[i];
    if (!r) return;
    close();
    setTimeout(() => { window.location.href = r.url; }, 120);
  }
  function onKey(e){
    if (e.key === 'ArrowDown') { e.preventDefault(); setSelected(selected + 1); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setSelected(selected - 1); }
    else if (e.key === 'Enter') { e.preventDefault(); go(selected); }
    else if (e.key === 'Escape') { e.preventDefault(); close(); }
  }

  document.addEventListener('keydown', e => {
    // Skip if user is typing in an input/textarea (except trigger "/")
    const t = e.target.tagName;
    const inField = t === 'INPUT' || t === 'TEXTAREA' || e.target.isContentEditable;
    if (e.key === '/' && !inField) { e.preventDefault(); open(); }
  });
  window.RyujinSearch = { open, close };
})();
