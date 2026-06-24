// ═══════════════════════════════════════════════════════════════
// META ADS CREATION — Build campaign / ad set / creative / ad objects.
// All objects are created PAUSED. Activation stays a human action in
// Ads Manager (publish-paused-first). Pairs with /api/meta-manage
// (pause/resume/budget) and /api/create-video-audiences (retargeting).
//
// GET  /api/meta-create            → discovery: page id, instagram actor, actions
// POST /api/meta-create  { action, ...params }
//   action: "create_campaign"  { name, objective?, dailyBudgetDollars?, specialAdCategories? }
//   action: "create_adset"     { name, campaignId, dailyBudgetDollars?, optimizationGoal?, promotedObject?, targeting?, destinationType? }
//   action: "upload_video"     { fileUrl, name? }            → { id: video_id }
//   action: "video_status"     { videoId }                   → processing status
//   action: "create_creative"  { name, pageId, instagramActorId?, videoId, thumbnailUrl?, message, link, linkDescription?, headline?, ctaType? }
//   action: "create_ad"        { name, adsetId, creativeId }
// ═══════════════════════════════════════════════════════════════

import {
  createCampaign,
  createAdSet,
  uploadAdVideo,
  getVideoStatus,
  createVideoAdCreative,
  createAd,
  getPromotePage
} from '../lib/meta.js';
import { requireCronOrOwner } from '../lib/cronAuth.js';

export default async function handler(req, res) {
  const auth = await requireCronOrOwner(req);
  if (!auth.ok) return res.status(401).json({ error: auth.error });

  const ACTIONS = ['create_campaign', 'create_adset', 'upload_video', 'video_status', 'create_creative', 'create_ad'];

  if (req.method === 'GET') {
    try {
      const promote = await getPromotePage();
      return res.json({ actions: ACTIONS, ...promote });
    } catch (e) {
      return res.status(500).json({ error: e.message });
    }
  }

  if (req.method !== 'POST') return res.status(405).json({ error: 'GET or POST only' });

  const b = req.body || {};
  const { action } = b;
  if (!action) return res.status(400).json({ error: 'Missing action' });

  try {
    let result;
    switch (action) {
      case 'create_campaign':
        result = await createCampaign({
          name: b.name, objective: b.objective, status: b.status,
          specialAdCategories: b.specialAdCategories, dailyBudgetDollars: b.dailyBudgetDollars,
          bidStrategy: b.bidStrategy
        });
        break;
      case 'create_adset':
        result = await createAdSet({
          name: b.name, campaignId: b.campaignId, campaignHasBudget: b.campaignHasBudget,
          dailyBudgetDollars: b.dailyBudgetDollars,
          optimizationGoal: b.optimizationGoal, billingEvent: b.billingEvent,
          promotedObject: b.promotedObject, targeting: b.targeting,
          status: b.status, destinationType: b.destinationType,
          bidStrategy: b.bidStrategy, bidAmountDollars: b.bidAmountDollars
        });
        break;
      case 'upload_video':
        result = await uploadAdVideo({ fileUrl: b.fileUrl, name: b.name });
        break;
      case 'video_status':
        if (!b.videoId) return res.status(400).json({ error: 'Missing videoId' });
        result = await getVideoStatus(b.videoId);
        break;
      case 'create_creative':
        result = await createVideoAdCreative({
          name: b.name, pageId: b.pageId, instagramActorId: b.instagramActorId,
          videoId: b.videoId, thumbnailUrl: b.thumbnailUrl, message: b.message,
          link: b.link, linkDescription: b.linkDescription, headline: b.headline, ctaType: b.ctaType
        });
        break;
      case 'create_ad':
        result = await createAd({ name: b.name, adsetId: b.adsetId, creativeId: b.creativeId, status: b.status });
        break;
      default:
        return res.status(400).json({ error: `Unknown action "${action}"` });
    }
    console.log(`[Meta Create] ${action} ok${result?.id ? ` id=${result.id}` : ''}`);
    return res.json({ status: 'ok', action, result });
  } catch (e) {
    const msg = e.message || 'error';
    // Surface Meta 4xx (bad params, fixable) distinctly from 5xx/infra.
    const m = /Meta API (?:POST )?(\d{3})/.exec(msg);
    const status = m ? (parseInt(m[1], 10) >= 500 ? 502 : parseInt(m[1], 10)) : 500;
    console.error(`[Meta Create] ${action} error (${status}): ${msg}`);
    return res.status(status).json({ error: msg });
  }
}
