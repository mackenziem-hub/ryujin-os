// ═══════════════════════════════════════════════════════════════
// RyujinVoiceCore - UI-less shared voice engine for the Jarvis dock
// (and any future skin). Consolidates the mechanics that previously
// lived copy-pasted across ryujin-chat.js / voice-mode.js /
// agent-mode-shell.js / admin.html:
//
//   mic capture  : Web Speech API push-to-talk with interim results
//   brain        : POST /api/chat  mode:'speech' (SSE tool loop)
//   voice out    : sentence-split queue -> POST /api/tts (ElevenLabs),
//                  speechSynthesis fallback per sentence on non-ok
//   barge-in     : cancel() aborts SSE + TTS fetches + audio + browser TTS
//
// Pure engine: zero DOM. Skins subscribe via on(event, fn):
//   'state'          {state: idle|listening|thinking|speaking|error, detail}
//   'interim'        live STT text while the user talks
//   'final'          the final transcript that will be sent
//   'user_text'      text submitted (spoken or typed)
//   'assistant_delta' streamed reply text chunk
//   'assistant_done' full assembled reply
//   'tool_step'      {id, label, status: 'start'|'ok'|'error', error}
//   'error'          human-readable failure, verbatim (fail loud)
// ═══════════════════════════════════════════════════════════════
(function () {
  if (window.RyujinVoiceCore) return;

  const listeners = {};
  function on(ev, fn) { (listeners[ev] = listeners[ev] || []).push(fn); }
  function emit(ev, payload) {
    (listeners[ev] || []).forEach((fn) => { try { fn(payload); } catch (e) { console.error('[voice-core] listener', ev, e); } });
  }

  let state = 'idle';
  function setState(next, detail) {
    if (state === next) return;
    state = next;
    emit('state', { state, detail: detail || null });
  }

  function token() {
    try { return localStorage.getItem('ryujin_token') || ''; } catch { return ''; }
  }

  // Same markdown-to-speech cleanup contract as api/tts.js + ryujin-chat.js.
  function cleanForSpeech(text) {
    return String(text || '')
      .replace(/```[\s\S]*?```/g, ' code block ')
      .replace(/`([^`]+)`/g, '$1')
      .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
      .replace(/[\*_`#>~|]/g, '')
      .replace(/\\([\w])/g, '$1')
      .replace(/\s[—–]\s/g, ', ')
      .replace(/[—–]/g, ', ')
      .replace(/\s-\s/g, ', ')
      .replace(/[(){}\[\]]/g, ' ')
      .replace(/\s*&\s*/g, ' and ')
      .replace(/\b(\w+)\/(\w+)\b/g, '$1 or $2')
      .replace(/^[\s]*[•●\-\d]+[.)]?[\s]+/gm, '')
      .replace(/\n{2,}/g, '. ')
      .replace(/\n/g, ' ')
      .replace(/\s+/g, ' ')
      .replace(/\.\s*\./g, '.')
      .replace(/,\s*,/g, ',')
      .trim();
  }

  // ── TTS queue ───────────────────────────────────────────────
  // gen invalidates every async callback from a cancelled turn.
  let gen = 0;
  let ttsQueue = [];          // sentence strings waiting to speak
  let ttsPlaying = false;
  let currentAudio = null;
  let inflightTts = new Set(); // AbortControllers for /api/tts fetches
  let speechBuffer = '';       // streamed assistant text not yet sentence-split

  function enqueueSentences(text, flush) {
    speechBuffer += text;
    const sentences = [];
    let m;
    const re = /[^.!?]*[.!?]+["')\]]*\s*/g;
    let consumed = 0;
    while ((m = re.exec(speechBuffer)) !== null) {
      const s = m[0].trim();
      if (s.length > 1) sentences.push(s);
      consumed = re.lastIndex;
    }
    speechBuffer = speechBuffer.slice(consumed);
    if (flush && speechBuffer.trim().length > 1) {
      sentences.push(speechBuffer.trim());
      speechBuffer = '';
    }
    for (const s of sentences) {
      const clean = cleanForSpeech(s);
      if (clean) ttsQueue.push(clean);
    }
    if (ttsQueue.length && !ttsPlaying) playNext(gen);
  }

  async function playNext(myGen) {
    if (myGen !== gen) return;
    const sentence = ttsQueue.shift();
    if (!sentence) { ttsPlaying = false; maybeIdle(); return; }
    ttsPlaying = true;
    setState('speaking');
    emit('audio_start', sentence);
    const ctrl = new AbortController();
    inflightTts.add(ctrl);
    try {
      const headers = { 'Content-Type': 'application/json' };
      const t = token();
      if (t) headers.Authorization = 'Bearer ' + t;
      const r = await fetch('/api/tts', {
        method: 'POST', headers, signal: ctrl.signal,
        body: JSON.stringify({ text: sentence })
      });
      if (myGen !== gen) return;
      if (r.ok) {
        const blob = await r.blob();
        if (myGen !== gen) return;
        const url = URL.createObjectURL(blob);
        const audio = new Audio(url);
        currentAudio = audio;
        const advance = () => {
          URL.revokeObjectURL(url);
          if (currentAudio === audio) currentAudio = null;
          emit('audio_stop', sentence);
          playNext(myGen);
        };
        audio.onended = advance;
        audio.onerror = advance;
        await audio.play().catch(() => {
          // detach so the error event can't ALSO advance the queue
          audio.onended = null;
          audio.onerror = null;
          URL.revokeObjectURL(url);
          if (currentAudio === audio) currentAudio = null;
          speakBrowser(sentence, myGen);
        });
        return;
      }
      // 401/503/etc: designed fallback path is browser TTS
      speakBrowser(sentence, myGen);
    } catch (e) {
      if (myGen !== gen) return;
      speakBrowser(sentence, myGen);
    } finally {
      inflightTts.delete(ctrl);
    }
  }

  function speakBrowser(sentence, myGen) {
    if (myGen !== gen) return; // cancelled while play() was rejecting
    if (!('speechSynthesis' in window)) { emit('audio_stop', sentence); playNext(myGen); return; }
    try {
      const utter = new SpeechSynthesisUtterance(sentence);
      utter.rate = 1.0; utter.pitch = 1.0; utter.volume = 1.0;
      const advance = () => { if (myGen === gen) { emit('audio_stop', sentence); playNext(myGen); } };
      utter.onend = advance;
      utter.onerror = advance;
      window.speechSynthesis.speak(utter);
    } catch {
      emit('audio_stop', sentence);
      playNext(myGen);
    }
  }

  let streamsOpen = 0;
  function maybeIdle() {
    if (!streamsOpen && !ttsPlaying && !ttsQueue.length && state !== 'listening' && state !== 'error') setState('idle');
  }

  // ── Chat (SSE) ──────────────────────────────────────────────
  let chatCtrl = null;
  const history = []; // {role, content} pairs, capped; only last 10 sent per turn
  function capHistory() { if (history.length > 24) history.splice(0, history.length - 24); }

  async function sendText(text, opts) {
    const msg = String(text || '').trim();
    if (!msg) return;
    cancelSpeechOnly();
    // A new turn owns the brain: abort any stream still open from a prior turn.
    if (chatCtrl) { try { chatCtrl.abort(); } catch {} }
    emit('user_text', msg);
    setState('thinking');
    const myGen = gen;
    const headers = { 'Content-Type': 'application/json' };
    const t = token();
    if (t) headers.Authorization = 'Bearer ' + t;
    const ctrl = new AbortController();
    chatCtrl = ctrl;
    let assembled = '';
    streamsOpen += 1;
    try {
      const resp = await fetch('/api/chat', {
        method: 'POST', headers, signal: ctrl.signal,
        body: JSON.stringify({
          message: msg,
          history: history.slice(-10),
          mode: 'speech',
          conversation_id: undefined
        })
      });
      if (resp.status === 401) {
        setState('error', 'Session expired. Sign in again to use Jarvis.');
        emit('error', 'Session expired. Sign in again to use Jarvis.');
        return;
      }
      if (!resp.ok || !resp.body) {
        const detail = 'Jarvis brain unreachable (HTTP ' + resp.status + ').';
        setState('error', detail);
        emit('error', detail);
        return;
      }
      history.push({ role: 'user', content: msg });
      capHistory();
      const reader = resp.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (myGen !== gen) return; // cancelled mid-stream
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';
        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          const raw = line.slice(6).trim();
          if (!raw) continue;
          let data;
          try { data = JSON.parse(raw); } catch { continue; }
          if (data.text) {
            assembled += data.text;
            emit('assistant_delta', data.text);
            if (!opts || opts.speakReply !== false) enqueueSentences(data.text, false);
          } else if (data.tool_start) {
            emit('tool_step', { id: data.tool_start.id, label: data.tool_start.label || 'Working', status: 'start' });
          } else if (data.tool_end) {
            emit('tool_step', { id: data.tool_end.id, label: null, status: data.tool_end.status === 'error' ? 'error' : 'ok', error: data.tool_end.error || null });
          } else if (data.error) {
            emit('error', 'Server: ' + data.error);
          }
        }
      }
      if (myGen !== gen) return;
      if (assembled) {
        history.push({ role: 'assistant', content: assembled });
        capHistory();
        if (!opts || opts.speakReply !== false) enqueueSentences('', true);
        emit('assistant_done', assembled);
      } else {
        emit('assistant_done', '');
      }
    } catch (e) {
      if (e && e.name === 'AbortError') return;
      const detail = 'Jarvis request failed: ' + (e && e.message ? e.message : 'unknown error');
      setState('error', detail);
      emit('error', detail);
    } finally {
      streamsOpen = Math.max(0, streamsOpen - 1);
      if (chatCtrl === ctrl) chatCtrl = null;
      maybeIdle();
    }
  }

  // ── STT (push-to-talk) ──────────────────────────────────────
  let recognizer = null;
  let recognizing = false;
  // Skins can intercept SPOKEN finals before they reach the brain (e.g. the
  // dock's spoken-affirmative approval guard). Return true = consumed.
  let sendInterceptor = null;

  function startListening() {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) {
      const detail = 'Voice input not supported in this browser. Use Chrome or Edge, or type below.';
      setState('error', detail);
      emit('error', detail);
      return false;
    }
    cancel(); // barge-in: pressing the mic always silences and resets
    if (recognizing) return true;
    const r = new SR();
    r.lang = 'en-US';
    r.interimResults = true;
    r.continuous = false;
    r.maxAlternatives = 1;
    recognizer = r;
    recognizing = true;
    let finalTranscript = '';
    setState('listening');
    // Every handler guards against stale sessions: after abort(), Chrome still
    // fires onerror('aborted') + onend asynchronously, and without the guard a
    // dead recognizer would clobber the live one's state on rapid PTT presses.
    r.onresult = (e) => {
      if (recognizer !== r) return;
      let interim = '';
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const res = e.results[i];
        if (res.isFinal) finalTranscript += res[0].transcript;
        else interim += res[0].transcript;
      }
      const live = (finalTranscript + interim).trim();
      if (live) emit('interim', live);
    };
    r.onerror = (e) => {
      if (recognizer !== r) return;
      recognizing = false;
      recognizer = null;
      // Silence is a normal way for a listen to end (especially in
      // conversation mode), not a failure: back to idle, no red state.
      if (e.error === 'no-speech') {
        if (state === 'listening') setState('idle');
        return;
      }
      // Print real mic failures verbatim: 'audio-capture' here usually means
      // another app (Wispr Flow zombies are the known culprit) holds the device.
      const detail = 'Mic error: ' + (e.error || 'unknown') + (e.error === 'audio-capture' ? ' (is another app holding the microphone?)' : '');
      setState('error', detail);
      emit('error', detail);
    };
    r.onend = () => {
      if (recognizer !== r) return;
      recognizing = false;
      recognizer = null;
      const text = finalTranscript.trim();
      if (text) {
        emit('final', text);
        let consumed = false;
        if (sendInterceptor) {
          try { consumed = sendInterceptor(text) === true; }
          catch (err) {
            // Fail CLOSED: a broken guard must never let an utterance through.
            consumed = true;
            emit('error', 'Send interceptor failed: ' + (err && err.message ? err.message : err));
          }
        }
        if (!consumed) sendText(text);
        else if (state === 'listening') setState('idle');
      } else if (state === 'listening') {
        setState('idle');
      }
    };
    try { r.start(); } catch (e) {
      recognizing = false;
      recognizer = null;
      setState('error', 'Mic start failed: ' + e.message);
      emit('error', 'Mic start failed: ' + e.message);
      return false;
    }
    return true;
  }

  function stopListening() {
    if (recognizer) { try { recognizer.stop(); } catch {} }
  }

  // ── Cancel chains ───────────────────────────────────────────
  function cancelSpeechOnly() {
    gen += 1;
    ttsQueue = [];
    speechBuffer = '';
    ttsPlaying = false;
    if (currentAudio) { try { currentAudio.pause(); } catch {} currentAudio = null; }
    inflightTts.forEach((c) => { try { c.abort(); } catch {} });
    inflightTts.clear();
    try { window.speechSynthesis && window.speechSynthesis.cancel(); } catch {}
  }

  function cancel() {
    cancelSpeechOnly();
    if (chatCtrl) { try { chatCtrl.abort(); } catch {} chatCtrl = null; }
    if (recognizer) { const r = recognizer; recognizer = null; recognizing = false; try { r.abort(); } catch {} }
    setState('idle');
  }

  // Speak arbitrary text through the same queue (greetings, read-back).
  function speak(text) {
    cancelSpeechOnly();
    enqueueSentences(String(text || ''), true);
  }

  window.RyujinVoiceCore = {
    on,
    startListening,
    stopListening,
    sendText,
    speak,
    cancel,
    get state() { return state; },
    get isListening() { return recognizing; },
    setSendInterceptor(fn) { sendInterceptor = typeof fn === 'function' ? fn : null; },
    resetHistory() { history.length = 0; },
    cleanForSpeech
  };
})();
