// ═══════════════════════════════════════════════════════════════
// PIXEL AUDIT — Returns pixel health, stats, diagnostics,
// and custom conversions for the ad account.
//
// Usage:
//   GET /api/pixel-audit           — full audit (all pixels + custom conversions)
//   GET /api/pixel-audit?pixelId=X — single pixel detail
//
// Requires env vars: META_ACCESS_TOKEN, META_AD_ACCOUNT_ID
// ═══════════════════════════════════════════════════════════════

import {
  checkTokenHealth,
  listPixels,
  getPixelStats,
  getPixelDiagnostics,
  listCustomConversions
} from '../lib/meta.js';

export default async function handler(req, res) {
  const startTime = Date.now();
  const { pixelId } = req.query || {};

  // Token check
  const tokenHealth = await checkTokenHealth();
  if (!tokenHealth.valid) {
    return res.status(401).json({
      error: 'Meta API token is invalid or expired',
      detail: tokenHealth.error,
      fix: 'Generate a new token in Meta Graph API Explorer and update META_ACCESS_TOKEN in Vercel env vars'
    });
  }

  try {
    // Single pixel detail mode
    if (pixelId) {
      const [stats, diagnostics] = await Promise.all([
        getPixelStats(pixelId).catch(e => ({ error: e.message })),
        getPixelDiagnostics(pixelId).catch(e => ({ error: e.message }))
      ]);
      return res.json({
        pixelId,
        stats,
        diagnostics,
        duration: `${Date.now() - startTime}ms`
      });
    }

    // Full audit mode
    const [pixels, customConversions] = await Promise.all([
      listPixels(),
      listCustomConversions()
    ]);

    // For each pixel, pull stats + diagnostics in parallel
    const pixelDetails = await Promise.all(
      pixels.map(async (pixel) => {
        const [stats, diagnostics] = await Promise.all([
          getPixelStats(pixel.id).catch(e => ({ error: e.message })),
          getPixelDiagnostics(pixel.id).catch(e => ({ error: e.message }))
        ]);
        return {
          ...pixel,
          stats,
          diagnostics
        };
      })
    );

    // Generate alerts
    const alerts = [];
    for (const px of pixelDetails) {
      if (px.is_unavailable) {
        alerts.push({ pixelId: px.id, name: px.name, alert: 'Pixel is marked unavailable' });
      }
      if (!px.enable_automatic_matching) {
        alerts.push({ pixelId: px.id, name: px.name, alert: 'Automatic matching is OFF — enable for better attribution' });
      }
      if (px.last_fired_time) {
        const lastFired = new Date(px.last_fired_time);
        const hoursSinceLastFire = (Date.now() - lastFired.getTime()) / (1000 * 60 * 60);
        if (hoursSinceLastFire > 48) {
          alerts.push({ pixelId: px.id, name: px.name, alert: `Pixel hasn't fired in ${Math.round(hoursSinceLastFire)}h` });
        }
      }
      if (Array.isArray(px.diagnostics)) {
        for (const check of px.diagnostics) {
          if (check.result === 'FAIL' || check.result === 'WARNING') {
            alerts.push({ pixelId: px.id, name: px.name, alert: `DA check ${check.check_name || 'unknown'}: ${check.result}` });
          }
        }
      }
    }

    const duration = Date.now() - startTime;
    console.log(`[Pixel Audit] Completed in ${duration}ms — ${pixels.length} pixels, ${customConversions.length} custom conversions, ${alerts.length} alerts`);

    res.json({
      status: 'ok',
      duration: `${duration}ms`,
      tokenHealth: {
        valid: tokenHealth.valid,
        expiresAt: tokenHealth.expiresAt
      },
      pixels: pixelDetails,
      customConversions,
      alerts,
      summary: {
        totalPixels: pixels.length,
        totalCustomConversions: customConversions.length,
        totalAlerts: alerts.length
      }
    });

  } catch (e) {
    console.error(`[Pixel Audit] Error: ${e.message}`);
    res.status(500).json({ error: e.message, duration: `${Date.now() - startTime}ms` });
  }
}
