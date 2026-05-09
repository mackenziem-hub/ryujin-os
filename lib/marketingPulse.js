// Marketing pulse — yesterday's KPIs (CPL, CAC, ROAS, spend, leads)
// + cross-source reconcile (Meta vs Gmail vs GHL vs Replit IE).

import { gmailSearch } from './google.js';

const GHL_BASE = 'https://services.leadconnectorhq.com';
const GHL_LOCATION = (process.env.GHL_LOCATION_ID || '').trim();
const GHL_TOKEN = (process.env.GHL_TOKEN || process.env.GHL_API_KEY || '').trim();
const GHL_VERSION = '2021-07-28';
const PAID_SOURCES = /facebook|instagram|meta|instant.estimator|booking|fb|ig/i;

function ymd(d) { return d.toISOString().slice(0, 10); }
function unixSeconds(d) { return Math.floor(d.getTime() / 1000); }

// Yesterday in Atlantic Time = UTC-3 in DST.
// Returns { startUTC, endUTC, ymdYesterday }.
export function yesterdayAT() {
  const now = new Date();
  // Convert to AT by shifting -3h, then floor to date, then re-shift.
  const atNow = new Date(now.getTime() - 3 * 3600 * 1000);
  const atYesterday = new Date(atNow);
  atYesterday.setUTCDate(atYesterday.getUTCDate() - 1);
  const startUTC = new Date(Date.UTC(
    atYesterday.getUTCFullYear(),
    atYesterday.getUTCMonth(),
    atYesterday.getUTCDate(),
    3, 0, 0
  ));
  const endUTC = new Date(startUTC.getTime() + 24 * 3600 * 1000);
  return { startUTC, endUTC, ymdYesterday: ymd(atYesterday) };
}

// Pulls yesterday's per-campaign Meta spend + leads.
export async function fetchMetaYesterday() {
  const token = (process.env.META_ACCESS_TOKEN || '').trim();
  const adAccountId = (process.env.META_AD_ACCOUNT_ID || '').trim();
  if (!token || !adAccountId) throw new Error('Meta env vars missing');
  const { ymdYesterday } = yesterdayAT();
  const url = `https://graph.facebook.com/v21.0/${adAccountId}/campaigns?fields=id,name,status,daily_budget,insights.time_range({"since":"${ymdYesterday}","until":"${ymdYesterday}"}){spend,impressions,clicks,actions,cost_per_action_type}&limit=50&access_token=${encodeURIComponent(token)}`;
  const r = await fetch(url, { signal: AbortSignal.timeout(15000) });
  if (!r.ok) throw new Error(`Meta API ${r.status}`);
  const data = await r.json();
  const campaigns = (data.data || []).map(c => {
    const ins = c.insights?.data?.[0] || null;
    const actions = ins?.actions || [];
    const leadAction = actions.find(a => a.action_type === 'lead' || a.action_type === 'offsite_conversion.fb_pixel_lead' || a.action_type === 'onsite_conversion.lead_grouped');
    const scheduleAction = actions.find(a => a.action_type === 'schedule' || a.action_type === 'offsite_conversion.fb_pixel_schedule');
    const contactAction = actions.find(a => a.action_type === 'contact' || a.action_type === 'offsite_conversion.fb_pixel_contact');
    const leads = parseInt(leadAction?.value || 0) + parseInt(scheduleAction?.value || 0) + parseInt(contactAction?.value || 0);
    return {
      name: c.name,
      id: c.id,
      status: c.status,
      spend: parseFloat(ins?.spend || 0),
      impressions: parseInt(ins?.impressions || 0),
      clicks: parseInt(ins?.clicks || 0),
      leads
    };
  });
  return campaigns;
}

