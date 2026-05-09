// Phase 6A: Persona API
// GET  /api/persona            → current user's persona + tenant default (for UI fallback display)
// PUT  /api/persona            → update current user's persona { name, style, avatar_url, voice_id }
// GET  /api/persona?tenant=1   → tenant default persona (owner only)
// PUT  /api/persona?tenant=1   → update tenant default persona (owner only)
//
// Auth: Authorization: Bearer <ryujin_token> header (same pattern as chat).
// Persona shape: { name?: string, style?: string, avatar_url?: string|null, voice_id?: string|null }
//
// Migration 029_personas.sql must be applied for write operations to succeed.
// Reads gracefully return {} if columns don't exist yet (chat will fall through to role prompt baseline).

import { supabaseAdmin } from '../lib/supabase.js';

async function resolveSession(req) {
  const authHeader = req.headers.authorization || '';
  const token = authHeader.replace(/^Bearer\s+/i, '').trim()
    || req.headers['x-ryujin-token']
    || req.query?.token;
  if (!token) return null;

  const { data: session } = await supabaseAdmin
    .from('sessions')
    .select('user_id, tenant_id, expires_at')
    .eq('token', token).single();
  if (!session || new Date(session.expires_at) < new Date()) return null;

  const { data: user } = await supabaseAdmin
    .from('users').select('id, name, email, role, role_id').eq('id', session.user_id).single();
  if (!user) return null;

  let roleSlug = user.role || 'crew';
  if (user.role_id) {
    const { data: roleRow } = await supabaseAdmin.from('roles').select('slug').eq('id', user.role_id).single();
    if (roleRow?.slug) roleSlug = roleRow.slug;
  }

  return { userId: user.id, tenantId: session.tenant_id, role: roleSlug, userName: user.name };
}

function sanitizePersona(input) {
  if (!input || typeof input !== 'object') return {};
  const out = {};
  if (input.name !== undefined) out.name = String(input.name).trim().slice(0, 60);
  if (input.style !== undefined) out.style = String(input.style).trim().slice(0, 1000);
  if (input.avatar_url !== undefined) out.avatar_url = input.avatar_url ? String(input.avatar_url).trim().slice(0, 500) : null;
  if (input.voice_id !== undefined) out.voice_id = input.voice_id ? String(input.voice_id).trim().slice(0, 100) : null;
  return out;
}

