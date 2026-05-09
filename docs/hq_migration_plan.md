# Plus Ultra HQ → Ryujin Migration Plan

**Status:** Plan only. Nothing ported tonight.
**Source:** `C:\Users\Owner\OneDrive\Desktop\Shenron\plus-ultra-hq\` (Next.js + standalone `public/hq.html`, 2611 lines).
**Goal (Mac's framing):** "Move it over. It had a lot of great assets for keeping me on track."

---

## 1. What's actually in HQ

### Keep-on-track core (Mac's stated value)
| Feature | What it does | Data needs |
|---------|--------------|-----------|
| **Morning Briefing** | Shenron's daily summary at top of dashboard. Cross-functional priorities. | Aggregated state from quests + KPIs + agents |
| **Quest Board** | Daily / campaign / optional quests with XP rewards, categories (sales/marketing/ops/finance/team/seo), search, filter. | New `quests` table |
| **Power Level / XP / Levels** | Gamification — quests give XP, XP gives levels (Genin Roofer → ?). Daily/weekly XP tracking. | XP ledger on quests + user_xp aggregate |
| **Dragon's Challenge** | Weekly target (15 quests/week → +500 XP bonus). | Derived from quests |
| **KPI Scouter** | Click-to-update KPI tiles. Saves on edit. | New `kpis` table per tenant |
| **Z Fighter Council** | 6 AI agent personas, each owns a domain (Shenron=master, Yamcha=marketing KPIs, Krillin=finance, Vegeta=competition, Bulma=marketing director, Goku=ops, Piccolo=security). Each card shows live metrics + tasks + a written report. | Agent definitions + per-agent live data feeds |
| **Achievements** | Unlockable badges/rewards. Gamification reinforcement. | Achievement definitions + unlock state |

### Workflow integrations
- **Gmail widget** — live inbox, badge count, link to message. Needs Google OAuth (lib/google.js untracked in repo — partially wired?)
- **Calendar widget** — today/upcoming events. Same OAuth.
- **Quick Access tiles** — open local OneDrive folders (Jobs/Sales/Marketing/Proposals/Operations/Finance/Media/Training/Documents). Different in web context — Ryujin nav already covers this.
- **Toolbox** — user-added bookmark library by category
- **File Vault** — file browser (Ryujin has `/api/files` already)

### Already in Ryujin (skip or replace)
- ~~Estimator OS iframe~~ → `/admin.html` quote engine
- ~~Ticket Board iframe~~ → `/admin-job-log.html` + `/api/tickets`

### Aesthetic
- 4 skin themes: alien / board-game / dbz / fallout (`hq-assets/skins/`)
- Card pack assets (`hq-assets/cards/{alien,board-game,dbz,fallout}`)
- Particles effect

---

## 2. What Ryujin already has that overlaps

| File | Lines | Role |
|------|-------|------|
| `public/admin.html` | 4640 | Quote engine + admin shell — biggest page |
| `public/admin-overview.html` | 468 | Dashboard-styled overview (already Ryujin-themed cyan/blue) |
| `public/admin-job-log.html` | ? | Ticket board surface |
| `public/admin-pricing.html` | ? | Pricing config |
| `public/admin-team.html` | ? | Team mgmt |
| `public/admin-tenant.html` | ? | Tenant config |
| `public/admin-integrations.html` | ? | Integrations (likely where Gmail/Calendar OAuth lives) |
| `public/command-center.html` | 2129 | Heavy dashboard (laggy on laptop per memory) |
| `public/dashboard-v2.html` | 873 | Lighter dashboard |
| `public/arcade.html` | 506 | Possibly the gamification surface |
| `public/classic.html` | 495 | Mac's preferred laptop driver |
| `api/action-board.js` | — | API for the Plus Ultra action board |
| `api/tickets.js`, `api/files.js`, `api/quote.js` | — | All the data plumbing |

So: there's already a dashboard family (overview, command-center, dashboard-v2, classic) and an arcade page. The HQ migration is mostly **adding the missing keep-on-track features** to existing surfaces, not building a parallel dashboard.

---

## 3. Three migration paths

### Path A — Drop hq.html in as-is
Copy `public/hq.html` to ryujin-os, swap a few URLs, ship.

- **Time:** 1-2 hours
- **Pros:** Get all features back tonight. Familiar UX immediately.
- **Cons:** Not multi-tenant. Doesn't read Ryujin's real data (quests/KPIs/agents would be local-storage or stuck on plus-ultra-hq's Supabase). Doesn't fit Ryujin's CSS system. Two competing dashboards.
- **Verdict:** Tempting but creates tech debt.

### Path B — Native rebuild, cherry-pick into existing admin surface
Each HQ feature becomes a Ryujin-native page or extension of an existing one.

- **Time:** 2-3 weeks of focused work
- **Pros:** Multi-tenant. Reads real data (quests can reference real estimates/tickets/jobs). Consistent CSS. Single dashboard story.
- **Cons:** Mac doesn't get the keep-on-track features back for weeks.
- **Verdict:** Right destination, wrong timing.

### Path C — Hybrid (RECOMMENDED)
Two-phase:

**Phase 1 (this weekend, ~4-6 hours):** Copy `hq.html` → `public/hq.html` in ryujin-os. Wire it to two new Ryujin API endpoints (`/api/quests` + `/api/kpis`) backed by Supabase. Strip Estimator OS / Ticket Board iframes (link to existing Ryujin pages instead). Skip Gmail/Calendar widgets in v1 (they need OAuth, defer). Keep Z Fighters as-is (text reports, not yet live data). Skin system optional.

**Phase 2 (next 2-3 weeks):** Pull each module into Ryujin-native:
- Morning Briefing → top of `admin-overview.html`
- Quest Board → new `admin-quests.html`
- KPI Scouter → extend `admin-overview.html`
- Z Fighters → new `admin-agents.html`, wired to real data per agent (Krillin reads from estimates/invoices, Yamcha from `marketing-leads.html` data, etc.)
- Achievements + XP → extend `arcade.html`
- Once each is native, deprecate `hq.html`.

- **Time:** 4-6h Phase 1, 2-3 weeks Phase 2
- **Pros:** Get it back fast AND end up in the right place. Each Phase 2 ticket is independent and shippable on its own.
- **Cons:** `hq.html` lives parallel to the admin pages for a few weeks.

---

## 4. Recommended Phase 1 scope

Concrete deliverables for the first session (when ready):

1. **Copy** `Shenron/plus-ultra-hq/public/hq.html` → `ryujin-os/public/hq.html`. Replace `<title>` and asset paths.
2. **New table** `quests` (id, tenant_id, category, title, type [daily/campaign/optional], xp_reward, status, completed_at, created_at). New migration_019.
3. **New table** `kpis` (id, tenant_id, key, label, value, unit, target, sort_order). Migration_019.
4. **New table** `xp_ledger` (id, tenant_id, user_id, source_type, source_id, xp, created_at). Migration_019.
5. **New API** `/api/quests` (GET/POST/PUT/DELETE) — replaces hq.html's local-storage persistence.
6. **New API** `/api/kpis` (GET/PUT).
7. **New API** `/api/state` (GET) — aggregates totals for the Power Level / Daily / Weekly counters.
8. **Strip iframes** — Estimator OS replaced with `<a href="/admin.html">Open Quote Engine</a>`. Ticket Board replaced with link to `/admin-job-log.html`.
9. **Defer to Phase 2:** Gmail/Calendar widgets (need OAuth), Z Fighters live data feeds (text reports stay static for now), skin system.
10. **Add nav entry** in `admin.html` sidebar: "🐉 HQ" → `/hq.html`.

Estimated Phase 1: 4-6 hours focused work, mostly API plumbing + the migration.

---

## 5. Open decisions for Mac

- **Skin system** — port all 4 themes or just DBZ? (Themes are fun but ~2611 lines of HQ assumes one is active.)
- **Z Fighter agents** — keep DBZ naming or rename to Ryujin-themed (dragon/storm/ocean motif from CLAUDE.md)? Names are in dozens of UI strings.
- **XP semantics** — XP for quest completion only, or also for shipping real jobs? Could pull from `workorders.status='complete'` for big XP rewards.
- **Achievement definitions** — port the existing list as-is or rewrite for the Ryujin context?
- **Multi-tenant** — quests/KPIs are per-tenant from day 1, or single-user (Mac only) for v1? Multi-tenant means white-label customers get their own gamification later.
