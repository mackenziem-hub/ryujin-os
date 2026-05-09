#!/usr/bin/env node
// scripts/lint-claims.mjs
// Bible Priority #2 enforcement — claim guard linter.
// Greps for hardcoded customer-facing trust claims that must instead be
// rendered via lib/claims.js (claims library, migration_036).
//
// Usage:
//   node scripts/lint-claims.mjs                  # report violations
//   node scripts/lint-claims.mjs --fail-on-found  # exit 1 if violations
//
// Wire into pre-commit / CI to prevent regressions like the live $2M/WCB
// claim on proposal-client.html that's currently inaccurate.

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, extname } from 'node:path';

const ROOT = process.cwd();
const FAIL_ON_FOUND = process.argv.includes('--fail-on-found');

// Files/dirs that are ALLOWED to mention these phrases (data files, docs,
// the lint script itself, internal-only references, etc.)
const ALLOWLIST = [
  /^lib\/claims\.js$/,
  /^scripts\/_oneshot\/_seed_claims_/,
  /^scripts\/lint-claims\.mjs$/,
  /^docs\//,
  /^schema\//,
  /^_brain\//,
  /^node_modules\//,
  /^\.git\//,
  /\.md$/,
  /\.sql$/,
  /\.lock$/,
  /package(-lock)?\.json$/,
  // Internal-only surfaces — not customer-facing trust claims:
  /^public\/assets\/ryujin-sim\.js$/,        // simulator game with lore narrative
  /^public\/handbook-outside-sales\.html$/,  // internal sales rep handbook
  /^public\/admin-/,                         // admin-only surfaces (still flag if real claim, but lower noise)
];

// Directories to scan
const SCAN_DIRS = ['public', 'lib', 'api'];

// Forbidden phrases. Each entry: { pattern, severity, why, suggested_replacement }
const RULES = [
  {
    name: 'gl_2m_liability_hardcoded',
    pattern: /\$\s*2\s*M\b|\$\s*2[,.]?000[,.]?000\b/i,
    severity: 'P0',
    why: 'GL policy cancelled Feb 21 2026 — hardcoded $2M liability claim is inaccurate.',
    suggested_replacement: "Render via getActiveClaim(tenantId, 'gl_2m_liability') or 'licensed_and_operating_nb' interim."
  },
  {
    name: 'wcb_coverage_hardcoded',
    pattern: /\bWCB(?:[\s-]+cover(?:age|ed)?)?\b/,
    severity: 'P0',
    why: 'WCB not in good standing since ~Aug 2025 — hardcoded WCB claim is inaccurate. (Internal references in api/lib are OK; this rule targets customer-visible templates.)',
    suggested_replacement: "Render via getActiveClaim(tenantId, 'wcb_coverage')."
  },
  {
    name: 'fully_insured_hardcoded',
    pattern: /\bfully\s+insured\b/i,
    severity: 'P0',
    why: 'Until GL is rebound, "fully insured" claim is unsubstantiated.',
    suggested_replacement: "Use 'licensed_and_operating_nb' claim until GL/WCB are restored."
  },
  {
    name: 'bbb_accredited_hardcoded',
    // Uppercase only — case-insensitive match catches CSS hex (#bbb) false positives.
    // Also requires word boundary on both sides to avoid matching identifiers.
    pattern: /\bBBB(?:\s+(?:accredited|A\+))?\b/,
    severity: 'P1',
    why: 'Plus Ultra is not currently BBB-accredited.',
    suggested_replacement: 'Remove or replace with verified Google reviews claim.'
  },
  {
    name: 'satisfaction_guarantee_hardcoded',
    pattern: /\b100\s*%\s*satisfaction(?:\s+guarantee)?\b/i,
    severity: 'P1',
    why: 'Vague satisfaction guarantee is undefendable; concrete warranty + leak guarantee already cover this ground.',
    suggested_replacement: "Render via getActiveClaim(tenantId, 'leak_free_year_one') or workmanship warranty claim."
  },
  {
    name: 'gaf_certification_hardcoded',
    pattern: /\bGAF[- ]?(?:Master\s*Elite|Certified)\b/i,
    severity: 'P0',
    why: 'Plus Ultra is CertainTeed-certified, NOT GAF. Cross-cert claim is misrepresentation.',
    suggested_replacement: "Render via getActiveClaim(tenantId, 'certainteed_select_shinglemaster')."
  }
];

function isAllowlisted(relPath) {
  return ALLOWLIST.some(rx => rx.test(relPath));
}

function* walk(dir) {
  let entries;
  try { entries = readdirSync(dir); } catch { return; }
  for (const entry of entries) {
    const full = join(dir, entry);
    let st;
    try { st = statSync(full); } catch { continue; }
    if (st.isDirectory()) {
      yield* walk(full);
    } else if (st.isFile()) {
      const ext = extname(entry).toLowerCase();
      if (['.html','.htm','.js','.mjs','.cjs','.jsx','.ts','.tsx','.css','.txt'].includes(ext)) {
        yield full;
      }
    }
  }
}

const violations = [];

for (const dir of SCAN_DIRS) {
  const abs = join(ROOT, dir);
  for (const file of walk(abs)) {
    const rel = relative(ROOT, file).split('\\').join('/');
    if (isAllowlisted(rel)) continue;

    let content;
    try { content = readFileSync(file, 'utf8'); } catch { continue; }

    const lines = content.split('\n');
    for (const rule of RULES) {
      lines.forEach((line, i) => {
        if (rule.pattern.test(line)) {
          violations.push({
            file: rel,
            line: i + 1,
            rule: rule.name,
            severity: rule.severity,
            snippet: line.trim().slice(0, 200),
            why: rule.why,
            fix: rule.suggested_replacement
          });
        }
      });
    }
  }
}

if (violations.length === 0) {
  console.log('✓ Claim-guard lint passed. No hardcoded trust claims found.');
  process.exit(0);
}

// Group by severity
const bySeverity = violations.reduce((acc, v) => {
  acc[v.severity] = acc[v.severity] || [];
  acc[v.severity].push(v);
  return acc;
}, {});

const order = ['P0', 'P1', 'P2'];
let totalP0 = 0;

for (const sev of order) {
  const group = bySeverity[sev];
  if (!group) continue;
  if (sev === 'P0') totalP0 = group.length;

  console.log(`\n=== ${sev} — ${group.length} violation(s) ===`);
  for (const v of group) {
    console.log(`\n  ${v.file}:${v.line}  [${v.rule}]`);
    console.log(`    ${v.snippet}`);
    console.log(`    why: ${v.why}`);
    console.log(`    fix: ${v.fix}`);
  }
}

console.log(`\nTotal: ${violations.length} violations (${totalP0} P0)`);

if (FAIL_ON_FOUND && violations.length > 0) {
  console.error('\n✗ Failing build because --fail-on-found is set.');
  process.exit(1);
}

process.exit(0);
