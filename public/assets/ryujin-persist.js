// Tiny shared helper for local persistence + native action links.
// window.RyujinStore.save('key', obj) / load('key', fallback)
// window.RyujinActions.call(tel) / sms(tel, body) / email(to, subject, body)
(function(){
  // Mode-aware namespace: 'ry_v1_' in live, 'ry_sb_' in sandbox.
  // Falls back to 'ry_v1_' if RyujinMode isn't loaded yet.
  function NS(){
    return (window.RyujinMode && window.RyujinMode.nsPrefix) ? window.RyujinMode.nsPrefix() : 'ry_v1_';
  }
  window.RyujinStore = {
    save(key, value){ try { localStorage.setItem(NS() + key, JSON.stringify(value)); return true; } catch(e){ return false; } },
    load(key, fallback){ try { const r = localStorage.getItem(NS() + key); return r ? JSON.parse(r) : (fallback ?? null); } catch(e){ return fallback ?? null; } },
    remove(key){ try { localStorage.removeItem(NS() + key); return true; } catch(e){ return false; } },
    all(){ try { const out = {}, p = NS(); Object.keys(localStorage).filter(k => k.startsWith(p)).forEach(k => { out[k.slice(p.length)] = JSON.parse(localStorage.getItem(k)); }); return out; } catch(e){ return {}; } },
    // Explicit cross-mode helpers (rarely needed)
    saveLive(key, value){ try { localStorage.setItem('ry_v1_' + key, JSON.stringify(value)); return true; } catch(e){ return false; } },
    loadLive(key, fallback){ try { const r = localStorage.getItem('ry_v1_' + key); return r ? JSON.parse(r) : (fallback ?? null); } catch(e){ return fallback ?? null; } }
  };
  window.RyujinActions = {
    call(tel){ if (!tel) return; window.location.href = 'tel:' + String(tel).replace(/[^\d+]/g, ''); },
    sms(tel, body){ if (!tel) return; const b = body ? '?body=' + encodeURIComponent(body) : ''; window.location.href = 'sms:' + String(tel).replace(/[^\d+]/g, '') + b; },
    email(to, subject, body){
      const q = [];
      if (subject) q.push('subject=' + encodeURIComponent(subject));
      if (body) q.push('body=' + encodeURIComponent(body));
      window.location.href = 'mailto:' + (to || '') + (q.length ? '?' + q.join('&') : '');
    },
    gmail(to, subject, body){
      const url = 'https://mail.google.com/mail/?view=cm&fs=1' +
        (to ? '&to=' + encodeURIComponent(to) : '') +
        (subject ? '&su=' + encodeURIComponent(subject) : '') +
        (body ? '&body=' + encodeURIComponent(body) : '');
      window.open(url, '_blank', 'noopener');
    },
    printDoc(){ window.print(); },
    downloadJSON(filename, data){
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = filename || 'export.json';
      document.body.appendChild(a); a.click();
      setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 100);
    },
    downloadText(filename, text){
      const blob = new Blob([text], { type: 'text/plain' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = filename || 'export.txt';
      document.body.appendChild(a); a.click();
      setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 100);
    }
  };
  // Small universal toast so pages don't each define one
  window.RyujinToast = function(msg, color){
    const t = document.createElement('div');
    t.textContent = msg;
    t.style.cssText = `position:fixed;bottom:40px;left:50%;transform:translateX(-50%);background:rgba(6,12,24,0.95);border:1px solid ${color||'rgba(34,211,238,0.45)'};color:${color||'#22d3ee'};padding:10px 20px;border-radius:10px;font-family:Orbitron,sans-serif;font-size:0.74em;font-weight:700;letter-spacing:1.5px;z-index:9999;box-shadow:0 6px 24px rgba(0,0,0,0.5);transition:opacity 0.4s`;
    document.body.appendChild(t);
    setTimeout(() => { t.style.opacity = '0'; setTimeout(() => t.remove(), 500); }, 2400);
  };
})();
