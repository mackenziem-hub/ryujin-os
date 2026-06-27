// ═══════════════════════════════════════════════════════════════
// AD FUNNEL FEEDER - per-channel COST-PER-BOOKED into snapshot.adFunnel.
//
// The deck's #1 KPI: a reported CPL is the price of a price-reveal, not a
// customer. This feeder scores the number that pays the bills, cost per
// BOOKED inspection, per channel.
//
// It joins three live sources:
//   1. SPEND  - meta_insights (Meta) + snapshot.googleAds (Google 30d rollup)
//   2. LEADS  - the Supabase `leads` table (REAL captured leads with a derived
//               `channel` of meta|google|other-paid|direct, far smaller than
//               the Meta pixel "lead" event count), keyed by ghl_contact_id
//   3. BOOKED - GHL pipeline opportunities whose stage is an inspection
//               booking or beyond, joined back to the originating lead's
//               channel via opp.contactId === lead.metadata.ghl_contact_id
//
// Cohort logic: of the leads captured in the window, how many reached a
// booked-inspection stage (or signed, which in roofing implies an inspection
// happened). costPerBooked = channel spend / channel booked.
//
// POSTs { adFunnel } to /api/snapshot. 'adFunnel' MUST stay in the
// api/snapshot.js preserveKeys array or the hourly rebuild wipes it.
//
//   GET /api/feeders/ad-funnel?tenant=plus-ultra&days=30   (cron + manual)
//   Authorization: Bearer <CRON_SECRET | owner session | service token>
// ═══════════════════════════════════════════════════════════════

import { requireCronOrOwner } from '../../lib/cronAuth.js';
import { snapshotHeaders } from '../../lib/snapshotClient.js';
import { supabaseAdmin } from '../../lib/supabase.js';

// Stage-name fragments (lowercased, substring match), mirrored from api/snapshot.js.
const BOOKED_STAGES = ['inspection booked', 'inspection scheduled', 'spray feasibility booked', 'inspection complete'];
const SIGNED_STAGES = [
  'client signed', 'contract signed', 'approved',
  'scheduled & starting', 'deposit invoice sent', 'deposit invoice paid',
  'job in progress', 'job complete', 'post production', 'invoice paid', 'the end',
];

const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

