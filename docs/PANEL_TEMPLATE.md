# Ryujin OS — Panel Template (4-Layer Pattern)

**Status:** Established 2026-05-09 during Marketing Panel v1. Reference implementation: `/admin-overview.html`. Marketing is the first panel built to this template.

---

## What is a Panel?

A **panel** is a domain-scoped slice of Ryujin OS. The platform-wide single pane is `/admin-overview.html`; each domain gets its own scoped pane.

## The 8 Canonical Pillars (locked May 10 2026)

Aligned with ServiceTitan / AccuLynx / Roofr industry standards for service-based contractor businesses. Validated against Plus Ultra's actual team boundaries (Mac/Catherine/Darcy/AJ/Ryan/Diego).

| # | Panel | Dashboard | Domain | Status |
|---|---|---|---|---|
| 1 | **HQ / Dashboard** | `/admin-overview.html` | Cross-domain rollup, Morning Briefing, Quest Board | ✅ shipped |
| 2 | **Marketing** | `/marketing.html` | Brands, posts, ads, leads, campaigns, content calendar | ✅ shipped |
| 3 | **Sales** | `/sales-portal.html` (→ `/sales.html` panel rebuild pending) | Pipeline, proposals, follow-ups, commissions | ◐ partial |
| 4 | **Production** | `/production.html` | Workorders, paysheets, jobs, materials, scheduling, tickets, **closeout** (post-prod folds in) | ✅ shipped |
| 5 | **Service** | `/service.html` (TBD) | Repairs, callbacks, warranty claims, ongoing maintenance — **AJ's domain** | 🆕 |
| 6 | **Customer / CRM** | `/customer.html` (TBD) | Customer database, history, lifetime value, **referrals**, reviews | 🆕 |
| 7 | **Finance** | `/finance.html` (TBD) | AR/AP, deposits, supplier payments, cashflow, P&L | 🆕 |
| 8 | **Admin / Settings** | `/admin.html` | Users, integrations, audit log, tenant settings | ✅ exists |

### Why this set (industry comparison)

| ServiceTitan pillar | Our pillar | Notes |
|---|---|---|
| Marketing | Marketing | Aligned |
| Sales | Sales | Aligned |
| Dispatch / Production | Production | + post-prod closeout phase folded in |
| Service | Service | Separate from Production — recurring revenue, AJ owns it |
| Customer / CRM | Customer | Aligned — lifetime value + referrals are pillar concerns |
| Accounting / Finance | Finance | Aligned |
| Inventory / Materials | (deferred — per-WO computation handles current scale; revisit for white-label v1.1) | |
| Reports / Analytics | (NOT a panel — admin-overview KPI Scouter + agent briefings cover this) | |
| Phone / Communications | (NOT a panel — GHL owns this externally) | |
| Memberships / Recurring | (N/A — replacement roofing is one-time) | |
| Office / Admin | Admin | Aligned |

### Cross-cutting (NOT panels)

- **Strategy agent** — synthesis layer. Reads cross-domain agent runs, emits weekly rollup into admin-overview. Lives in `lib/agents/strategy_scan.js`. No standalone surface.
- **Reports** — handled by admin-overview's KPI Scouter, Quest Board, and per-agent KPIs. Don't build a separate Reports panel.

### Where post-production lives

Post-production was originally a 5-page surface (closeout, walkthrough, reviews, warranties, hub). After comparison with ServiceTitan/AccuLynx (which use "Service" for ongoing repair work, NOT for closeout), post-production splits as follows:

- **Walkthrough, closeout, final invoice, warranty filing during the original job** → Production closeout phase (stays in production toolbar)
- **Reviews** → moves under Customer (`customer-reviews.html`)
- **Warranty claims (long-term, post-install)** → moves under Service (`service-warranties.html`)
- **Standalone post-production hub** → eventually deprecated

---

## The 4 Layers

Every panel exposes four interfaces:

