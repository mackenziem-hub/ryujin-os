// ────────────────────────────────────────────────────────────────────
// Ryujin XP — SANDBOX-only progression tracker.
// Only awards in sandbox mode so real work doesn't inflate score.
// ────────────────────────────────────────────────────────────────────
(function(){
  const XP = window.RyujinXP = window.RyujinXP || {};

  // Level curve: L1=0, L2=100, L3=250, L4=450, L5=700, L6=1000, L7=1400, L8=1900, L9=2500, L10=3200, then +800/level
  const LEVELS = [0, 100, 250, 450, 700, 1000, 1400, 1900, 2500, 3200];
  function xpForLevel(n){
    if (n < LEVELS.length) return LEVELS[n];
    return LEVELS[LEVELS.length-1] + (n - LEVELS.length + 1) * 800;
  }

  const KEY = 'ry_sb_xp'; // XP is tracked exclusively in sandbox namespace

  function getXP(){
    try { return JSON.parse(localStorage.getItem(KEY) || '0'); } catch(e){ return 0; }
  }
  function setXP(v){
    try { localStorage.setItem(KEY, JSON.stringify(v)); } catch(e){}
  }
  function getLevel(){
    const xp = getXP();
    let lvl = 1;
    while (xpForLevel(lvl + 1) <= xp) lvl++;
    return lvl;
  }
  function progress(){
    const xp = getXP();
    const lvl = getLevel();
    const curr = xpForLevel(lvl);
    const next = xpForLevel(lvl + 1);
    return { xp, level: lvl, curr, next, pct: ((xp - curr) / (next - curr)) * 100 };
  }

  function award(reason, amount){
    if (!window.RyujinMode || !window.RyujinMode.isSandbox()) return null;
    const before = getXP();
    const beforeLevel = getLevel();
    const after = before + (amount || 0);
    setXP(after);
    const afterLevel = getLevel();
    // Log
    try {
      const log = JSON.parse(localStorage.getItem('ry_sb_xp_log') || '[]');
      log.push({ reason, amount, at: Date.now(), total: after });
      localStorage.setItem('ry_sb_xp_log', JSON.stringify(log.slice(-200)));
    } catch(e){}
    // Fire events
    document.dispatchEvent(new CustomEvent('ryujin-xp-gain', { detail: { reason, amount, total: after } }));
    if (afterLevel > beforeLevel) {
      document.dispatchEvent(new CustomEvent('ryujin-level-up', { detail: { level: afterLevel } }));
      showLevelUp(afterLevel);
    } else if (amount > 0) {
      showXPGain(amount, reason);
    }
    return { xp: after, level: afterLevel, levelUp: afterLevel > beforeLevel };
  }

  function reset(){
    setXP(0);
    try { localStorage.removeItem('ry_sb_xp_log'); } catch(e){}
    document.dispatchEvent(new CustomEvent('ryujin-xp-reset'));
  }

  function showXPGain(amount, reason){
    const el = document.createElement('div');
    el.textContent = '+' + amount + ' XP' + (reason ? ' · ' + reason : '');
    el.style.cssText = 'position:fixed;bottom:80px;right:28px;z-index:9998;background:rgba(250,204,21,0.18);border:1px solid rgba(250,204,21,0.6);color:#facc15;padding:8px 16px;border-radius:9px;font-family:Orbitron,sans-serif;font-size:0.7em;font-weight:800;letter-spacing:1.5px;box-shadow:0 0 20px rgba(250,204,21,0.3),0 6px 20px rgba(0,0,0,0.5);pointer-events:none;opacity:0;transform:translateY(10px);transition:all 0.35s cubic-bezier(.2,.8,.3,1)';
    document.body.appendChild(el);
    requestAnimationFrame(() => { el.style.opacity = '1'; el.style.transform = 'translateY(0)'; });
    setTimeout(() => { el.style.opacity = '0'; el.style.transform = 'translateY(-20px)'; setTimeout(() => el.remove(), 400); }, 1800);
  }

  function showLevelUp(level){
    const el = document.createElement('div');
    el.innerHTML = '<div style="font-size:0.6em;letter-spacing:3px;color:rgba(200,220,255,0.7);margin-bottom:6px">LEVEL UP</div><div style="font-family:Orbitron,sans-serif;font-weight:900;font-size:3em;letter-spacing:2px;background:linear-gradient(135deg,#facc15,#22d3ee);-webkit-background-clip:text;-webkit-text-fill-color:transparent">L' + level + '</div>';
    el.style.cssText = 'position:fixed;top:50%;left:50%;transform:translate(-50%,-50%) scale(0.7);z-index:9999;background:rgba(6,12,24,0.98);border:2px solid #facc15;padding:28px 54px;border-radius:16px;text-align:center;box-shadow:0 0 60px rgba(250,204,21,0.6),0 0 120px rgba(250,204,21,0.3),0 20px 60px rgba(0,0,0,0.6);pointer-events:none;opacity:0;transition:all 0.5s cubic-bezier(.2,.7,.3,1.3)';
    document.body.appendChild(el);
    requestAnimationFrame(() => { el.style.opacity = '1'; el.style.transform = 'translate(-50%,-50%) scale(1)'; });
    setTimeout(() => { el.style.opacity = '0'; el.style.transform = 'translate(-50%,-50%) scale(1.3)'; setTimeout(() => el.remove(), 600); }, 2200);
  }

  XP.getXP = getXP;
  XP.getLevel = getLevel;
  XP.progress = progress;
  XP.award = award;
  XP.reset = reset;
  XP.xpForLevel = xpForLevel;
})();
