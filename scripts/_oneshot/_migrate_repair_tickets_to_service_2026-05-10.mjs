// One-shot: migrate any "repair"-tagged rows from legacy tickets table
// into service_tickets. Idempotent — skips rows already migrated
// (tracked via tickets.notes + service_tickets.metadata.legacy_ticket_id).
//
// Mac runs once after deploying the new repair-write paths.
// Run from repo root: node scripts/_oneshot/_migrate_repair_tickets_to_service_2026-05-10.mjs

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

const sb = createClient((process.env.SUPABASE_URL||'').trim(), (process.env.SUPABASE_SERVICE_KEY||'').trim());

// Pull legacy tickets that look repair-flavored.
const { data: rows, error } = await sb
  .from('tickets')
  .select('id, tenant_id, title, description, estimate_id, customer_id, assigned_to, priority, status, due_date, tags, created_at, completed_at')
  .or('tags.cs.{repair},tags.cs.{callback},tags.cs.{warranty},title.ilike.%repair%,title.ilike.%callback%')
  .order('created_at', { ascending: false })
  .limit(2000);

if (error) { console.error('legacy fetch failed:', error); process.exit(1); }
console.log(`Found ${rows.length} legacy tickets matching repair/callback/warranty patterns`);

let migrated = 0;
let skipped = 0;
let failed = 0;

for (const t of rows) {
  // Skip if already migrated.
  const existing = await sb
    .from('service_tickets')
    .select('id')
    .eq('tenant_id', t.tenant_id)
    .contains('metadata', { legacy_ticket_id: t.id })
    .maybeSingle();
  if (existing.data) { skipped++; continue; }

  // Classify ticket_type from tags + title.
  const tags = (t.tags || []).map(s => String(s).toLowerCase());
  const titleLower = String(t.title || '').toLowerCase();
  let ticket_type = 'repair';
  if (tags.includes('callback') || titleLower.includes('callback')) ticket_type = 'callback';
  else if (tags.includes('warranty') || titleLower.includes('warranty')) ticket_type = 'warranty_visit';
  else if (tags.includes('maintenance') || titleLower.includes('maintenance')) ticket_type = 'maintenance';

  // Map legacy status → service_tickets status (legacy: open|active|blocked|done|cancelled).
  const statusMap = { open: 'open', active: 'in_progress', blocked: 'open', done: 'complete', cancelled: 'cancelled' };
  const status = statusMap[t.status] || 'open';

  // Normalize priority (legacy: low|medium|high|urgent → service: urgent|high|normal|low).
  const priorityMap = { low: 'low', medium: 'normal', high: 'high', urgent: 'urgent' };
  const priority = priorityMap[t.priority] || 'normal';

  const insert = {
    tenant_id: t.tenant_id,
    title: t.title,
    description: t.description,
    source_estimate: t.estimate_id || null,
    customer_id: t.customer_id || null,
    assigned_to: t.assigned_to || null,
    ticket_type,
    priority,
    status,
    scheduled_at: t.due_date ? new Date(t.due_date).toISOString() : null,
    completed_at: t.completed_at,
    customer_pays: !tags.includes('warranty') && !tags.includes('courtesy'),
    metadata: { legacy_ticket_id: t.id, legacy_tags: tags, migrated_at: new Date().toISOString() }
  };
  const { error: insErr } = await sb.from('service_tickets').insert(insert);
  if (insErr) {
    console.error(`[ticket ${t.id.slice(0,8)}] migration failed:`, insErr.message);
    failed++;
  } else {
    migrated++;
  }
}

console.log(`\nMigration done: ${migrated} migrated, ${skipped} already-migrated (skipped), ${failed} failed.`);