const VALID_ARCHETYPES = [
  'ruler','caregiver','hero','creator','sage','magician',
  'explorer','jester','lover','innocent','everyman','outlaw'
];

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, PUT, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const ctx = await resolveSession(req);
  if (!ctx) return res.status(401).json({ error: 'Unauthorized — log in to access persona settings' });

  const isTenantScope = !!req.query?.tenant;

  if (req.method === 'GET') {
    if (isTenantScope) {
      try {
        const { data } = await supabaseAdmin
          .from('tenants').select('default_persona').eq('id', ctx.tenantId).single();
        return res.json({ persona: data?.default_persona || {} });
      } catch (e) {
        return res.json({ persona: {}, note: 'tenant default_persona column not yet migrated' });
      }
    }

    let userPersona = {};
    let tenantDefault = {};
    let primaryArchetype = null;
    let activeArchetypes = [];
    let styleProfile = {};
    // Try fetching with all columns first (post-migration 029+030+031); fall back gracefully if missing.
    try {
      const { data } = await supabaseAdmin
        .from('users').select('persona, primary_archetype, style_profile').eq('id', ctx.userId).single();
      userPersona = data?.persona || {};
      primaryArchetype = data?.primary_archetype || null;
      styleProfile = data?.style_profile || {};
    } catch (e) {
      try {
        const { data } = await supabaseAdmin
          .from('users').select('persona, primary_archetype').eq('id', ctx.userId).single();
        userPersona = data?.persona || {};
        primaryArchetype = data?.primary_archetype || null;
      } catch {
        try {
          const { data } = await supabaseAdmin
            .from('users').select('persona').eq('id', ctx.userId).single();
          userPersona = data?.persona || {};
        } catch {
          return res.json({ persona: {}, tenantDefault: {}, primaryArchetype: null, activeArchetypes: [], styleProfile: {}, note: 'persona columns not yet migrated. Run schema/migration_029_personas.sql + migration_030_archetypes.sql + migration_031_style_profile.sql in Supabase Dashboard.' });
        }
      }
    }
    try {
      const { data } = await supabaseAdmin
        .from('tenants').select('default_persona, active_archetypes').eq('id', ctx.tenantId).single();
      tenantDefault = data?.default_persona || {};
      activeArchetypes = data?.active_archetypes || [];
    } catch {
      try {
        const { data } = await supabaseAdmin
          .from('tenants').select('default_persona').eq('id', ctx.tenantId).single();
        tenantDefault = data?.default_persona || {};
      } catch {}
    }

    return res.json({ persona: userPersona, tenantDefault, primaryArchetype, activeArchetypes, styleProfile, role: ctx.role });
  }

  if (req.method === 'PUT') {
    const body = req.body || {};
    const persona = sanitizePersona(body);
    const archetype = body.primary_archetype && VALID_ARCHETYPES.includes(body.primary_archetype) ? body.primary_archetype : null;

    if (isTenantScope) {
      if (ctx.role !== 'owner') return res.status(403).json({ error: 'Only owner can edit tenant default persona' });
      const update = {};
      if (Object.keys(persona).length > 0) update.default_persona = persona;
      if (Array.isArray(body.active_archetypes)) {
        update.active_archetypes = body.active_archetypes.filter(a => VALID_ARCHETYPES.includes(a));
      }
      const { data, error } = await supabaseAdmin
        .from('tenants').update(update).eq('id', ctx.tenantId).select('default_persona, active_archetypes').single();
      if (error) return res.status(500).json({ error: error.message, hint: 'Run schema/migration_029_personas.sql + migration_030_archetypes.sql if errors mention missing columns' });
      return res.json({ persona: data.default_persona, activeArchetypes: data.active_archetypes });
    }

    const update = {};
    if (Object.keys(persona).length > 0) update.persona = persona;
    if (archetype) update.primary_archetype = archetype;
    if (body.style_profile && typeof body.style_profile === 'object') {
      // Sanitize style_profile fields
      const sp = {};
      if (body.style_profile.length_pref) sp.length_pref = String(body.style_profile.length_pref).slice(0, 30);
      if (body.style_profile.formality) sp.formality = String(body.style_profile.formality).slice(0, 30);
      if (body.style_profile.decision_style) sp.decision_style = String(body.style_profile.decision_style).slice(0, 30);
      if (Array.isArray(body.style_profile.vocab_signals)) sp.vocab_signals = body.style_profile.vocab_signals.slice(0, 12).map(s => String(s).slice(0, 60));
      if (Array.isArray(body.style_profile.recurring_asks)) sp.recurring_asks = body.style_profile.recurring_asks.slice(0, 12).map(s => String(s).slice(0, 80));
      if (body.style_profile.notes) sp.notes = String(body.style_profile.notes).slice(0, 1000);
      sp.last_updated = new Date().toISOString();
      sp.source_count = Number(body.style_profile.source_count) || 0;
      update.style_profile = sp;
    }

    const { data, error } = await supabaseAdmin
      .from('users').update(update).eq('id', ctx.userId).select('persona, primary_archetype, style_profile').single();
    if (error) {
      // Migrations may not all be applied — try progressively narrower selects
      const fallback = {};
      if (Object.keys(persona).length > 0) fallback.persona = persona;
      try {
        const r2 = await supabaseAdmin.from('users').update(fallback).eq('id', ctx.userId).select('persona').single();
        if (r2.error) throw r2.error;
        return res.json({ persona: r2.data.persona, note: 'archetype/style not saved — run migration_030_archetypes.sql + migration_031_style_profile.sql' });
      } catch (e2) {
        return res.status(500).json({ error: error.message, hint: 'Run schema/migration_029_personas.sql + migration_030_archetypes.sql + migration_031_style_profile.sql' });
      }
    }
    return res.json({ persona: data.persona, primaryArchetype: data.primary_archetype, styleProfile: data.style_profile });
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
