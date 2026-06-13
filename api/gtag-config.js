// Ryujin OS - Google tag public config (Google Ads readiness, 2026-06-13).
// GET /api/gtag-config -> { ga4, adsId, sendTo } from env vars ONLY.
//
// The whole Google Ads conversion scaffold keys off this endpoint: until Mac
// creates the account and pastes the IDs into Vercel env, every field is null
// and assets/ryujin-gtag.js stays a hard no-op (zero page behavior change).
// Account hookup later = set the env vars + redeploy. No IDs in source, no
// tenant_settings migration.
//
// Env contract (all optional, .trim()'d per the Vercel newline convention):
//   GA4_ID                       e.g. G-XXXXXXXXXX
//   GOOGLE_ADS_ID                e.g. AW-123456789
//   GOOGLE_ADS_SEND_TO_LEAD_IE   e.g. AW-123456789/AbCdEfGh   (IE lead submit)
//   GOOGLE_ADS_SEND_TO_LEAD_REVIVE                            (revive submit)
//   GOOGLE_ADS_SEND_TO_BOOKING   (reserved: booking surface not built yet)
//   GOOGLE_ADS_SEND_TO_PROPOSAL_ACCEPT (reserved: accept lives on Jewels pages)

const env = (k) => (process.env[k] || '').trim() || null;

export default function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'GET only' });
  // Public by design: tag IDs ship to every visitor's browser anyway.
  res.setHeader('Cache-Control', 'public, max-age=300, s-maxage=300');
  return res.json({
    ga4: env('GA4_ID'),
    adsId: env('GOOGLE_ADS_ID'),
    sendTo: {
      lead_ie: env('GOOGLE_ADS_SEND_TO_LEAD_IE'),
      lead_revive: env('GOOGLE_ADS_SEND_TO_LEAD_REVIVE'),
      booking: env('GOOGLE_ADS_SEND_TO_BOOKING'),
      proposal_accept: env('GOOGLE_ADS_SEND_TO_PROPOSAL_ACCEPT'),
    },
  });
}
