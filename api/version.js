// ═══════════════════════════════════════════════════════════════
// VERSION - public build/deployment metadata for health + debugging
// GET /api/version -> { env, region, deploymentId, gitSha, gitRef, node, now }
//
// gitSha/gitRef are populated ONLY on Vercel Git-integration deploys. Our
// deploys are manual `npx vercel --prod` from a worktree, which carry NO git
// metadata (verified Jun 21 2026), so gitSha is null in normal operation. Do
// NOT treat a null gitSha as a clobber signal here. The real clobber detector
// is the /p/ canary (api/agents/canary.js) + the post-deploy smoke
// (scripts/smoke-prod.mjs). This endpoint is for "what is actually live right
// now" debugging and as a smoke-test target. No secrets are exposed.
// ═══════════════════════════════════════════════════════════════

export default function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0');
  return res.status(200).json({
    ok: true,
    service: 'ryujin-os',
    env: process.env.VERCEL_ENV || 'unknown',
    region: process.env.VERCEL_REGION || null,
    deploymentId: process.env.VERCEL_DEPLOYMENT_ID || null,
    gitSha: process.env.VERCEL_GIT_COMMIT_SHA || null,
    gitRef: process.env.VERCEL_GIT_COMMIT_REF || null,
    node: process.version,
    now: new Date().toISOString(),
  });
}
