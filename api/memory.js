// Ryujin Memory API
// Persistent memory for Z Fighters, session summaries, and operations log.
// Uses Vercel Blob for cross-deployment persistence.
//
// GET  /api/memory?type=agent&name=vegeta     — read agent memory
// GET  /api/memory?type=agents                — read all agent memories
// GET  /api/memory?type=sessions&limit=5      — read recent session summaries
// GET  /api/memory?type=ops&limit=20          — read recent operations log
// GET  /api/memory?type=preferences           — read all saved preferences
// GET  /api/memory?type=startup               — full startup injection (all memory for context)
// POST /api/memory?type=agent&name=vegeta     — write agent memory
// POST /api/memory?type=session               — write session summary
// POST /api/memory?type=ops                   — append to operations log
// POST /api/memory?type=preferences           — save/update a preference (body: {key, rule, type})
// DELETE /api/memory?type=preferences&key=x   — remove a preference by key

import { put, list, head } from '@vercel/blob';
import { resolveSession } from '../lib/portalAuth.js';

const BLOB_PREFIX = 'ryujin-memory/';
const LEGACY_BLOB_PREFIX = 'shenron-memory/';

// ═══════════════════════════════════════════
// BLOB HELPERS
// ═══════════════════════════════════════════

async function readBlob(key) {
  try {
    let { blobs } = await list({ prefix: `${BLOB_PREFIX}${key}`, limit: 1 });
    if (blobs.length === 0) {
      ({ blobs } = await list({ prefix: `${LEGACY_BLOB_PREFIX}${key}`, limit: 1 }));
    }
    if (blobs.length === 0) return null;
    // Cache-bust: overwritten blobs serve stale from the CDN for minutes
    // (known footgun). Without this, two quick writes to the same key can
    // read-modify-write over stale state and silently drop the first write.
    const resp = await fetch(blobs[0].url + (blobs[0].url.includes('?') ? '&' : '?') + '_t=' + Date.now(), { cache: 'no-store' });
    if (!resp.ok) return null;
    return await resp.json();
  } catch (e) {
    return null;
  }
}

async function writeBlob(key, data) {
  const blob = await put(`${BLOB_PREFIX}${key}`, JSON.stringify(data, null, 2), {
    access: 'public',
    addRandomSuffix: false,
    contentType: 'application/json',
    // Blob CDN ignores query-string cache-busts; without a short max-age,
    // read-modify-write over a stale edge copy can drop recent writes.
    cacheControlMaxAge: 60
  });
  return blob;
}

async function listBlobs(prefix, limit = 10) {
  try {
    const newResult = await list({ prefix: `${BLOB_PREFIX}${prefix}`, limit });
    const legacyResult = newResult.blobs.length < limit
      ? await list({ prefix: `${LEGACY_BLOB_PREFIX}${prefix}`, limit: limit - newResult.blobs.length })
      : { blobs: [] };
    const combined = [...newResult.blobs, ...legacyResult.blobs];
    return combined.sort((a, b) => new Date(b.uploadedAt) - new Date(a.uploadedAt));
  } catch (e) {
    return [];
  }
}

// ═══════════════════════════════════════════
// HANDLER
// ═══════════════════════════════════════════