// Cross-source counts for yesterday.
export async function reconcileYesterday() {
  const { startUTC, endUTC, ymdYesterday } = yesterdayAT();
  const out = {
    yesterday: ymdYesterday,
    metaLeads: null,
    gmailFormSubmits: null,
    ghlNewContacts: null,
    ieSubmissions: null,
    agree: false,
    notes: []
  };

  try {
    const camps = await fetchMetaYesterday();
    out.metaLeads = camps.reduce((s, c) => s + c.leads, 0);
    out._campaigns = camps;
  } catch (e) { out.notes.push(`Meta: ${e.message}`); }

  // Gmail formsubmit-class subjects
  try {
    const queries = [
      `(subject:"New Instant Estimator" OR subject:"new lead" OR subject:"form submission" OR subject:"new booking" OR subject:"contact form" OR subject:"appointment booked") after:${unixSeconds(startUTC)} before:${unixSeconds(endUTC)}`
    ];
    const r = await gmailSearch(queries[0], 50);
    out.gmailFormSubmits = (r?.messages || r?.threads || []).length || 0;
  } catch (e) { out.notes.push(`Gmail: ${e.message}`); }

  // GHL new contacts yesterday
  try {
    if (GHL_LOCATION && GHL_TOKEN) {
      const url = `${GHL_BASE}/contacts/?locationId=${GHL_LOCATION}&limit=100&query=&startAfter=${startUTC.getTime()}&startAfterId=`;
      const r = await fetch(url, {
        headers: { Authorization: `Bearer ${GHL_TOKEN}`, Version: GHL_VERSION }
      });
      if (r.ok) {
        const d = await r.json();
        const contacts = d.contacts || [];
        const yest = contacts.filter(c => {
          const created = c.dateAdded || c.createdAt;
          if (!created) return false;
          const t = new Date(created).getTime();
          return t >= startUTC.getTime() && t < endUTC.getTime();
        });
        out.ghlNewContacts = yest.length;
        out._ghlBySource = yest.reduce((acc, c) => {
          const s = (c.source || 'unknown').toLowerCase();
          acc[s] = (acc[s] || 0) + 1;
          return acc;
        }, {});
      } else {
        out.notes.push(`GHL contacts ${r.status}`);
      }
    }
  } catch (e) { out.notes.push(`GHL: ${e.message}`); }

  // Replit IE submissions yesterday
  try {
    const r = await fetch('https://plus-ultra-roof-estimator.replit.app/api/leads', {
      headers: { 'x-api-key': 'pu-instantest-2026' },
      signal: AbortSignal.timeout(8000)
    });
    if (r.ok) {
      const data = await r.json();
      const leads = data.leads || data;
      const yest = (Array.isArray(leads) ? leads : []).filter(l => {
        const t = new Date(l.createdAt || l.timestamp || l.date || 0).getTime();
        return t >= startUTC.getTime() && t < endUTC.getTime();
      });
      out.ieSubmissions = yest.length;
    }
  } catch (e) { out.notes.push(`Replit IE: ${e.message}`); }

  // Agree if no source disagrees with the others by >1 (allowing for delivery lag).
  const counts = [out.metaLeads, out.gmailFormSubmits, out.ghlNewContacts].filter(n => n != null);
  if (counts.length >= 2) {
    const max = Math.max(...counts);
    const min = Math.min(...counts);
    out.agree = (max - min) <= 1;
  }
  return out;
}

// Window helper.
function windowDays(days) {
  const end = new Date();
  const start = new Date(end.getTime() - days * 24 * 3600 * 1000);
  return { start, end };
}

// CAC = ad spend ÷ signed deals over window.
// ROAS = revenue from paid-source contacts ÷ ad spend over window.
export async function computeCacRoas(windowDaysCac = 7, windowDaysRoas = 30, snapshotMetaSpend = null) {
  // Pull GHL contacts with paid source over the longer window
  const out = { cac7d: null, roas30d: null, paidRevenue30d: 0, signedDeals7d: 0, adSpend7d: 0, adSpend30d: 0 };
  if (!GHL_LOCATION || !GHL_TOKEN) return out;

  const { start: roasStart } = windowDays(windowDaysRoas);
  const { start: cacStart } = windowDays(windowDaysCac);

  // Pull recent contacts (paid sources) for ROAS
  try {
    const r = await fetch(`${GHL_BASE}/contacts/?locationId=${GHL_LOCATION}&limit=100`, {
      headers: { Authorization: `Bearer ${GHL_TOKEN}`, Version: GHL_VERSION }
    });
    if (r.ok) {
      const d = await r.json();
      const contacts = d.contacts || [];
      const paid = contacts.filter(c => {
        const s = (c.source || '').toLowerCase();
        const ts = new Date(c.dateAdded || c.createdAt || 0).getTime();
        return PAID_SOURCES.test(s) && ts >= roasStart.getTime();
      });
      // monetary fields vary; sum contact.monetaryValue if present, else fall back to opportunities
      out._paidContactCount = paid.length;
      // ROAS revenue calc: real signed revenue requires opportunity lookup.
      // Stub: use contact.monetaryValue if available; else pull /opportunities and filter by contactId.
      out.paidRevenue30d = paid.reduce((s, c) => s + (parseFloat(c.monetaryValue) || 0), 0);
    }
  } catch (e) { out._roasNote = e.message; }

  // Ad spend windows from snapshot if provided
  if (snapshotMetaSpend) {
    out.adSpend7d = snapshotMetaSpend.last7d || 0;
    out.adSpend30d = snapshotMetaSpend.totalSpend || 0;
  }

  if (out.adSpend30d > 0 && out.paidRevenue30d > 0) {
    out.roas30d = +(out.paidRevenue30d / out.adSpend30d).toFixed(2);
  }
  // CAC requires signed-deal count over 7d — we approximate from snapshot if available.
  return out;
}
