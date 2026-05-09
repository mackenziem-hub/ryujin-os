# Ryujin OS Interface Bible v0.2 — Implementation-Control Addendum

**Layered on top of v0.1 (`interface_bible_v0.1.md`).** Per Manus, this is not a rewrite — v0.1 doctrine stands. v0.2 adds enforcement standards now that the backend control layer is real.

**Date:** 2026-05-09 EOD
**Author:** Manus AI + Claude Code

---

## Premise shift

> The product is no longer waiting on philosophy. It is waiting on surface enforcement.

Priorities #1–4 are no longer planning items — they are **enforcement and integration items**. Priority #5+ remains design work.

---

## v0.2 enforcement sections

### 1. Claims Guard Enforcement Strategy
**Hard standard:** Phase A cannot pass until claim lint violations are 0 P0.
- Approved claim source = `claims` table, `status='active'`, surfaced via `lib/claims.js` only
- Template integration via `data-claim` attribute (client-side resolver, `public/assets/claim-resolver.js`) OR server-side render injecting `trustClaims` array
- Lint gate: `node scripts/lint-claims.mjs --fail-on-found` blocks build
- Public-page block behavior: when no claim resolves, element renders empty (graceful degradation, never falls back to template hardcode)

### 2. Stripe Deposit Integration Spec (NET-NEW)
**Hard standard:** Cash approval cannot reach `schedule_pending` without verified deposit success.
- Endpoint: `POST /api/deposit-checkout` creates Stripe Checkout Session, returns `checkout_url`
- Metadata on session: `estimate_id`, `tenant_id`, `deposit_amount` (must match estimates.deposit_amount)
- Webhook: `POST /api/stripe-webhook` handles `checkout.session.completed` → flip `deposit_status='cleared'` + `deposit_cleared_at` + transition state from `deposit_pending → schedule_pending` + set `schedule_due_by` (3 biz days)
- Failure handling: `checkout.session.expired` flips deposit_status='failed'; UI re-issues
- Replay safety: webhook idempotent on `payment_intent` ID (skip if `deposit_payment_intent` already set)

### 3. FinanceIt Verification Path (NET-NEW)
**Hard standard:** Finance path must show `financing_pending` until owner/admin verifies.
- No callback API from FinanceIt today; manual verification is the interim path
- Endpoint: `POST /api/finance-verify` (owner/admin auth) flips `finance_status='approved'` + `finance_approved_at` + transitions `financing_pending → schedule_pending`
- Admin UI: button on estimate detail page surfacing `financing_pending` estimates, requires typed-name confirmation (Tier 3)
- When FinanceIt API access is acquired, automate this transition; current manual path becomes fallback

### 4. Archetype Motion/Video Usage Rules
**Hard standard:** Internal cockpit can be expressive; customer/sub legal/payment surfaces stay restrained.
- **Allowed motion:** Agent cockpit identity panel (looping mp4 OK), archetype switch transitions, briefing badge animation
- **Banned motion:** customer-facing proposal page, paysheet accept page, any contract/deposit/financing flow
- **Defaults:** still images by default site-wide; mp4 plays only on explicit interaction (hover/tap badge in cockpit)
- Asset routing: `archetype-name.jpg` for stills, `archetype-name.mp4` for explicit play, `archetype-name-standby.mp4` for cockpit ambient (lower bitrate)

### 5. Confirmation Friction Tiers
**Hard standard:** Mapped per action type. No exceptions in customer-facing or money-moving paths.

| Tier | Action type | Standard | Examples |
|---|---|---|---|
| 0 | Read-only | No confirm | Summarize job, show blockers, read proposal state |
| 1 | Draft/prepare | Soft confirm or none | Draft proposal, prepare CO, draft follow-up text |
| 2 | Internal mutation | Clear confirm modal | Update estimate field, mark GHL retry, assign task |
| 3 | External/binding | Hard confirm with consequence copy | Send proposal, revoke token, mark completed, request deposit |
| 4 | Owner-only | Owner role + hard confirm | Override pricing policy, approve retracted claim, mark payout, change tenant trust claims |