### 1. Admin layer — `<domain>-admin.html`

**Purpose:** Configuration and tenant settings for the domain.

**Examples:** auto-post windows, brand defaults, integration toggles, lead-import config, KPI thresholds, alert rules.

**Persistence:** Writes through `/api/tenant-settings` (or domain-specific) into the `tenant_settings` table — typically as a JSONB blob like `tenant_settings.marketing_config`, `tenant_settings.production_config`, etc.

### 2. Agent layer — filtered view of `/admin-agents.html`

**Purpose:** That domain's archetypal agent — latest scan, manual run, history, full report.

**Implementation:** No new page needed. Deep-link to `/admin-agents.html?focus=<slug>` (e.g., `?focus=marketing`) which auto-opens the drawer for that agent. The agent card on the dashboard is the entry point.

**Mapping:** sales=hero · marketing=magician · ops=caregiver · finance=ruler · customer=lover · strategy=sage. Plain function names as labels — no DBZ branding (per IP rule, see `project_archetypal_agents_rename.md`).

### 3. Interactive layer — `<domain>-<tool>.html` (multiple pages)

**Purpose:** The operational tools — where real work happens.

**Examples (marketing):** brands, schedule, creatives, leads, content-calendar, campaign, strategy, ads, capture.

**Pattern:** Each tool is its own page. Pages share the same sidebar nav (which highlights the active panel + the active tool inside it). Each tool reads/writes through tightly-scoped APIs.

### 4. Advanced layer — `<domain>-advanced.html`

**Purpose:** Power-user tooling — rule editors, scenario simulators, custom queries.

**Examples:** "if Meta CPL > $X for 3 days, pause campaign and create urgent quest"; what-if simulators; audience targeting templates.

**v1 scope:** can stub the rule engine for one example rule type. The entry surface needs to exist so the layer is reachable; the engine matures over time.

---

## The Panel Dashboard (`<domain>.html`)

This is the **single pane of glass for the domain** — what an operator opens first when they're working on that domain.

### Required structure

```
┌─────────────────────────────────────────────────────────┐
│ [sidebar]  Header: domain name + crumb + user pills     │
│            Banner slot (warn/info)                      │
│                                                         │
│            ┌──── 4-Layer Quick Access (cards/row) ────┐ │
│            │ Admin · Agent · Interactive · Advanced  │ │
│            └─────────────────────────────────────────┘ │
│                                                         │
│            Domain Morning Briefing                      │
│            (briefing_items where source_agent=<domain>) │
│                                                         │
│            Domain KPI Scouter (filtered KPIs)           │
│                                                         │
│            Domain Activity Timeline                     │
│            (last 20 events: agent_runs + domain tables) │
└─────────────────────────────────────────────────────────┘
```

### Required data sources

The dashboard pulls from a single bundled endpoint: `/api/<domain>-state` (e.g., `/api/marketing-state`). The endpoint:

- Filters `briefing_items` to `source_agent = <domain>` AND today's date
- Reads KPIs from `kpis` table where `key LIKE '<domain>.%'`
- Pulls latest 20 events: `agent_runs` rows for that domain + domain-specific tables (e.g., scheduled_posts for marketing)
- Returns the lifecycle counts / summary stats the dashboard needs

### Required behavior

- Auto-refresh every 5 min (`setInterval(load, 5 * 60 * 1000)`)
- Graceful warn banner when migrations missing (detects `relation does not exist` in 500 responses)
- Empty states for every section (no data → friendly message + CTA)
- Per-user filter pills (Mac · Catherine · Darcy) match admin-overview behavior; localStorage key `overview_active_user` shared

---

## Visual & Interaction Conventions

**Operator-track palette only** (cyan + purple + glassmorphic on dark navy):

