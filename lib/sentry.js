// ═══════════════════════════════════════════════════════════════
// SENTRY - server-side error telemetry for API handlers
// ----------------------------------------------------------------------------
// INERT until SENTRY_DSN is set in the Vercel env. With no DSN, withSentry()
// returns the handler untouched (zero behavior change, near-zero overhead) and
// captureError() is a no-op, so this is safe to ship dark and activate later.
//
// ACTIVATE:
//   1. Create a Sentry project (platform Node.js), copy the DSN.
//   2. Add SENTRY_DSN=<dsn> to the ryujin-os Vercel env (Production), redeploy.
//   3. (client pages) paste the browser DSN into the snippet in
//      public/proposal-v2.html / public/proposal-client.html.
//
// Built Jun 21 2026 after the proposal-link clobber: a customer-facing API
// error (or a 500 on the proposal path) should report at the source, not wait
// for the /p/ canary or a customer to notice.
// ═══════════════════════════════════════════════════════════════

import * as Sentry from '@sentry/node';

const DSN = (process.env.SENTRY_DSN || '').trim();
const ENABLED = !!DSN;
let _inited = false;

function init() {
  if (_inited || !ENABLED) return;
  _inited = true;
  try {
    Sentry.init({
      dsn: DSN,
      environment: process.env.VERCEL_ENV || 'production',
      release: process.env.VERCEL_GIT_COMMIT_SHA || undefined,
      tracesSampleRate: 0, // errors only, no performance tracing (cost control)
    });
  } catch { /* never let telemetry init break a request */ }
}

// Report a caught error with optional context. No-op when SENTRY_DSN is unset.
export function captureError(err, context) {
  if (!ENABLED) return;
  init();
  try { Sentry.captureException(err, context ? { extra: context } : undefined); } catch {}
}

// Wrap a serverless handler so uncaught exceptions are reported, then re-thrown
// (behavior unchanged). When SENTRY_DSN is unset, returns the handler as-is.
export function withSentry(handler) {
  if (!ENABLED) return handler;
  return async (req, res) => {
    init();
    try {
      return await handler(req, res);
    } catch (err) {
      captureError(err, { url: req?.url, method: req?.method });
      throw err;
    }
  };
}
