// ────────────────────────────────────────────────────────────────────
// Ryujin Scenario — seed data for SANDBOX mode ("Business Manager Sim").
// Fictional Moncton-area roofing business state. Safe to practice on.
//
// RyujinScenario.load()    — install seed data into sandbox store (idempotent)
// RyujinScenario.reset()   — wipe and reinstall
// RyujinScenario.respond() — handle GET requests in sandbox mode
// ────────────────────────────────────────────────────────────────────
(function(){
  const S = window.RyujinScenario = window.RyujinScenario || {};

  const SEED = {
    stats: {
      revenue_ytd: 187420,
      pipeline_open: 94300,
      close_rate: 0.34,
      active_jobs: 3,
      crew_available: 2,
      leads_this_week: 6,
      tickets_open: 4,
      avg_job_value: 14200
    },
    customers: [
      { id: 'sb-c1', name: 'Oakley Wren', address: '88 Pineridge Dr, Moncton NB', phone: '(506) 555-0188', email: 'oakley.wren@example.com', status: 'open', value: 18200, meta: 'Asphalt · mansard · callback needed', last: '2 hours ago' },
      { id: 'sb-c2', name: 'Mira Delacroix', address: '14 Riverbend Crt, Dieppe NB', phone: '(506) 555-0241', email: 'mira.d@example.com', status: 'open', value: 26400, meta: 'Metal SS · insurance claim · inspection booked', last: 'yesterday' },
      { id: 'sb-c3', name: 'Tobias Hargrove', address: '205 Mapleview Rd, Riverview NB', phone: '(506) 555-0312', email: 'tobias.h@example.com', status: 'cold', value: 11800, meta: 'Gold asphalt · ghosted after quote', last: '3 weeks ago' },
      { id: 'sb-c4', name: 'Juniper Cho', address: '43 Lakeshore Ave, Moncton NB', phone: '(506) 555-0407', email: 'juniper.cho@example.com', status: 'won', value: 22100, meta: 'Signed · platinum · scheduled week 24', last: 'Apr 16' },
      { id: 'sb-c5', name: 'Rafael Nunes', address: '9 Harbour Hill, Shediac NB', phone: '(506) 555-0559', email: 'rafael.n@example.com', status: 'open', value: 31600, meta: 'Standing seam · referred by Delacroix', last: 'today' },
      { id: 'sb-c6', name: 'Winifred Brenner', address: '72 Canterbury Pl, Moncton NB', phone: '(506) 555-0663', email: 'wbrenner@example.com', status: 'won', value: 15750, meta: 'Past · 2024 install · referral incoming', last: 'Dec 2024' },
      { id: 'sb-c7', name: 'Sage Ottenberg', address: '118 Corsican Cr, Dieppe NB', phone: '(506) 555-0712', email: 'sage.o@example.com', status: 'open', value: 9800, meta: 'Repair only · estimate sent', last: '4 days ago' },
      { id: 'sb-c8', name: 'Corwin Ashby', address: '26 Wellington St, Riverview NB', phone: '(506) 555-0890', email: 'c.ashby@example.com', status: 'open', value: 19400, meta: 'Full replacement · financing inquiry', last: '6 days ago' }
    ],
    leads: [
      { id: 'sb-l1', name: 'Oakley Wren', meta: 'Moncton · callback needed', value: 18200, stage: 'inspect_scheduled' },
      { id: 'sb-l2', name: 'Mira Delacroix', meta: 'Dieppe · metal SS · insurance', value: 26400, stage: 'proposal_sent' },
      { id: 'sb-l3', name: 'Rafael Nunes', meta: 'Shediac · referred', value: 31600, stage: 'initial_call' },
      { id: 'sb-l4', name: 'Corwin Ashby', meta: 'Riverview · financing', value: 19400, stage: 'proposal_draft' },
      { id: 'sb-l5', name: 'Sage Ottenberg', meta: 'Dieppe · repair only', value: 9800, stage: 'proposal_sent' },
      { id: 'sb-l6', name: 'Margot Stilwell', meta: 'Moncton · cold from website', value: 0, stage: 'new' }
    ],
    jobs: [
      { id: 'sb-j1', customer: 'Juniper Cho', address: '43 Lakeshore Ave, Moncton NB', system: 'asphalt', tier: 'Platinum', sq: 28, total: 22100, status: 'scheduled', start: '2026-05-12', crew: 'Diego + Marcus' },
      { id: 'sb-j2', customer: 'Ezra Faulkner', address: '17 Glendale Terr, Moncton NB', system: 'metal', tier: 'Standing Seam', sq: 24, total: 38400, status: 'in_progress', start: '2026-04-18', crew: 'Diego + Ben + Tony' },
      { id: 'sb-j3', customer: 'Ida Pendergrass', address: '91 Old Coach Rd, Riverview NB', system: 'asphalt', tier: 'Gold', sq: 22, total: 12900, status: 'closeout', start: '2026-04-08', crew: 'Marcus + Tony' }
    ],
    tickets: [
      { id: 'sb-t1', title: 'Return Cho\'s callback re: color samples', customer: 'Juniper Cho', priority: 'high', due: 'today', status: 'open' },
      { id: 'sb-t2', title: 'Order material for Faulkner job', customer: 'Ezra Faulkner', priority: 'high', due: 'today', status: 'open' },
      { id: 'sb-t3', title: 'Send invoice to Pendergrass', customer: 'Ida Pendergrass', priority: 'med', due: 'tomorrow', status: 'open' },
      { id: 'sb-t4', title: 'Follow up with Hargrove (cold lead)', customer: 'Tobias Hargrove', priority: 'low', due: 'this week', status: 'open' }
    ],
    follow_ups: [
      { id: 'sb-f1', name: 'Tobias Hargrove', type: 'call', note: '3 weeks since quote · re-engage', due: 'today', status: 'overdue' },
      { id: 'sb-f2', name: 'Oakley Wren', type: 'sms', note: 'Confirm inspection time', due: 'today', status: 'due' },
      { id: 'sb-f3', name: 'Corwin Ashby', type: 'email', note: 'Financing pre-approval sent — check in', due: 'tomorrow', status: 'upcoming' },
      { id: 'sb-f4', name: 'Sage Ottenberg', type: 'call', note: 'Proposal expires in 3 days', due: 'in 2 days', status: 'upcoming' }
    ],
    alerts: [
      { level: 'warning', msg: 'Tobias Hargrove follow-up is 3 weeks overdue.' },
      { level: 'info', msg: 'Ezra Faulkner job starts tomorrow — material ETA on track.' },
      { level: 'success', msg: 'Juniper Cho signed platinum — $22.1K added to pipeline.' }
    ]
  };

  function NS(){ return 'ry_sb_'; }
  function save(k, v){ try { localStorage.setItem(NS() + k, JSON.stringify(v)); } catch(e){} }
  function load(k){ try { const r = localStorage.getItem(NS() + k); return r ? JSON.parse(r) : null; } catch(e){ return null; } }

  S.load = function(){
    // Idempotent: only seed if empty
    if (!load('seeded')) {
      Object.entries(SEED).forEach(([k, v]) => save(k, v));
      save('seeded', { at: Date.now() });
    }
    return true;
  };

  S.reset = function(){
    // Wipe everything in sandbox namespace
    try {
      Object.keys(localStorage).filter(k => k.startsWith('ry_sb_')).forEach(k => localStorage.removeItem(k));
    } catch(e){}
    S.load();
  };

  S.data = () => ({ ...SEED, ...Object.fromEntries(Object.keys(SEED).map(k => [k, load(k) || SEED[k]])) });

  // Mock GET responder
  S.respond = function(path){
    S.load();
    const p = path.split('?')[0];
    if (p.endsWith('/api/customers') || p.includes('/api/customers')) return { data: load('customers') || SEED.customers };
    if (p.includes('/api/leads') || p.includes('/api/pipeline')) return { data: load('leads') || SEED.leads };
    if (p.includes('/api/jobs') || p.includes('/api/projects')) return { data: load('jobs') || SEED.jobs };
    if (p.includes('/api/tickets')) return { data: load('tickets') || SEED.tickets };
    if (p.includes('/api/followups') || p.includes('/api/follow-ups')) return { data: load('follow_ups') || SEED.follow_ups };
    if (p.includes('/api/stats') || p.includes('/api/snapshot')) return { stats: load('stats') || SEED.stats, alerts: load('alerts') || SEED.alerts };
    return { data: [], sandbox: true, note: 'No mock for ' + path };
  };

  // Auto-seed on script load so sandbox mode works instantly
  if (window.RyujinMode && window.RyujinMode.isSandbox()) S.load();
})();
