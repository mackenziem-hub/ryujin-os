// ═══════════════════════════════════════════════════════════════
// META ADS MANAGEMENT — Campaign control (pause, resume, budget)
//
// POST /api/meta-manage
//   { action: "pause", campaignId: "123" }
//   { action: "resume", campaignId: "123" }
//   { action: "budget", campaignId: "123", budget: 20 }
//   { action: "pause_adset", adSetId: "123" }
//   { action: "resume_adset", adSetId: "123" }
//   { action: "budget_adset", adSetId: "123", budget: 15 }
//
// GET /api/meta-manage — returns available actions
// ═══════════════════════════════════════════════════════════════

import {
  pauseCampaign,
  resumeCampaign,
  updateCampaignBudget,
  updateAdSetStatus,
  updateAdSetBudget,
  updateAdSetPromotedObject,
  getCampaigns
} from '../lib/meta.js';

export default async function handler(req, res) {
  if (req.method === 'GET') {
    // List active campaigns for reference
    try {
      const campaigns = await getCampaigns('last_7d');
      const active = campaigns.filter(c => c.active);
      return res.json({
        actions: ['pause', 'resume', 'budget', 'pause_adset', 'resume_adset', 'budget_adset', 'update_optimization'],
        activeCampaigns: active.map(c => ({ id: c.id, name: c.name, dailyBudget: c.dailyBudget, spend7d: c.spend }))
      });
    } catch (e) {
      return res.status(500).json({ error: e.message });
    }
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'POST only' });
  }

  const { action, campaignId, adSetId, budget } = req.body || {};

  if (!action) {
    return res.status(400).json({ error: 'Missing action' });
  }

  try {
    let result;
    let description;

    switch (action) {
      case 'pause':
        if (!campaignId) return res.status(400).json({ error: 'Missing campaignId' });
        result = await pauseCampaign(campaignId);
        description = `Paused campaign ${campaignId}`;
        break;

      case 'resume':
        if (!campaignId) return res.status(400).json({ error: 'Missing campaignId' });
        result = await resumeCampaign(campaignId);
        description = `Resumed campaign ${campaignId}`;
        break;

      case 'budget':
        if (!campaignId || budget == null) return res.status(400).json({ error: 'Missing campaignId or budget' });
        result = await updateCampaignBudget(campaignId, budget);
        description = `Set campaign ${campaignId} budget to $${budget}/day`;
        break;

      case 'pause_adset':
        if (!adSetId) return res.status(400).json({ error: 'Missing adSetId' });
        result = await updateAdSetStatus(adSetId, 'PAUSED');
        description = `Paused ad set ${adSetId}`;
        break;

      case 'resume_adset':
        if (!adSetId) return res.status(400).json({ error: 'Missing adSetId' });
        result = await updateAdSetStatus(adSetId, 'ACTIVE');
        description = `Resumed ad set ${adSetId}`;
        break;

      case 'budget_adset':
        if (!adSetId || budget == null) return res.status(400).json({ error: 'Missing adSetId or budget' });
        result = await updateAdSetBudget(adSetId, budget);
        description = `Set ad set ${adSetId} budget to $${budget}/day`;
        break;

      case 'update_optimization': {
        const promotedObject = req.body?.promotedObject;
        if (!adSetId || !promotedObject) return res.status(400).json({ error: 'Missing adSetId or promotedObject' });
        result = await updateAdSetPromotedObject(adSetId, promotedObject);
        description = `Updated ad set ${adSetId} promoted_object to ${JSON.stringify(promotedObject)}`;
        break;
      }

      default:
        return res.status(400).json({ error: `Unknown action "${action}"` });
    }

    console.log(`[Meta Manage] ${description}`);
    res.json({ status: 'ok', action, description, result });

  } catch (e) {
    console.error(`[Meta Manage] Error: ${e.message}`);
    res.status(500).json({ error: e.message });
  }
}