export async function buildAdFunnel(tenantId, base, headers, days = 30) {
  const since = new Date(Date.now() - days * 86400000).toISOString().slice(0, 10);

  // 1. Real captured leads in the window, grouped by channel + indexed by GHL contact.
  const { data: leads, error: lErr } = await supabaseAdmin
    .from('leads')
    .select('channel,campaign,metadata,created_at')
    .eq('tenant_id', tenantId)
    .gte('created_at', since)
    .limit(5000);
  if (lErr) throw new Error('leads: ' + lErr.message);

  // 2. Meta spend (durable per-ad/day table) over the same window.
  const today = new Date().toISOString().slice(0, 10);
  const { data: mi, error: mErr } = await supabaseAdmin
    .from('meta_insights')
    .select('spend_cents,campaign_name')
    .eq('tenant_id', tenantId)
    .eq('level', 'ad')
    .gte('date_start', since)
    .lte('date_start', today)
    .limit(20000);
  if (mErr) throw new Error('meta_insights: ' + mErr.message);
  const metaSpend = r2((mi || []).reduce((s, m) => s + (m.spend_cents || 0), 0) / 100);
  // Spend grouped by the Meta campaign_name as Meta records it (e.g. "PU | Cold | 10CM | Jun2026").
  // Kept separate from byCampaign (which keys on the lead's utm_campaign slug) because the two
  // identifiers do not match until ad UTMs are set to the Meta campaign id/name.
  const metaSpendByCampaign = Object.create(null);
  for (const m of (mi || [])) {
    const name = m.campaign_name || '(unknown)';
    metaSpendByCampaign[name] = r2((metaSpendByCampaign[name] || 0) + (m.spend_cents || 0) / 100);
  }

  // 3. Snapshot for Google spend (30d rollup) + current pipeline opportunities.
  // snapshot.googleAds is a FIXED 30d rollup, so it is only meaningful when the
  // cohort window is also 30d. Null it out for any other window rather than
  // report a 30d spend against a 7d or 90d lead cohort.
  const snap = await fetch(`${base}/api/snapshot`, { headers }).then((r) => r.json()).catch(() => null);
  const googleSpend = days === 30 ? r2(snap?.sections?.googleAds?.totals30d?.spend || 0) : null;

  // The booked/signed join is the core metric. If the pipeline fetch fails we
  // FAIL LOUD (throw -> 500 + cron alert) rather than emit a confidently-zero
  // funnel that reads as "nothing booked." clean=1 test-filters + dedupes by
  // contact identity so Cat's test personas do not inflate booked/signed counts.
  const pipe = await fetch(`${base}/api/ghl?mode=pipeline&clean=1&limit=1000`, { headers }).then((r) => r.json()).catch(() => null);
  if (!pipe || !Array.isArray(pipe.opportunities)) {
    throw new Error('pipeline fetch failed or returned no opportunities array (cannot compute booked without it)');
  }
  const opps = pipe.opportunities;

  // Best outcome per contact across their opportunities.
  const outcome = new Map(); // contactId -> { booked, signed }
  for (const o of opps) {
    const cid = String(o.contactId || '');
    if (!cid) continue;
    const stage = (o.stage || '').toLowerCase();
    const cur = outcome.get(cid) || { booked: false, signed: false };
    if (BOOKED_STAGES.some((s) => stage.includes(s))) cur.booked = true;
    if (SIGNED_STAGES.some((s) => stage.includes(s))) cur.signed = true;
    outcome.set(cid, cur);
  }

  // 3b. Estimate-system signed signal. The GHL pipeline stage goes stale because
  // the team accepts/schedules in the estimate system without dragging the GHL
  // card forward (e.g. Harmeet: estimate accepted + financed + scheduled, GHL opp
  // still "Quote Sent" at $0). Reading signed off GHL stage alone makes real,
  // ad-sourced wins invisible to the ROAS read. Union the customer's
  // ghl_contact_id from any accepted-or-beyond native estimate into the signed
  // set so a closed deal cannot hide. Won-set mirrors api/customer-state.js. The
  // join key (customers.ghl_contact_id) is the same id the leads carry in
  // metadata.ghl_contact_id, so an estimate-signed contact lines up with its lead.
  const { data: signedEsts, error: eErr } = await supabaseAdmin
    .from('estimates')
    .select('status, customer:customers(ghl_contact_id)')
    .eq('tenant_id', tenantId)
    .in('status', ['signed', 'accepted', 'scheduled', 'in_progress', 'complete'])
    .limit(5000);
  if (eErr) throw new Error('estimates: ' + eErr.message);
  for (const e of (signedEsts || [])) {
    const cid = String(e.customer?.ghl_contact_id || '');
    if (!cid) continue;
    const cur = outcome.get(cid) || { booked: false, signed: false };
    cur.signed = true;
    cur.booked = true; // signed implies an inspection happened (roofing inspects before signing)
    outcome.set(cid, cur);
  }

  // 4. Cohort roll-up: classify each windowed lead by its contact's outcome.
  // "booked" = reached an inspection stage OR signed (roofing inspects before signing).
  const chan = Object.create(null); // channel -> { leads, booked, signed }
  const camp = Object.create(null); // utm_campaign (lead.campaign) -> { leads, booked, signed }; null-proto so a utm value like __proto__ cannot pollute or drop a lead
  const bucket = (map, k) => (map[k] || (map[k] = { leads: 0, booked: 0, signed: 0 }));
  for (const l of (leads || [])) {
    const gid = String(l.metadata?.ghl_contact_id || '');
    const st = outcome.get(gid);
    const signed = !!st?.signed;
    const booked = !!(st?.booked || st?.signed);
    const cb = bucket(chan, l.channel || 'direct');
    cb.leads += 1; if (signed) cb.signed += 1; if (booked) cb.booked += 1;
    const kb = bucket(camp, l.campaign || '(none)');
    kb.leads += 1; if (signed) kb.signed += 1; if (booked) kb.booked += 1;
  }

  // 5. Assemble per-channel block with spend joined in.
  const spendByChannel = { meta: metaSpend, google: googleSpend, lsa: 0 };
  const channels = new Set([...Object.keys(spendByChannel), ...Object.keys(chan)]);
  const byChannel = {};
  for (const ch of channels) {
    const spend = spendByChannel[ch] || 0;
    const c = chan[ch] || { leads: 0, booked: 0, signed: 0 };
    byChannel[ch] = {
      spend: r2(spend),
      leads: c.leads,
      booked: c.booked,
      signed: c.signed,
      costPerLead: c.leads > 0 && spend > 0 ? r2(spend / c.leads) : null,
      costPerBooked: c.booked > 0 && spend > 0 ? r2(spend / c.booked) : null,
    };
  }

  // byCampaign: same cohort counts, keyed on the lead's utm_campaign. No spend join here on
  // purpose (utm slug != Meta campaign_name); pair it with metaSpendByCampaign by eye until aligned.
  const byCampaign = Object.create(null);
  for (const [k, c] of Object.entries(camp)) {
    byCampaign[k] = { leads: c.leads, booked: c.booked, signed: c.signed };
  }

  const totalSpend = r2(metaSpend + (googleSpend || 0));
  const totalLeads = Object.values(chan).reduce((a, b) => a + b.leads, 0);
  const totalBooked = Object.values(chan).reduce((a, b) => a + b.booked, 0);
  const totalSigned = Object.values(chan).reduce((a, b) => a + b.signed, 0);

  return {
    _source: 'ad-funnel feeder (meta_insights + snapshot.googleAds + leads + GHL pipeline)',
    updated_at: new Date().toISOString(),
    windowDays: days,
    byChannel,
    byCampaign,
    metaSpendByCampaign,
    campaignNote: 'byCampaign groups REAL captured leads by their utm_campaign and counts how many booked or signed, which answers which campaign is producing booked inspections. metaSpendByCampaign is spend grouped by the Meta campaign_name. They are reported separately on purpose: a utm_campaign slug (e.g. storm_salisbury, cold_ie_video) is not the Meta campaign_name (e.g. "PU | Cold | 10CM | Jun2026"), so a per-campaign cost-per-booked is NOT auto-joined to avoid a wrong number. To unlock true per-campaign cost-per-booked, set each ad utm_campaign to its Meta campaign id or exact name so the two line up.',
    blended: {
      spend: totalSpend,
      leads: totalLeads,
      booked: totalBooked,
      signed: totalSigned,
      costPerLead: totalLeads > 0 ? r2(totalSpend / totalLeads) : null,
      costPerBooked: totalBooked > 0 ? r2(totalSpend / totalBooked) : null,
    },
    note: 'Leads are REAL captured CRM leads (smaller than Meta pixel "lead" events). Booked = a windowed lead whose GHL contact reached an inspection stage or beyond; signed = that contact has a GHL opp in a signed stage OR an accepted-or-beyond native estimate (the estimate-system signal catches deals closed/financed without the GHL card being dragged forward). Joined via ghl_contact_id; leads with no matching ad attribution fall to "direct". Google spend is the 30d rollup from snapshot.googleAds. LSA spend is not wired yet (0). Booked/signed are current-state cohort reads, so a deal closed outside the window can shift counts.',
  };
}

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET' && req.method !== 'POST') return res.status(405).json({ error: 'GET or POST only' });

  const auth = await requireCronOrOwner(req);
  if (!auth.ok) return res.status(401).json({ error: auth.error });

  try {
    const slug = (req.query?.tenant || 'plus-ultra').toString();
    const { data: ten, error: tErr } = await supabaseAdmin
      .from('tenants').select('id').eq('slug', slug).maybeSingle();
    if (tErr) throw new Error('tenant lookup: ' + tErr.message);
    if (!ten) return res.status(404).json({ error: `tenant not found: ${slug}` });

    // The booked/signed join reads /api/ghl + /api/snapshot, both hardwired to
    // Plus Ultra's GHL location (api/ghl.js LOCATION_ID) and x-tenant-id
    // (lib/snapshotClient.js). Until that path is tenant-aware, refuse other
    // tenants rather than join tenant X's leads against Plus Ultra's pipeline.
    if (slug !== 'plus-ultra') {
      return res.status(400).json({ error: 'ad-funnel is plus-ultra-only until the GHL pipeline + snapshot self-calls are tenant-scoped' });
    }

    const days = Math.min(Math.max(parseInt(req.query?.days || '30', 10) || 30, 1), 365);
    const base = `https://${req.headers.host || 'ryujin-os.vercel.app'}`;
    const headers = snapshotHeaders();

    const adFunnel = await buildAdFunnel(ten.id, base, headers, days);

    const post = await fetch(`${base}/api/snapshot`, {
      method: 'POST', headers, body: JSON.stringify({ adFunnel }),
    });

    return res.status(200).json({ ok: post.ok, posted: post.status, adFunnel });
  } catch (e) {
    console.error('[ad-funnel feeder]', e.message);
    return res.status(500).json({ error: e.message });
  }
}
