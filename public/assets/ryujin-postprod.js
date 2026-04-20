// ──────────────────────────────────────────────────────────────
// Ryujin post-production pipeline state
// Connects walkthrough → closeout → reviews → warranty → complete
// State lives in localStorage under `ry_v1_post_prod_queue_v1`
// Shape: { [jobId]: {
//   jobId, customer, address, scope,
//   stage: 'closeout'|'reviews'|'warranty'|'complete',
//   walkthroughAt?, closeoutAt?, reviewSentAt?, warrantyFiledAt?, completedAt?
// } }
// ──────────────────────────────────────────────────────────────
(function(){
  const KEY = 'ry_v1_post_prod_queue_v1';

  function load(){
    try { return JSON.parse(localStorage.getItem(KEY) || '{}'); } catch(e){ return {}; }
  }
  function save(q){
    try { localStorage.setItem(KEY, JSON.stringify(q)); } catch(e){}
  }

  const STAGES = ['closeout','reviews','warranty','complete'];

  window.PostProd = {
    all: load,
    list(stage){
      const q = load();
      return Object.values(q).filter(j => j.stage === stage);
    },
    get(jobId){
      return load()[jobId] || null;
    },
    // Advance a job to `stage` with optional metadata
    advance(jobId, stage, meta = {}){
      if (!jobId) return null;
      const q = load();
      const existing = q[jobId] || { jobId, createdAt: new Date().toISOString() };
      const now = new Date().toISOString();
      const timestamps = {};
      if (stage === 'closeout')  timestamps.walkthroughAt    = now;
      if (stage === 'reviews')   timestamps.closeoutAt       = now;
      if (stage === 'warranty')  timestamps.reviewSentAt     = now;
      if (stage === 'complete')  timestamps.warrantyFiledAt  = now;
      q[jobId] = { ...existing, ...meta, ...timestamps, stage };
      save(q);
      return q[jobId];
    },
    // Remove a job from the pipeline entirely
    remove(jobId){
      const q = load();
      delete q[jobId];
      save(q);
    },
    // Render a small "next up" strip — caller supplies a container id + which stage to show
    renderStrip(containerId, stage, opts = {}){
      const el = document.getElementById(containerId);
      if (!el) return;
      const items = this.list(stage);
      if (!items.length) {
        el.innerHTML = '<div style="padding:10px 14px;font-family:\'Share Tech Mono\',monospace;font-size:0.72em;color:rgba(160,190,230,0.4);letter-spacing:1px">NO JOBS IN QUEUE · ' + stage.toUpperCase() + '</div>';
        return;
      }
      const label = opts.label || ('⟨ QUEUE · ' + stage.toUpperCase() + ' ⟩ ' + items.length);
      el.innerHTML = '<div style="padding:10px 14px;font-family:\'Share Tech Mono\',monospace;font-size:0.74em;color:var(--accent,#4ade80);letter-spacing:1.2px;border-bottom:1px solid rgba(74,222,128,0.15)">' + label + '</div>' +
        items.map(j => {
          const prev = j.walkthroughAt || j.closeoutAt || j.reviewSentAt || '';
          const prevDate = prev ? new Date(prev).toLocaleDateString('en-US',{month:'short',day:'numeric'}) : '';
          return '<div style="padding:8px 14px;border-bottom:1px solid rgba(255,255,255,0.04);display:flex;justify-content:space-between;align-items:center;font-size:0.82em">' +
            '<div><b>' + (j.customer || j.jobId) + '</b>' + (j.address ? ' <span style="color:rgba(160,190,230,0.5);font-size:0.88em">' + j.address + '</span>' : '') + '</div>' +
            '<div style="font-family:\'Share Tech Mono\',monospace;font-size:0.72em;color:rgba(160,190,230,0.5);letter-spacing:0.5px">' + prevDate + '</div>' +
          '</div>';
        }).join('');
    },
    STAGES
  };
})();