### 6. Agent Briefing Severity Model
**Hard standard:** Agent must prioritize trust, money, schedule, and compliance before convenience.

| Tier | Block types | Examples |
|---|---|---|
| P0 | Trust/legal/compliance | Soft claim leakage, GHL drift on accepted estimate, missing GL/WCB on contract |
| P1 | Money flow blocked | Overdue rep call, deposit pending >24h, schedule SLA passed, financing stuck |
| P2 | Pending acceptance | Re-accept needed, CO awaiting customer/sub |
| P3 | Convenience/info | Rate hold expiring soon, GHL drift on draft work |

### 7. Advanced Panel Refactor Pattern
**Hard standard:** No advanced screen ships without 375px / 768px / 1280px viewport checks.

Standard panel layout for every refactored advanced surface:
1. Page header (job/customer/sub identity + current state badge)
2. Critical warning strip (claim violations, missing contract, expired rate hold, stale token, margin risk)
3. Collapsible sections (one concept per panel: pricing, scope, materials, labour, documents, payments, notes)
4. Sticky action bar (max 2 primary + overflow)
5. Audit drawer (timeline of material changes + actor)
6. Confirmation modal (required for state-changing actions, plain-language consequence)

### 8. Change Order Wiring Spec (NET-NEW endpoints)
**Hard standard:** COs cannot be side notes; they must alter customer/sub state through the ledger.
- `POST /api/change-orders` creates draft CO row
- `POST /api/change-orders/:id/issue` flips status to `pending_customer | pending_sub | pending_both` + generates accept tokens for required sides
- `POST /api/change-order-accept` (public, token-gated) handles customer or sub accept
- `POST /api/change-orders/:id/cancel` voids open CO
- UI entry points: estimate detail page (issue customer-side), paysheet detail page (issue sub-side), production scope dialog (full duplex)
- Margin impact display computed at issue time (locked, not live)

### 9. GHL Drift Visibility
**Hard standard:** Drift cannot remain hidden in backend fields.
- Drift states: `synced | pending | drifted | error` (already on estimates table per migration 038)
- Display location: estimate detail header chip + agent cockpit briefing block (severity P0 if estimate is committed, P3 if still in proposal phase)
- Retry action: button → `POST /api/ghl-resync?estimate_id=X` (Tier 2 confirm)
- Agent alert: drift on committed estimate fires SMS to Mac (P0)

### 10. Test Cycle Logging Standard
**Hard standard:** No Phase B until gates met with real participants.
- Format: `_brain/ryujin/test-cycle/{slug}.md` (already scaffolded — 8 stub files)
- Gates (per Bible v0.1 Q5):
  - ≥4/5 customers complete accept-to-deposit without calling Mac for clarification
  - ≥2/3 subs accept first paysheet in <15 min from link receipt
  - Zero compliance/legal claims that need retracted mid-cycle
- 24h follow-up questions: (1) what confused you, (2) where did you hesitate, (3) what made you call/text Mac instead of using the system
- Weekly roll-up at `_brain/ryujin/test-cycle/_weekly-roll-up.md` mirroring Manus audit triage format

---

## Manus 72-hour priority order

1. ✅ Claims integration: `proposal-client.html` patches → drive lint from 21 P0 to 0 (✅ down to 8 P0, all in proposal-client.html — Mac handling)
2. ✅ `/api/agent-briefing` with blocker query shape (✅ shipped May 9, queries P0/P1/P2/P3 from live state-machine fields)
3. ⏳ `sales-proposal` Advanced Panel Pattern refactor (next major work)
4. 🔴 Stripe Checkout Session + webhook (~3 day net-new)
5. 🔴 FinanceIt manual verification state + admin action (small, can ship same day as Stripe)
6. ⏳ Change-order endpoints minimally wired
7. ⏳ Log first live Ryan paysheet acceptance + first customer action

---

## Caution from Manus (locked into rules)

> **Do not start the visual advanced refactor before the claim template fix is complete.** A beautiful proposal page with retracted GL/WCB language is worse than an ugly safe one.

**Implication:** sales-proposal refactor is gated on `proposal-client.html` claim integration first. Mac's copy edits + claims-library swap unblock the next layer of work.