export default async function handler(req, res) {
  // Hard gate: this store holds preferences, session summaries, ops logs and
  // durable business facts. Owner/admin session or RYUJIN_SERVICE_TOKEN
  // (+ x-tenant-id) required; it was previously readable unauthenticated.
  const session = await resolveSession(req);
  if (!session) {
    return res.status(401).json({ error: 'sign_in_required', code: 'NO_SESSION' });
  }
  if (session.role !== 'owner' && session.role !== 'admin') {
    return res.status(403).json({ error: 'owner_or_admin_required', current_role: session.role });
  }

  const { type, name, limit = '10' } = req.query;

  if (!type) {
    return res.status(400).json({
      error: 'Missing type parameter',
      usage: {
        read: {
          agent: 'GET /api/memory?type=agent&name=vegeta',
          allAgents: 'GET /api/memory?type=agents',
          sessions: 'GET /api/memory?type=sessions&limit=5',
          ops: 'GET /api/memory?type=ops&limit=20',
          startup: 'GET /api/memory?type=startup'
        },
        write: {
          agent: 'POST /api/memory?type=agent&name=vegeta — body: agent memory JSON',
          session: 'POST /api/memory?type=session — body: session summary JSON',
          ops: 'POST /api/memory?type=ops — body: single operation entry JSON'
        }
      }
    });
  }

  // ─── READ OPERATIONS ───
  if (req.method === 'GET') {

    // Single agent memory
    if (type === 'agent' && name) {
      const data = await readBlob(`agents/${name}.json`);
      return res.json({ agent: name, memory: data, timestamp: new Date().toISOString() });
    }

    // All agent memories
    if (type === 'agents') {
      const agents = ['vegeta', 'piccolo', 'krillin', 'bulma', 'gohan', 'trunks'];
      const memories = {};
      for (const agent of agents) {
        memories[agent] = await readBlob(`agents/${agent}.json`);
      }
      return res.json({ agents: memories, timestamp: new Date().toISOString() });
    }

    // Recent sessions
    if (type === 'sessions') {
      const blobs = await listBlobs('sessions/', parseInt(limit));
      const sessions = [];
      for (const blob of blobs.slice(0, parseInt(limit))) {
        try {
          const resp = await fetch(blob.url);
          if (resp.ok) sessions.push(await resp.json());
        } catch (e) { /* skip failed reads */ }
      }
      return res.json({ count: sessions.length, sessions, timestamp: new Date().toISOString() });
    }

    // Recent operations
    if (type === 'ops') {
      const data = await readBlob('ops-log.json');
      const entries = (data?.entries || []).slice(-parseInt(limit));
      return res.json({ count: entries.length, entries, timestamp: new Date().toISOString() });
    }

    // Startup injection — everything Ryujin needs to remember
    if (type === 'startup') {
      const agents = ['vegeta', 'piccolo', 'krillin', 'bulma', 'gohan', 'trunks'];
      const agentMemories = {};
      for (const agent of agents) {
        agentMemories[agent] = await readBlob(`agents/${agent}.json`);
      }

      const sessionBlobs = await listBlobs('sessions/', 3);
      const recentSessions = [];
      for (const blob of sessionBlobs.slice(0, 3)) {
        try {
          const resp = await fetch(blob.url);
          if (resp.ok) recentSessions.push(await resp.json());
        } catch (e) { /* skip */ }
      }

      const opsData = await readBlob('ops-log.json');
      const recentOps = (opsData?.entries || []).slice(-10);

      return res.json({
        type: 'startup_injection',
        timestamp: new Date().toISOString(),
        agentMemories,
        recentSessions,
        recentOps,
        summary: {
          agentsWithData: Object.entries(agentMemories).filter(([, v]) => v?.last_report_timestamp).map(([k]) => k),
          sessionsAvailable: recentSessions.length,
          opsLogged: recentOps.length
        }
      });
    }

    // Read all preferences
    if (type === 'preferences') {
      const data = await readBlob('preferences.json');
      const prefs = data?.preferences || [];
      return res.json({ count: prefs.length, preferences: prefs, timestamp: new Date().toISOString() });
    }

    // Read durable business facts (semantic memory), newest first
    if (type === 'facts') {
      const data = await readBlob('facts.json');
      const facts = (data?.facts || []).slice(0, Math.min(Math.max(parseInt(limit, 10) || 50, 1), 300));
      return res.json({ count: facts.length, facts, timestamp: new Date().toISOString() });
    }

    return res.status(400).json({ error: `Unknown type: ${type}` });
  }

  // ─── DELETE OPERATIONS ───
  if (req.method === 'DELETE') {
    if (type === 'preferences' && req.query.key) {
      const data = await readBlob('preferences.json') || { preferences: [] };
      const before = data.preferences.length;
      data.preferences = data.preferences.filter(p => p.key !== req.query.key);
      if (data.preferences.length === before) {
        return res.status(404).json({ error: `Preference "${req.query.key}" not found` });
      }
      await writeBlob('preferences.json', data);
      return res.json({ status: 'deleted', key: req.query.key, remaining: data.preferences.length });
    }
    if (type === 'facts' && req.query.id) {
      const data = await readBlob('facts.json') || { facts: [] };
      const before = data.facts.length;
      data.facts = data.facts.filter(f => f.id !== req.query.id);
      if (data.facts.length === before) {
        return res.status(404).json({ error: `Fact "${req.query.id}" not found` });
      }
      await writeBlob('facts.json', data);
      return res.json({ status: 'deleted', id: req.query.id, remaining: data.facts.length });
    }
    return res.status(400).json({ error: 'DELETE requires type=preferences&key=... or type=facts&id=...' });
  }

  // ─── WRITE OPERATIONS ───
  if (req.method === 'POST') {
    const body = req.body;

    if (!body || Object.keys(body).length === 0) {
      return res.status(400).json({ error: 'Empty body' });
    }

    // Write agent memory
    if (type === 'agent' && name) {
      const validAgents = ['vegeta', 'piccolo', 'krillin', 'bulma', 'gohan', 'trunks'];
      if (!validAgents.includes(name)) {
        return res.status(400).json({ error: `Invalid agent: ${name}`, valid: validAgents });
      }
      body.updated_at = new Date().toISOString();
      await writeBlob(`agents/${name}.json`, body);
      return res.json({ status: 'saved', agent: name, timestamp: body.updated_at });
    }

    // Write session summary
    if (type === 'session') {
      const ts = new Date().toISOString().replace(/[:.]/g, '-');
      body.saved_at = new Date().toISOString();
      await writeBlob(`sessions/${ts}.json`, body);
      return res.json({ status: 'saved', key: `sessions/${ts}`, timestamp: body.saved_at });
    }

    // Save or update preference(s) — supports single {key, rule, type} or bulk {preferences: [...]}
    if (type === 'preferences') {
      const now = new Date().toISOString();

      // Bulk mode: body.preferences is an array
      if (Array.isArray(body.preferences)) {
        const data = await readBlob('preferences.json') || { preferences: [] };
        for (const item of body.preferences) {
          if (!item.key || !item.rule) continue;
          const pref = { key: item.key, rule: item.rule, type: item.type || 'workflow', saved_at: now };
          const idx = data.preferences.findIndex(p => p.key === item.key);
          if (idx >= 0) { data.preferences[idx] = pref; } else { data.preferences.push(pref); }
        }
        if (data.preferences.length > 50) { data.preferences = data.preferences.slice(-50); }
        await writeBlob('preferences.json', data);
        return res.json({ status: 'saved', count: body.preferences.length, total: data.preferences.length, timestamp: now });
      }

      // Single mode
      const { key, rule, type: prefType } = body;
      if (!key || !rule) {
        return res.status(400).json({ error: 'Missing key or rule' });
      }
      const data = await readBlob('preferences.json') || { preferences: [] };
      // Upsert — replace existing preference with same key
      const idx = data.preferences.findIndex(p => p.key === key);
      const pref = { key, rule, type: prefType || 'workflow', saved_at: now };
      if (idx >= 0) {
        data.preferences[idx] = pref;
      } else {
        data.preferences.push(pref);
      }
      // Cap at 50 preferences
      if (data.preferences.length > 50) {
        data.preferences = data.preferences.slice(-50);
      }
      await writeBlob('preferences.json', data);
      return res.json({ status: 'saved', key, total: data.preferences.length, timestamp: pref.saved_at });
    }

    // Save a durable business fact (semantic memory). Newest first, capped.
    if (type === 'facts') {
      const fact = String(body.fact || '').trim();
      if (fact.length < 3 || fact.length > 600) {
        return res.status(400).json({ error: 'fact must be 3-600 characters' });
      }
      const data = await readBlob('facts.json') || { facts: [] };
      const entry = {
        id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
        fact,
        topic: typeof body.topic === 'string' ? body.topic.slice(0, 60) : null,
        saved_at: new Date().toISOString()
      };
      data.facts.unshift(entry);
      if (data.facts.length > 300) data.facts = data.facts.slice(0, 300);
      await writeBlob('facts.json', data);
      return res.json({ status: 'saved', id: entry.id, total: data.facts.length, timestamp: entry.saved_at });
    }

    // Append to operations log
    if (type === 'ops') {
      const existing = await readBlob('ops-log.json') || { entries: [] };
      body.logged_at = new Date().toISOString();
      existing.entries.push(body);
      // Keep last 500 entries max
      if (existing.entries.length > 500) {
        existing.entries = existing.entries.slice(-500);
      }
      await writeBlob('ops-log.json', existing);
      return res.json({ status: 'appended', totalEntries: existing.entries.length, timestamp: body.logged_at });
    }

    return res.status(400).json({ error: `Unknown write type: ${type}` });
  }

  return res.status(405).json({ error: 'GET, POST, or DELETE only' });
}
// pro deploy 1775592693
