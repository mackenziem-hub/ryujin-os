// Save the NanoSeal NB / Plus Ultra partnership program to Ryujin admin docs.
// Inserts 5 docs records (4 artifacts + master index) for the plus-ultra tenant.
// Idempotent: upserts by (tenant_id, slug).
// 2026-05-13

import fs from 'node:fs';
import path from 'node:path';

const envPath = path.resolve('.env.local');
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^([A-Z_][A-Z0-9_]*)\s*=\s*(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
  }
}

const PAT = process.env.SUPABASE_PAT || process.env.SUPABASE_ACCESS_TOKEN;
const projectRef = (process.env.SUPABASE_URL || '').match(/https:\/\/([^.]+)\./)?.[1];
if (!PAT || !projectRef) { console.error('Missing SUPABASE_PAT or SUPABASE_URL'); process.exit(1); }

async function sql(query) {
  const r = await fetch(`https://api.supabase.com/v1/projects/${projectRef}/database/query`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${PAT}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query })
  });
  const body = await r.text();
  if (!r.ok) throw new Error(`SQL HTTP ${r.status}: ${body}`);
  try { return JSON.parse(body); } catch { return body; }
}

function escapeSqlString(s) {
  return s.replace(/'/g, "''");
}

const tenant = (await sql(`select id from tenants where slug = 'plus-ultra' limit 1`))[0];
console.log(`Tenant: ${tenant.id}`);

const COMPANYCAM_GALLERY = 'https://app.companycam.com/galleries/Hz3XTfPe';
const PROPOSAL_HERO = 'https://d8j0ntlcm91z4.cloudfront.net/user_3DD6hYE3a5mN88Q6BxNtqBGzInz/hf_20260513_011733_808b4527-db16-44a1-ad05-5cf1792e2906.png';
const GIVEAWAY_HERO = 'https://d8j0ntlcm91z4.cloudfront.net/user_3DD6hYE3a5mN88Q6BxNtqBGzInz/hf_20260513_013115_0883d101-fee6-44a9-bded-ab2cda1191a5.png';
const BEFORE_AFTER = 'https://d8j0ntlcm91z4.cloudfront.net/user_3DD6hYE3a5mN88Q6BxNtqBGzInz/hf_20260513_011736_b84dee23-9270-416f-ba45-41213489a2fa.png';
const LIVESTREAM_HERO = 'https://d8j0ntlcm91z4.cloudfront.net/user_3DD6hYE3a5mN88Q6BxNtqBGzInz/hf_20260513_013118_464544fd-0ce1-45fa-bed4-482e71c7c17f.png';
const MARKET_HERO = 'https://d8j0ntlcm91z4.cloudfront.net/user_3DD6hYE3a5mN88Q6BxNtqBGzInz/hf_20260513_014233_712354fe-d2dc-489c-a444-792b0e732ff2.png';

const docs = [
  {
    slug: 'nanoseal-program-index',
    title: 'NanoSeal NB Partnership Program — Master Index',
    summary: 'Master index of all artifacts for the Plus Ultra × NanoSeal NB partnership: Tara Court proposal, partnership brief, summer 2026 campaign deck, and supporting reference materials.',
    hero_image: MARKET_HERO,
    markdown: `# NanoSeal NB Partnership Program · Master Index

**Status:** Active · DRAFT for partner review · 2026-05-13
**Partner:** Ben Crocker, NanoSeal NB Ltd. (\`benc@nanosealnb.ca\` · 506-886-2273)
**Owner:** Mackenzie Mazerolle, Plus Ultra Roofing

## The deliverables (live URLs)

| Doc | URL | Audience |
|---|---|---|
| **Tara Court APHL Proposal** | [tara-court-aphl.html](/tara-court-aphl.html) | Kevin Chase + APHL Board (client-facing) |
| **Tara Court Partner Draft** | [tara-court-proposal.html](/tara-court-proposal.html) | Ben (DRAFT for review, pricing pending) |
| **Partnership Brief** | [nanoseal-partnership.html](/nanoseal-partnership.html) | Ben (3 sections: candidate map + marketing + giveaway) |
| **Summer 2026 Campaign Deck** | [summer-campaign-2026.html](/summer-campaign-2026.html) | Ben (16 slides, workshop draft) |
| **GoNano Score Sheet** | [gonano-shingle-death-score.pdf](/gonano-shingle-death-score.pdf) | Reference (Ben's official rubric) |

## Tara Court Pricing (Plus Ultra Estimate · pending Ben's confirmation)

- **Option A — Conservative Pilot:** $23,891 incl. HST · 88% saved vs full replacement
- **Option B — Standard Investment:** $62,734 incl. HST · 68% saved · **Recommended**
- **Option C — Comprehensive Refresh:** $95,153 incl. HST · 52% saved
- **Full replacement comparison:** $197,886 (6 buildings × $32,981 incl. HST · May 2025 amended estimate)

## Property at a glance

- **Tara Court Condominiums** — 126 Lakeside Drive, Riverview NB E1B 3G9
- **Owner:** Appropriate Housing Matters Inc. (APHL)
- **Decision-maker:** Kevin Chase, Manager of Property Services
- **Site:** ~6 buildings, ~282 SQ total roof area
- **Inspection date:** April 24, 2026
- **CompanyCam gallery:** [Hz3XTfPe](${COMPANYCAM_GALLERY})

## Section scoring summary (282 SQ total)

- **Fortify™ candidates** (already replaced): 14 SQ
- **Revive™ strong candidates** (score +1 to +5): 163 SQ
- **Revive™ approval-gated** (score -1 to +1): 9 SQ
- **Bio-Boost™ candidates** (score -3 to -1): 49 SQ
- **Full replacement** (Building 3, score -9): 47 SQ

## Market potential (Greater Moncton)

- **TAM:** $69M (24,800 rejuvenation-eligible SFH + ~300 multi-family)
- **SAM:** $20M (Plus Ultra's geographic + brand footprint)
- **SOM Year 1:** $500K-$1.1M (residential + commercial combined)
- **3-year trajectory:** $1.5-2.5M annual revenue

## Competitive landscape

- **No Roof Maxx dealer in Atlantic Canada** as of May 2026
- **No competing nanotech roof product** in Greater Moncton
- **No local roofer marketing rejuvenation** as a service
- **NanoSeal NB exclusive dealer status** in NB = product moat
- **12-18 month launch window** before competitive franchise entry

## Open decisions (for Ben tomorrow)

1. CertainTeed warranty compatibility — written confirmation required
2. Per-SQ pricing across all three products (Fortify / Revive / Bio-Boost)
3. Cleaning prep — included or separate line item
4. Wind-rating support for Building 5 corridor
5. Bio-Boost™ acceptance scope for Building 3 + Building 6 older sections
6. Territory exclusivity in Greater Moncton (12-month tied to volume)
7. Co-marketing budget commitment for summer campaign (~$3.9K NanoSeal share)
8. Save A Roof giveaway product donation (~$2K Revive cost for one home)

## Source materials (local · Plus Ultra/Partnerships/)

- \`NanoSealNB - Ben Crocker.md\` (contact + partnership overview)
- \`NanoSealNB/00-NotebookLM-Source-Index.md\`
- \`NanoSealNB/01-Contact-and-Status.md\`
- \`NanoSealNB/02-How-It-Works.md\`
- \`NanoSealNB/Fortify-Technical-Data-Sheet.pdf\`
- \`NanoSealNB/Revive-Technical-Data-Sheet.pdf\`
- \`NanoSealNB/Shingle-Death-Score-Calculator.pdf\`
- \`2026-05-13 Ben Meeting - 00 Mac's Internal Agenda.md\` (NOT for sharing)
- \`2026-05-13 Ben Meeting - 01 Tara Court Candidate Map.md\`
- \`2026-05-13 Ben Meeting - 02 Marketing Collaboration Proposal.md\`
- \`2026-05-13 Ben Meeting - 03 Giveaway Campaign Concept.md\`

## History

- 2026-04-10 — Ben Crocker reached out via Darcy on Facebook DM
- 2026-04-17 — First phone call (Mac + Ben)
- 2026-04-21 — Ben sent Dragon's Den GoNano segment
- 2026-04-24 — Inspection of Tara Court (Plus Ultra crew)
- 2026-05-04 — Ben sent product information packet (Revive, Fortify, How It Works)
- 2026-05-05 — Mac sent inspection report to Kevin + commercial-candidate Loom to Ben
- 2026-05-07 — Ben sent the Shingle Death Score rubric
- 2026-05-12 — Mac built Tara Court candidate map + partnership brief + giveaway concept
- 2026-05-13 — In-person meeting with Ben (final pricing + terms)
`,
    status: 'published'
  },
  {
    slug: 'tara-court-aphl-proposal',
    title: 'Tara Court Roof Rejuvenation — APHL Proposal (Final)',
    summary: 'Client-facing proposal for Appropriate Housing Matters Inc. covering 282 SQ of roof across 6 buildings at Tara Court Condominiums. Three options: Conservative Pilot ($23,891), Standard Investment ($62,734 · recommended), Comprehensive Refresh ($95,153). Up to 88% savings versus full replacement.',
    hero_image: PROPOSAL_HERO,
    markdown: `# Tara Court Roof Rejuvenation — APHL Proposal

**Live page:** [/tara-court-aphl.html](/tara-court-aphl.html)
**Property:** Tara Court Condominiums · 126 Lakeside Drive, Riverview NB
**Client:** Appropriate Housing Matters Inc. (APHL)
**Prepared for:** Kevin Chase, Manager of Property Services
**Prepared by:** Mackenzie Mazerolle, Plus Ultra Roofing
**Co-branded:** NanoSeal NB Ltd. (exclusive GoNano dealer)
**Date:** 2026-05-13 · Valid 30 days

## Three options

### Option A — Conservative Pilot · $23,891 incl. HST
- 163 SQ NuRoof Revive™ + 14 SQ NuRoof Fortify™
- 10-year transferable + 15-year non-prorated warranties
- 88% savings vs full replacement ($173,995 saved)

### Option B — Standard Investment · $62,734 incl. HST · **RECOMMENDED**
- Everything in Option A + 9 SQ Revive gated + 49 SQ Bio-Boost™ + 47 SQ Building 3 replacement
- 68% savings vs full replacement ($135,152 saved)
- One co-ordinated project window
- Defers Building 6 replacement another 7-10 years via Bio-Boost

### Option C — Comprehensive Refresh · $95,153 incl. HST
- Everything in Option B + replace Building 6 older + Fortify all newly-replaced sections
- Every roof on the property protected 10-15+ years
- 52% savings vs full replacement ($102,733 saved)

## Why Option B is recommended

It's the best dollar-for-dollar outcome. Eliminates the worst building from the deferred-maintenance list, protects the majority of the property for the next 10-15 years, and avoids spending the difference to replace a section that Bio-Boost can extend for a fraction of the cost.

## Property summary

- **6 buildings · 282 SQ total**
- **63% Revive eligible** · **17% Replacement** · **17% Bio-Boost candidates** · **5% Fortify**
- **Inspection date:** April 24, 2026
- **Inspection gallery (CompanyCam):** [Hz3XTfPe](${COMPANYCAM_GALLERY})

## Pricing methodology

All GoNano product pricing reflects Plus Ultra's estimated rate per NanoSeal NB's certified network. Quoted amounts include HST 15%. Replacement pricing based on the May 2025 Tara Court amended estimate ($32,981 incl HST per typical 47.32 SQ building).

| Product | Rate (pre-HST) | Warranty |
|---|---|---|
| NuRoof Fortify™ | $145/SQ | 15-yr non-prorated |
| NuRoof Revive™ | $115/SQ | 10-yr transferable |
| NuRoof Revive™ (gated) | $115/SQ | 10-yr transferable · approval required |
| Bio-Boost™ | $85/SQ | Prorated |
| Full replacement (Landmark) | $608/SQ | 10-yr Plus Ultra workmanship + 15-yr CertainTeed SureStart |

## Authorization

Three options on the cover. 30% deposit on signing. Estimates valid 30 days. Cancellation refund within 15 days of signing.
`,
    status: 'published'
  },
  {
    slug: 'tara-court-partner-draft',
    title: 'Tara Court Proposal — Partner Review Draft (for Ben)',
    summary: 'DRAFT version of the Tara Court APHL proposal with partner-review banner. Same content as the final, plus a "pricing pending confirmation" callout. For Ben Crocker (NanoSeal NB) to review pricing before Mac sends to Kevin.',
    hero_image: PROPOSAL_HERO,
    markdown: `# Tara Court Proposal — Partner Review Draft

**Live page:** [/tara-court-proposal.html](/tara-court-proposal.html)
**Purpose:** Identical content to the [APHL final proposal](/tara-court-aphl.html), but with a DRAFT watermark and "Pricing pending Ben's confirmation" callout for partner review.

## Workflow

1. Ben reviews this draft tomorrow
2. Ben confirms per-SQ pricing for NuRoof Fortify™, Revive™, Bio-Boost™
3. Plus Ultra updates the [final APHL proposal](/tara-court-aphl.html) with confirmed rates
4. Mac sends final proposal to Kevin Chase (APHL)

## Key open items for Ben

- Per-SQ pricing for all three products
- Cleaning prep included or separate line item
- Wind-rating support data (Building 5 corridor)
- Bio-Boost™ acceptance for Buildings 3 + 6 older sections
- Application logistics (who applies, time per SQ, weather window)
`,
    status: 'draft'
  },
  {
    slug: 'nanoseal-partnership-brief',
    title: 'Plus Ultra × NanoSeal NB — Partnership Brief',
    summary: 'Three-section partnership brief for Ben Crocker covering the Tara Court candidate map (12 sections scored with eligibility flags), three co-marketing plays (co-branded landing page, joint FB ad campaign, lead magnet), and the Save A Roof Moncton giveaway concept with investment split.',
    hero_image: PROPOSAL_HERO,
    markdown: `# Plus Ultra × NanoSeal NB — Partnership Brief

**Live page:** [/nanoseal-partnership.html](/nanoseal-partnership.html)
**For:** Ben Crocker, NanoSeal NB Ltd.
**Prepared by:** Mackenzie Mazerolle, Plus Ultra Roofing
**Date:** 2026-05-13

## Three sections

### 01 · Tara Court Candidate Map
Building-by-building eligibility breakdown using Ben's official GoNano Shingle Death Score rubric. 12 sections scored across the property, with eligibility flagged (Fortify / Revive / Revive-gated / Bio-Boost / Replace). Score chart visualized with actual CompanyCam photos.

### 02 · Marketing Collaboration
Three co-marketing plays:
- **Play 1 — Co-branded landing page** (fast win, 1-2 days build)
- **Play 2 — Joint Facebook ad campaign** ($2K-4K/mo, 50/50 split)
- **Play 3 — Co-branded lead magnet** (organic SEO play)

Plus Plus Ultra asks: 12-month Greater Moncton territory exclusivity, marketing co-investment, volume pricing on all three products.

### 03 · Save A Roof Moncton Giveaway
Community-focused contest: free GoNano rejuvenation for a deserving Greater Moncton home. NanoSeal donates the product (~$2K), Plus Ultra donates labor. Investment split table, press angle, 12-week timeline, expected outcomes (100-300 leads, 1+ earned media piece).

## Key open questions for Ben

1. **CertainTeed warranty compatibility** — hard non-negotiable
2. **Per-SQ pricing** for Fortify / Revive / Bio-Boost
3. **Territory exclusivity** in Greater Moncton (12 months tied to volume thresholds)
4. **Co-marketing budget** commitment
5. **Save A Roof product donation** confirmation
6. **Cleaning prep** included or separate
7. **Bio-Boost™ acceptance** scope for older sections
`,
    status: 'published'
  },
  {
    slug: 'summer-campaign-2026',
    title: 'Summer 2026 Marketing Campaign — Plus Ultra × NanoSeal NB',
    summary: '16-slide workshop deck for the May-September 2026 GoNano launch in Greater Moncton. Four audience segments × five core plays. Total campaign budget $10,900 ($7K Plus Ultra / $3.9K NanoSeal). Projected revenue $120K-$320K. TAM/SAM/SOM analysis: $69M / $20M / $500K-$1.1M Year 1.',
    hero_image: GIVEAWAY_HERO,
    markdown: `# Summer 2026 Marketing Campaign Deck

**Live page:** [/summer-campaign-2026.html](/summer-campaign-2026.html)
**Window:** May → September 2026 (NB roofing season)
**Co-brand:** Plus Ultra × NanoSeal NB
**Status:** v0.1 · Workshop draft · Open for input from Ben

## Audience map (4 segments)

| Segment | Type | Size | Avg Deal | Avg ROI |
|---|---|---|---|---|
| **HOT** — APHL & Commercial Accounts | Hot | ~3 accounts | $50-200K | High |
| **WARM** — Past Plus Ultra Clients | Warm | 200+ records | $2-5K | High |
| **COLD** — Greater Moncton Homeowners | Cold | ~80K addressable | $2-5K | Medium |
| **COMMUNITY** — Greater Moncton at large | Earned | City-wide | Pipeline | High org. |

## Five core plays

1. **Play A · APHL Pipeline (HOT)** — Tara Court close + portfolio expansion. Time investment only. $60-200K revenue projection.
2. **Play B · Past Client Re-engagement (WARM)** — 3-email sequence + SMS + Loom for top 20. ~$300 cost. $10-25K revenue.
3. **Play C · Save A Roof Moncton Giveaway (COMMUNITY)** — Free rejuvenation, June launch. PU $1,200 + crew day, NanoSeal $700 + product. Pipeline builder.
4. **Play D · Livestream / Webinar Series (COLD)** — Monthly "Ask the Roofer." Co-hosted Mac + Ben. ~$1K total. Pipeline + brand authority.
5. **Play E · Co-branded Landing Page + Paid Ads (ALL)** — $6K total (50/50 split). $30-60K revenue. The conversion infrastructure under everything else.

## Investment & ROI

- **Total budget:** $10,900 ($7K Plus Ultra · $3.9K NanoSeal)
- **Projected revenue:** $120K-$320K
- **ROAS:** 11× worst case · 29× best case

## Market sizing

- **TAM:** $69M (Greater Moncton rejuvenation market)
- **SAM:** $20M (Plus Ultra's reachable footprint, ~30% of TAM)
- **SOM Year 1:** $500K-$1.1M
- **3-year trajectory:** $1.5-2.5M annual

## Competitive landscape

**Nobody is in this space in Greater Moncton.**
- No Roof Maxx dealer in Atlantic Canada (300+ in US, zero in NB)
- No competing nanotech product
- No local roofer marketing rejuvenation as a service
- **12-18 month window** before franchise competition arrives

## KPIs (September 30 scoreboard)

- $120K+ GoNano-attributed revenue closed
- $300K+ open pipeline tagged "GoNano"
- 400+ net-new leads captured
- 1+ APHL deal signed
- 1+ earned media piece (Save A Roof)
- Page-1 Google for "roof rejuvenation Moncton"

## Risk pre-mortem (5 failure modes)

1. **CertainTeed warranty incompatibility** — Critical. Hard gate.
2. **APHL board deferral** — Medium-high likelihood. Option A as discretionary spend; past-client play in parallel.
3. **Save A Roof zero earned media** — Medium. $1K paid floor + journalist pre-brief mitigates.
4. **Roof Maxx enters NB mid-summer** — Low. Lock exclusivity by May 31.
5. **Crew capacity bottleneck** — Low. Hire seasonal crew if needed.

## Decisions needed tomorrow (from Ben)

1. Co-marketing budget commitment (~$3.9K across season)
2. Save A Roof product donation (one home's Revive ≈ $2K)
3. Livestream co-host commitment (monthly OR one-shot launch event)
4. Territory exclusivity (12-month Greater Moncton tied to volume)

## Decisions this week (Mac alone)

1. Past client GHL segmentation
2. Save A Roof landing page build
3. UTM/CRM tag schema standardization
4. Vehicle wrap timing
`,
    status: 'published'
  }
];

let inserted = 0, updated = 0;
for (const d of docs) {
  const existing = await sql(`select id, version from docs where tenant_id = '${tenant.id}' and slug = '${d.slug}' limit 1`);
  if (existing.length) {
    const nextVersion = (existing[0].version || 1) + 1;
    await sql(`
      update docs
      set title = '${escapeSqlString(d.title)}',
          summary = '${escapeSqlString(d.summary)}',
          markdown = '${escapeSqlString(d.markdown)}',
          hero_image = '${escapeSqlString(d.hero_image)}',
          status = '${d.status}',
          version = ${nextVersion},
          updated_at = now()
      where id = '${existing[0].id}'
    `);
    updated++;
    console.log(`✓ Updated: ${d.slug} (v${nextVersion})`);
  } else {
    await sql(`
      insert into docs (tenant_id, slug, title, summary, markdown, hero_image, status, version)
      values (
        '${tenant.id}',
        '${d.slug}',
        '${escapeSqlString(d.title)}',
        '${escapeSqlString(d.summary)}',
        '${escapeSqlString(d.markdown)}',
        '${escapeSqlString(d.hero_image)}',
        '${d.status}',
        1
      )
    `);
    inserted++;
    console.log(`✓ Created: ${d.slug}`);
  }
}

console.log(`\n— Done. ${inserted} created · ${updated} updated.`);
console.log(`\nView in admin: https://ryujin-os.vercel.app/admin.html#documents`);
console.log(`Or directly at: https://ryujin-os.vercel.app/doc.html?slug=nanoseal-program-index`);
