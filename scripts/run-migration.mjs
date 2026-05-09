#!/usr/bin/env node
// Apply a SQL migration file to the Supabase Postgres instance.
//
// Usage:
//   node scripts/run-migration.mjs schema/migration_015_workorder_measurements.sql
//
// Requires DATABASE_URL in .env.local (Supabase → Project Settings → Database →
// Connection string → "Connection pooling" → Transaction mode, URI format).

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import pg from 'pg';

const file = process.argv[2];
if (!file) {
  console.error('usage: node scripts/run-migration.mjs <path-to-sql>');
  process.exit(1);
}

const envPath = resolve(process.cwd(), '.env.local');
try {
  const env = readFileSync(envPath, 'utf8');
  for (const line of env.split('\n')) {
    const m = line.match(/^([A-Z_]+)=(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim().replace(/^"|"$/g, '');
  }
} catch {}

const url = (process.env.DATABASE_URL || process.env.POSTGRES_URL || '').trim();
if (!url) {
  console.error('DATABASE_URL not set. Add to .env.local from Supabase → Settings → Database → Connection string (pooled).');
  process.exit(1);
}

const sql = readFileSync(resolve(process.cwd(), file), 'utf8');
const client = new pg.Client({ connectionString: url, ssl: { rejectUnauthorized: false } });

await client.connect();
try {
  await client.query('BEGIN');
  await client.query(sql);
  await client.query('COMMIT');
  console.log(`✓ applied ${file}`);
} catch (err) {
  await client.query('ROLLBACK');
  console.error(`✗ migration failed: ${err.message}`);
  process.exit(1);
} finally {
  await client.end();
}
