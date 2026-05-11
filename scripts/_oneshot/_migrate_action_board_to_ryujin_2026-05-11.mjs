// One-shot: migrate every ticket from ultra-task-manager.replit.app
// (the Action Board) into Ryujin's `tickets` table.
//
// Idempotent: skips any Action Board id already imported (we tag each
// migrated ticket with `ab:<id>` so re-runs don't duplicate).
//
// Mapping:
//   AB.priority   top_priority|high|normal       → urgent|high|medium
//   AB.status     done|active                    → done|active
//   AB.assignedTo "Diego"|"AJ"|"Pavanjot"|"Ryan" → users.name lookup
//   AB.dueDate                                   → tickets.due_date
//   AB.completionNotes                           → tickets.notes[] (single entry)
//   AB.createdAt, acceptedAt, completedAt        → preserved
//   AB.category                                  → tags[]
//   AB.photoRequired                             → tags ['photo-required']
//   AB.estimatedDurationMinutes                  → notes line
//
// User-approved 2026-05-11. Read by `_apply_migration_058...` pattern.

import fs from 'node:fs';
import path from 'node:path';
import { createClient } from '@supabase/supabase-js';

const envPath = path.resolve('.env.local');
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^([A-Z_][A-Z0-9_]*)\s*=\s*(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
  }
}
const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
const { data: tenant } = await sb.from('tenants').select('id').eq('slug', 'plus-ultra').single();
const T = tenant.id;

const { data: users } = await sb.from('users').select('id, name').eq('tenant_id', T);
const userByName = Object.fromEntries(users.map(u => [u.name.toLowerCase(), u.id]));
// Action Board uses "Pavanjot" (sometimes the description says "Pavignette"); both map to Pavanjot.
const resolveUser = (name) => {
  if (!name) return null;
  const n = String(name).toLowerCase().trim();
  if (n === 'pavignette') return userByName['pavanjot'] || null;
  return userByName[n] || null;
};

const mapPriority = (p) => ({ top_priority: 'urgent', high: 'high', normal: 'medium' }[p] || 'medium');
const mapStatus = (s) => ({ done: 'done', active: 'active', open: 'open', cancelled: 'cancelled' }[s] || 'open');

console.log('Fetching Action Board…');
const r = await fetch('https://ultra-task-manager.replit.app/api/tickets', {
  headers: { 'x-api-key': (process.env.ACTION_BOARD_KEY || 'pu-actionboard-2026').trim() }
});
if (!r.ok) { console.error('Fetch failed', r.status); process.exit(1); }
const abTickets = await r.json();
console.log(`  ${abTickets.length} Action Board tickets pulled.`);

// Identify already-imported (tag prefix `ab:`)
const { data: existing } = await sb.from('tickets').select('id, tags').eq('tenant_id', T);
const existingAbIds = new Set();
for (const t of existing || []) {
  for (const tag of t.tags || []) {
    if (tag.startsWith('ab:')) existingAbIds.add(parseInt(tag.slice(3), 10));
  }
}
console.log(`  Already imported: ${existingAbIds.size}`);

let inserted = 0, skipped = 0, errored = 0;
for (const ab of abTickets) {
  if (existingAbIds.has(ab.id)) { skipped++; continue; }

  const tags = [`ab:${ab.id}`];
  if (ab.category) tags.push(`category:${String(ab.category).toLowerCase().replace(/\s+/g, '-')}`);
  if (ab.photoRequired) tags.push('photo-required');

  const notes = [];
  if (ab.completionNotes) notes.push(`Completion: ${ab.completionNotes}`);
  if (ab.estimatedDurationMinutes) notes.push(`Estimated duration: ${ab.estimatedDurationMinutes} min`);
  if (ab.scheduledStart) notes.push(`Scheduled start: ${ab.scheduledStart}`);
  if (ab.scheduledEnd) notes.push(`Scheduled end: ${ab.scheduledEnd}`);
  if (ab.acceptedAt) notes.push(`Accepted: ${ab.acceptedAt}`);

  const row = {
    tenant_id: T,
    title: ab.title || 'Untitled',
    description: ab.description || null,
    assigned_to: resolveUser(ab.assignedTo),
    priority: mapPriority(ab.priority),
    status: mapStatus(ab.status),
    due_date: ab.dueDate ? new Date(ab.dueDate).toISOString().slice(0, 10) : null,
    completed_at: ab.completedAt || null,
    tags,
    notes,
    created_at: ab.createdAt || new Date().toISOString(),
    updated_at: ab.completedAt || ab.acceptedAt || ab.createdAt || new Date().toISOString()
  };

  const { error } = await sb.from('tickets').insert(row);
  if (error) {
    console.error(`  FAIL ab:${ab.id} "${ab.title?.slice(0, 50)}": ${error.message}`);
    errored++;
  } else {
    inserted++;
    if (inserted <= 5 || ab.status === 'active') {
      console.log(`  ✓ ab:${ab.id} ${ab.status.padEnd(7)} ${ab.assignedTo || '—'.padEnd(8)} ${(ab.title || '').slice(0, 60)}`);
    }
  }
}

console.log(`\nDone. Inserted ${inserted}, skipped ${skipped} (already imported), errored ${errored}.`);
