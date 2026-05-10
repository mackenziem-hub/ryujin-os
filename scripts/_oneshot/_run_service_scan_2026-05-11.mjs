// Run the service agent scan in isolation, see what it produces.
import fs from 'node:fs';
import path from 'node:path';
const envPath = path.resolve('.env.local');
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^([A-Z_][A-Z0-9_]*)\s*=\s*(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
  }
}
const { runServiceScan } = await import('../../lib/agents/service_scan.js');
try {
  const report = await runServiceScan({ tenantSlug: 'plus-ultra' });
  console.log(JSON.stringify(report, null, 2));
} catch (e) {
  console.error('service_scan threw:', e.message);
  console.error(e.stack);
}