```css
:root{
  --bg:#060a14;
  --glass:rgba(20,30,50,0.85);
  --glass2:rgba(22,34,58,0.80);
  --glass-border:rgba(34,211,238,0.16);
  --glass-border-hi:rgba(34,211,238,0.35);
  --text:#d0daf0;
  --text-dim:rgba(160,190,230,0.55);
  --text-muted:rgba(140,170,220,0.30);
  --cyan:#22d3ee;
  --blue:#4a9eff;
  --purple:#7c3aed;
  --green:#4ade80;
  --yellow:#facc15;
  --red:#f87171;
  --orange:#fb923c;
  --gold:#fbbf24;
  --radius:12px;
  --sidebar-w:72px;
}
```

**Customer-facing surfaces are a SEPARATE track** (warm/cream, no sci-fi). Only `instant-estimator.html` and `proposal-client.html` follow that aesthetic; those rules don't apply here. See `feedback_jewels_visual_rules.md`.

**Typography:**
- Body: `Inter`
- Section headers, KPI numbers, agent names: `Orbitron`
- Timestamps, codes, monospace bits: `Share Tech Mono`

**Common panel components** (reuse CSS classes):
- `.panel`, `.panel-header`, `.panel-title` — glassmorphic cards with corner brackets + top-edge gradient line
- `.section-head` + `.count-pill` — section headers with item counts
- `.brief-card` (with `.urgent`/`.high` modifiers) — Morning Briefing items
- `.quest-card`, `.quest-cat`, `.quest-type`, `.quest-xp` — Quest Board cards
- `.kpi-tile`, `.kpi-label`, `.kpi-value` — KPI Scouter tiles
- `.user-pill` — per-user filter pills
- `.empty-state`, `.skeleton` — loading + empty
- `.banner.warn`, `.banner.info` — top-of-page banners

### Sidebar nav rules

Every panel uses the same 72px-wide icon rail. Active panel's icon highlights with the active state (cyan accent + left bar). Inside a panel, sub-tools can be accessed from the dashboard's interactive layer cards or via a secondary tab strip below the header.

---

## File Naming Convention

| Purpose | Pattern | Example |
|---|---|---|
| Panel dashboard | `<domain>.html` | `marketing.html` |
| Admin layer | `<domain>-admin.html` | `marketing-admin.html` |
| Advanced layer | `<domain>-advanced.html` | `marketing-advanced.html` |
| Interactive tools | `<domain>-<tool>.html` | `marketing-leads.html`, `marketing-ads.html` |
| Bundled state endpoint | `api/<domain>-state.js` | `api/marketing-state.js` |
| Domain-specific endpoints | `api/<resource>.js` | `api/campaigns.js`, `api/leads.js` |

Agent layer does NOT get its own page — it's `/admin-agents.html?focus=<slug>`.

---

## Building a New Panel — Steps

1. Copy `public/_panel-template.html` to `public/<domain>.html`. Replace placeholders.
2. Write `api/<domain>-state.js` modelled on `/api/state` but filtered to domain. Bundles briefing + KPIs + activity for the dashboard.
3. Build interactive tool pages as needed (`<domain>-<tool>.html`) and their endpoints.
4. Write `<domain>-admin.html` for settings (always small — usually a form into `tenant_settings.<domain>_config`).
5. Write `<domain>-advanced.html` (often stubs entries for future rule engines).
6. Wire the agent: agent already exists in `api/agents/_shared.js` and the `cron-daily.js` orchestrator. Just make sure `KPI_MAPS.<slug>` in cron-daily covers the named stats you want surfaced.
7. Add the panel to the sidebar nav across all admin pages (small edit).
8. Manus product audit on the dashboard + interactive pages before merge. Verdict ≥ minor-polish.

---

## Reference Implementation

The canonical example is `/admin-overview.html` plus its endpoints (`api/state.js`, `api/quests.js`, `api/kpis.js`). Marketing v1 (this rebuild) is the first scoped panel to follow this template; production / sales / finance / customer / ops follow next.

When in doubt, `git diff` against the marketing panel's PR to see how the pattern was applied.
