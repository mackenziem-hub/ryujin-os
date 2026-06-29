// Cost Explorer data source. Owner/admin only.
// Serves the cost-anatomy tree (hard cost, margin, overhead, CAC) that the
// cost-explorer.html mind map renders. This data is sensitive (the exact stuff
// the sales-framing rules say customers must never see), so it lives behind a
// real server-side session gate, NOT embedded in the static page.
//
// V1 returns a curated tree built from the live engine run for Atis. Next:
// wire to lib/quoteEngineV3 calculateMultiOfferQuote so any estimate streams in.
import { requirePortalSessionAndTenant, isPrivileged } from '../lib/portalAuth.js';

const TREES = {
  atis: {
    label: 'Atis Balume · 2 Shediac River Rd S · 13 SQ',
    days: 2,
    tiers: {
      gold:     { sell: 10875, floor: 9079,  lead: 10875, material: 3411, labor: 3645, overhead: 1023 },
      platinum: { sell: 11975, floor: 9575,  lead: 11975, material: 3900, labor: 3645, overhead: 1023 },
      diamond:  { sell: 15075, floor: 11075, lead: 15075, material: 5400, labor: 3645, overhead: 1023 }
    },
    children: {
      material: [
        ['Architectural shingles', 0.603, '42 bundles', '13.1 SQ x 3 bundles/SQ + 15% waste', 'Merchant DB · CertainTeed Landmark $49/bdl'],
        ['Drip edge', 0.079, '15 lengths', 'Eaves 153 LF + rakes 121 LF', '$17.99 / 10ft piece'],
        ['Synthetic underlayment', 0.073, '2 rolls', 'Full field, 13.1 SQ', '$125 / 10-SQ roll'],
        ['Ice and water shield', 0.068, '2 rolls', 'Eaves, valleys, chimney', 'Grace $116 / 2-SQ roll'],
        ['Starter strip', 0.042, '2 bundles', 'Eave plus rake perimeter', '$72 / bundle'],
        ['Hip and ridge cap', 0.039, '2 bundles', 'Ridges 36 LF + hips 12 LF', '$67 / bundle'],
        ['Ridge vent', 0.037, '1 roll', '34 LF ridge', '$125 / roll'],
        ['Coil nails and caulk', 0.040, '2 boxes + 2 tubes', 'Fasteners and sealant', 'Merchant DB'],
        ['Pipe flashing', 0.019, '3 boots', '3 penetrations', '$20 each']
      ],
      labor: [
        ['Sub install and tear-off', 0.653, '13.1 SQ', 'Base $130/SQ + $40/SQ second-layer', 'Atlantic rate sheet · pitch-banded 4-6/12'],
        ['Dump bin', 0.123, '1 bin', 'Ryan-supplied on every job', 'Atlantic rate sheet $450 flat'],
        ['Supervisor', 0.148, '2 days', 'On-site, $270/day', 'tenant_settings.supervisor_day_rate'],
        ['Flashing, vents, valley metal', 0.076, '63 LF + 3 boots + 19 LF', 'Step flash, pipe boots, valleys', 'Rate sheet line items']
      ],
      overhead: [
        ['Daily burn', 0.542, '2 days', '$277/day true daily burn', 'RBC scrape / 91 days'],
        ['Customer acquisition', 0.458, 'per booked job', 'Blended CAC', 'Meta spend / bookings ~$469'],
        ['Sales commission', 0.0, 'owner-sold', '0% self/IE · 10% if a rep closes', 'Locked pricing model']
      ],
      net: [
        ['Per crew-day', null, 'flexes with the slider', 'Floor is $500/day, never below', 'Locked model'],
        ['Margin', null, 'share of selling price', 'Gross of real overhead already removed', 'Locked model'],
        ['Room to floor', null, 'how far you can drop', 'And still clear $500/day net', 'Negotiation range']
      ]
    }
  }
};

async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'method_not_allowed' });
  if (!isPrivileged(req.session)) return res.status(403).json({ error: 'forbidden', code: 'OWNER_ADMIN_ONLY' });
  const jobs = Object.entries(TREES).map(([id, t]) => ({ id, label: t.label }));
  const job = String(req.query.job || 'atis');
  const tree = TREES[job];
  if (!tree) return res.status(404).json({ error: 'unknown_job', jobs });
  return res.status(200).json({ job, jobs, tree });
}

export default requirePortalSessionAndTenant(handler);
