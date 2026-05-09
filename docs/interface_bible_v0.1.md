# Ryujin OS Interface Bible v0.1

**Prepared for:** Mack / Plus Ultra Roofing
**Prepared by:** Manus AI
**Date:** May 9, 2026
**Status:** Draft doctrine for audit, design rationalization, and implementation sequencing
**Core rule:** This document does not invent Ryujin from zero. It audits and rationalizes the existing system: Advanced ~70% built but sprawled, Interactive ~25%, Agent ~30%.

---

## 1. Executive Doctrine

Ryujin OS is a three-interface roofing operating system, not a dashboard or proposal generator. Functional mass already exists across admin, pricing engine, paysheets, sub portal, GHL sync, proposal generation, customer-facing proposals, chat, snapshots, and archetype persistence. The job is unify, govern, harden — not restart.

**Doctrine:** Ryujin has one operating truth, three control surfaces, twelve archetypal lenses. Same data, state machine, pricing logic, and claims library powers Agent / Interactive / Advanced.

**Visual tone:** premium construction × cyber-industrial, dragon / Japanese-storm motif. Material texture, contrast, motion, lighting, dark premium surfaces, sharp spacing, tactical labels, restrained mythic detail. NOT cartoon fantasy, gaming clutter, or generic SaaS minimalism.

| Interface | Maturity | Purpose | Doctrine |
|---|---|---|---|
| Agent | ~30% | Conversational operating assistant — explain status, recall context, trigger safe actions, eventually run workflows proactively. | Keep shipped archetype system. Make agent proactive, state-aware, permission-bound. |
| Interactive | ~25% | Guided visual workflow for configuring roof options, packages, scope, customer-facing outputs. | Build around 2D annotated EagleView-driven plan, not true 3D. Staged, visual, operator-safe. |
| Advanced | ~70% | Full manual control: pricing, proposals, paysheets, tenant settings, production, subs, admin. | Don't rebuild. Collapse sprawl into structured mobile-first panels + state-machine governance. |

Primary users: Mac, Cat, Darcy, Ryan. Internal-first; franchise-readiness designed-in but not launched until compliance + tests close.

---

## 2. Existing Surface Audit

Codebase already contains the bones. Problem is distribution + coherence, not absence.

| Surface | Existing role | Classification | Decision |
|---|---|---|---|
| `public/admin.html` | Command center, quote builder, funnel, products, customers, crew, settings, chat, persona, TTS, GHL sync | Agent + Interactive + Advanced | Keep as main cockpit; split into mode-aware panels; remove mixed-density collisions |
| `public/admin-pricing.html` | Pricing engine controls | Advanced | Keep. Collapsible mobile-first sections + audit trails |
| `public/sales-proposal.html` | Operator-side proposal generator | Advanced + Interactive | Keep as operator-side proposal builder until full configurator matures |
| `public/proposal-client.html` | Customer-facing proposal | Interactive output | Keep. Harden trust claims, mobile, lock-in state, deposit/scheduling consequences |
| `public/paysheet.html` | Public sub paysheet | Advanced output | Keep. Add scope/rate freeze, post-edit pending re-accept, fresh token, CO chain |
| `public/production-paysheet.html` | Internal paysheet editor | Advanced | Keep. Add versioning, state labels, re-acceptance visibility |
| `public/sub-portal.html` | Crew portal | Advanced field portal | Keep. Clearer role permissions + change-order tie-in |
| `public/command-center.html` | Cockpit shell | Agent | Keep as high-tech shell candidate; simplify into one coherent agent cockpit |
| `public/dashboard-v2.html` | Snapshot dashboard | Agent | Fold into Agent Interface as state snapshot feed |
| `public/app.html` | Field workflows | Support | Keep as field execution layer |
| `public/admin-tenant.html` | Tenant branding/settings | Advanced | Keep. Important for franchise-readiness. Claims library + visual-tone governance |
| `public/admin-integrations.html` | Integrations | Advanced | Keep. Owner/admin-only. Explicit write actions |
| `sales-customers / sales-pipeline / sales-followups` | Sales operations | Support | Keep. Feed Agent + proposal builder, don't compete |
| `production-workorders / production-materials / production-calendar` | Production operations | Support | Keep. State-machine align with proposals/paysheets/COs |

**Key issue:** `admin.html` carries too much conceptual load. Needs mode doctrine so user always knows whether they're asking Ryujin to act, configuring visually, or manually editing truth.

---

## 3. The Three Interfaces

### 3.1 Agent Interface (default archetype: **Athena**)

High-tech operating head. Already exists: chat FAB, snapshot read, recall_conversation, persona/archetype persistence, `/api/chat`, `/api/persona`, `/api/tts`, localStorage keys (`ryujin_archetype`, `ryujin_persona`, `ryujin_auto_speak`, `ryujin_last_mode`). Weakness: reactive not proactive.

Must answer four operator questions: what's happening, what's risky, what should I do next, can you prepare it for me. Must not silently mutate contract/payment/acceptance/claims state without permission.

| Capability | Required next behavior |
|---|---|
| Snapshot read | Summarize live jobs, proposals, paysheets, COs, deposits, overdue actions, blocked states |
| Recall | Recall prior customer/sub decisions; expose confidence ("I found this in memory" vs "I need confirmation") |
| Commands | Add operational slash: `/athena audit proposal`, `/hephaestus prep workorder`, `/hermes objection plan` |
| Proactivity | Daily briefing, job risk alerts, stale proposal alerts, pending re-accept alerts, claim violation warnings, deposit/scheduling blockers |
| Action execution | Separate draft / preview / request-approval / commit states. Agent prepares freely; commits sensitive actions only with confirmation. |

**Surface rule:** Three regions — head/presence, briefing stream, action tray. Head creates identity, stream explains reality, tray holds concrete actions with permission status.

### 3.2 Interactive Interface (default archetype: **Apollo**)

Guided visual configurator. NOT true 3D. 2D annotated EagleView plan + staged config: roof system → measurements → difficulty → scope → package → upgrades → media → pricing → proposal output → customer preview.

| Stage | Operator action | System response | Rule |
|---|---|---|---|
| 1. Customer + property | Select/create customer, load address, pull GHL/EagleView | Show identity, missing data, confidence | Visual polish never hides missing source data |
| 2. Roof plan | Load 2D plan, annotate planes, pitches, edges, penetrations | Visual map with clickable regions + scope tags | 2D precision, not fake 3D spectacle |
| 3. Scope | Select shingles/metal, decking, ventilation, flashing, repairs, adders | Convert selections → hard-cost inputs | Scope must always feed pricing engine |
| 4. Package | Compare Gold / Platinum / Diamond | Warranty, material, margin, value differences | Package selection defendable from cost upward |
| 5. Trust/media | Team, photos, reviews, CompanyCam, certs, workmanship | Build proposal trust stack | Claims come from locked claims library only |
| 6. Proposal preview | Review as customer sees it | Flag missing deposit/finance/contract/compliance | Preview shows consequences of "Lock In" |
| 7. Send/approve | Generate link/contract/PDF/event tracking | Move proposal to correct state | Sensitive transitions require confirmation + event logging |

Archetype overrides: Athena for analysis-heavy pricing review, Hermes for close-oriented objections, Persephone for first-touch simplicity.

### 3.3 Advanced Interface (default archetypes: **Hephaestus** for production, **Zeus** for owner-level governance)

Manual control room. Most built; sprawled across admin/pricing/production/sub/tenant/integration/proposal/paysheet. Mobile-first, dense, collapsible.

| Area | Maturity | Required rationalization |
|---|---|---|
| Pricing engine | High | Audit trails, effective dates, margin warnings, multiplier clarity |
| Proposal generator | Medium-high | Tie lock-in/contract/deposit/financing/scheduling/claims into one state flow |
| Paysheets | Medium-high | Scope/rate freeze, owner-edit reacceptance, fresh token, CO chain, mark-completed payment trigger |
| Sub portal | Medium | Connect rate-change suggestions to CO or rate-review workflow |
| Tenant settings | Medium | Claims governance, franchise defaults, visual tone presets |
| GHL sync / sales | Medium | Make sync status visible in cockpit; prevent silent drift |
| Production / work orders | Medium | Connect WO scope, materials, closeout, warranty, customer documentation |

Archetype shifts by module: pricing → Zeus/Athena; work orders/paysheets → Hephaestus; customer admin → Hestia; sales pipeline → Hermes.

---

## 4. Canonical Archetype Doctrine

Already shipped. Absorb, do not redesign.

> "Roles define authority… Archetypes define voice + lens… The archetype is a LENS, not a license." — `ARCHETYPES.md`

**Hard rule:** Archetype shapes explanation, prioritization, tone, default framing. Cannot authorize off-book pricing, contract changes, claim publication, payment, acceptance, outbound messages, or tenant-level changes.

| Context | Default | Override examples |
|---|---|---|
| Agent cockpit | Athena | Zeus (owner decisions), Hestia (admin hygiene), Hermes (closing), Hecate (debugging) |
| Interactive configurator | Apollo | Athena (pricing review), Persephone (onboarding), Hermes (objections) |
| Advanced pricing/governance | Zeus + Athena | Hecate (technical), Hephaestus (production feasibility) |
| Advanced production/WOs | Hephaestus | Hestia (handoff), Zeus (allocation) |
| Sales pipeline/follow-up | Hermes | Aphrodite (retention), Artemis (prospecting) |
| Customer onboarding | Persephone | Hercules (relatable plain talk) |
| Brand/content/ad creative | Apollo + Artemis | Prometheus (disruption) |
| Debugging/infrastructure | Hecate | Athena (analysis), Zeus (policy) |

**UI surface rule:** Small badge, tonal accent, short lens label, optional avatar/still. No lore floods. Operator lenses, not decorative skins.

---

## 5. State Machine and Workflow Governance

Five gating decisions create the control layer. Implement BEFORE heavy UI beautification — beautiful screens that allow sloppy transitions are worse than ugly reliable ones.

### 5.1 Sub paysheet state model

Acceptance freezes scope + rate. Owner edit after accept → `pending_re_accept` + fresh token. COs run through `change_orders` table. Payment fires on owner mark-completed; expected 2-3 days, not Net 30.

| State | Meaning | Actor | UI |
|---|---|---|---|
| `draft` | Owner preparing | Owner/admin | Editable, not visible to sub |
| `sent` | Tokenized link to sub | System/owner | Show sent timestamp + token status |
| `accepted` | Sub accepted current scope/rate | Sub | Freeze. Show accepted timestamp + version |
| `pending_re_accept` | Owner edited; fresh token required | System/sub | Sub sees "terms changed, review again" |
| `declined` | Sub declined | Sub | Capture reason; return to owner queue |
| `completed_owner_marked` | Owner marked job complete | Owner/admin | Start payment workflow |
| `payable` | Payment ready/scheduled | System/owner | Show 2-3 day expectation |
| `paid` | Payment complete | Owner/system | Lock payment record + history |

(Note: `owner_edited_after_accept` listed in original Bible v0.1 collapsed to a transition, not a persisted state.)

### 5.2 Customer proposal state model

Approve → 24h rep call → contract → 33% Stripe deposit (unless FinanceIt-financed) → schedule within 3 business days. Rate held 30 days. COs mirror sub model.

| State | Customer-facing | Internal | UI |
|---|---|---|---|
| `proposal_draft` | Not visible/final | Editable | Label as draft everywhere |
| `proposal_sent` | Customer can review | Event tracking active | Show rate-hold terms only if final |
| `approved_pending_rep_call` | Customer locked in | Rep call due 24h | CTA copy explains what happens next |
| `contract_pending` | Contract issue/sign | Admin/sales action | Agent flags if overdue |
| `deposit_pending` | Stripe 33% unless financed | Payment action | FinanceIt path bypasses deposit |
| `financing_pending` | FinanceIt selected | Verification required | No down payment if financed |
| `schedule_pending` | Payment/financing met | Schedule within 3 biz days | Show SLA |
| `scheduled` | On calendar | Production handoff | Generate WO + sub/material tasks |
| `change_order_pending` | New scope/cost awaits approval | CO chain active | Freeze original; show delta |
| `closed_won` | Commercially secured | Production + closeout | Move to production board |

### 5.3 Change-order doctrine

Central, not bolted onto proposals/paysheets separately. Shared ledger.

| Field | Purpose |
|---|---|
| `id` | Stable CO identifier |
| `tenant_id` | Franchise/tenant isolation |
| `job_id / proposal_id / paysheet_id` | Links to all affected artifacts |
| `requested_by` | Owner / customer / sub / admin / production |
| `source_surface` | Agent / interactive / advanced / sub portal / proposal page |
| `scope_before / scope_after` | Human-readable scope delta |
| `price_delta_customer` | Customer-facing change |
| `rate_delta_sub` | Sub-facing change |
| `margin_impact` | Margin protection |
| `status` | Draft / pending customer / pending sub / approved / rejected / superseded |
| `token_id` | Fresh acceptance token when required |
| `created_at / approved_at / rejected_at` | Audit trail |

---

## 6. Visual and Component Standards

Premium, forceful, operational. Plus Ultra has a command-grade machine behind the roofing process. But usable on phones/tablets — operators work in trucks, on job sites, between calls.

### 6.1 Visual tone

| Element | Standard |
|---|---|
| Color | Dark charcoal, storm black, steel gray, electric blue, controlled gold/amber, warning red sparingly |
| Texture | Subtle industrial gradients, glass/steel panels, storm-light accents. Not noisy fantasy backgrounds |
| Motif | Dragon/Japanese storm = restrained identity (header marks, motion sweeps, loading states, archetype stills). Not constant decoration |
| Typography | Strong condensed headings for command labels; readable sans-serif body; numeric data aligns cleanly |
| Motion | Tactical transitions, panel reveals, status pulses. No slow theatrical animations in production workflows |
| Data density | High inside structured panels only. No unbounded sprawl |
| Trust surfaces | Customer/sub pages calmer + more human than internal cockpit |

### 6.2 Mobile-first panels

| Component | Rule |
|---|---|
| Page header | Job/customer/sub identity + current state |
| State badge | draft / sent / accepted / pending re-accept / approved / deposit pending / scheduled / etc |
| Critical warning | Claim violations, missing contract, expired rate hold, stale token, margin risk |
| Collapsible section | One concept per panel: pricing, scope, materials, labour, documents, payments, notes |
| Sticky action bar | Max 2 primary actions + overflow. No clutter |
| Audit drawer | Timeline of material changes + actor |
| Confirmation modal | Required for state-changing actions. Plain-language consequence |
| Empty state | What's missing + how to fix |

### 6.3 Non-overlap QA checklist

| Check | Requirement |
|---|---|
| 375px | No horizontal scroll, no clipped CTA, no overlapping fixed elements |
| 768px | Panels stack logically; sticky actions don't cover form fields |
| 1280px | Constrained content width; no stretched lines or dead zones |
| Form labels | Stay attached to fields at all breakpoints |
| Modal | Fits viewport or scrolls internally with visible confirm/cancel |
| Sticky nav/action | Doesn't hide critical content or final form fields |
| Long names | Customer, address, package, sub names wrap cleanly |
| Error states | Validation doesn't push CTAs off-screen |
| Touch targets | Large enough for field use |
| Print/PDF preview | Customer-facing outputs clean + non-cyber unless intentionally branded |

---

## 7. Build Priorities and No-Rewrite Guardrails

Audit-led consolidation, not redesign. Refactor existing surfaces into doctrine; don't replace working logic.

### 7.1 No-rewrite guardrails

- Preserve pricing logic — don't rebuild engine unless specific bug requires it
- Preserve canonical archetypes (`ARCHETYPES.md`)
- Preserve working proposal/paysheet endpoints — harden state/tokens/consequences around them
- Preserve GHL sync — make status visible + safer
- Preserve customer/sub public URLs — improve trust/state/mobile without changing commercial mental model
- Refactor UI around panels — replace sprawl with mobile-first collapsible
- State before polish — correctness beats refinement
- Claims library mandatory — public-facing trust claims from approved locked claims only

### 7.2 Implementation sequence

| # | Workstream | Why now | Definition of done |
|---|---|---|---|
| 1 | State Machine Spec | All three interfaces need one operational truth | Proposal, paysheet, CO, deposit, financing, schedule, completion, payment states documented + mapped to APIs |
| 2 | Claims Library + Proposal Claim Guard | GL/WCB retraction proves governance is launch blocker | Proposal renders only approved claims; unapproved blocked or flagged |
| 3 | Paysheet Freeze/Reaccept Flow | Sub trust depends on scope/rate stability | Accept freezes; owner edit triggers `pending_re_accept`; fresh token issued |
| 4 | Customer Lock-In Flow | Main sales CTA needs operational consequence | Approve → rep call due → contract → Stripe/FinanceIt → schedule SLA visible + tracked |
| 5 | Advanced Interface Panel Refactor | Existing surface valuable but sprawling | Pricing/paysheets/proposals/tenant/production follow shared collapsible mobile-first pattern |
| 6 | Agent Proactive Briefing | Agent must become useful beyond reactive chat | Daily cockpit shows blocked proposals, pending deposits, reaccepts, claim risks, schedule tasks, overdue calls |
| 7 | Interactive Operator Configurator | Customer-side exists; operator-side needs staged flow | Operator builds proposal from EagleView/plan input through packages and preview without manual fields for ordinary jobs |
| 8 | Test Cycle Instrumentation | May–June phase must be measured | Participant logs capture 5 customers + 3 subs with gate metrics |

### 7.3 Interface-specific acceptance criteria (sellable internal beta)

- **Agent:** brief Mac/Cat/Darcy/Ryan on live state, identify blockers, recall context, prepare actions, ask confirmation before sensitive commits
- **Interactive:** guide operator from EagleView/plan input to scoped packages and proposal preview without manual advanced fields for ordinary jobs
- **Advanced:** fully control pricing/proposals/paysheets/tenant/production/COs through mobile-first panels with clear state + audit trail

### 7.4 Launch doctrine

| Phase | Target | Gate |
|---|---|---|
| Phase A: Internal hardening | May–June | P0/P1 fixed, claims locked, state machine implemented, test cycle running |
| Phase B: Friendly tenant | July | ≥4/5 customers self-serve to deposit, ≥2/3 subs accept in <15 min, zero retracted claims |
| Phase C: Public product | Q4+ | Compliance restored, onboarding repeatable, analytics visible, support/training docs complete |

---

## 8. Final Direction

Finish line visible, route needs discipline. Ryujin = partially-built operating system with enough working pieces to justify consolidation. Risk is not lack of vision — risk is building more screens before existing ones are governed by one interface doctrine + one state machine.

**Operating command:**
> Absorb what exists. Lock the rules. Collapse the sprawl. Make the agent proactive. Make the configurator staged. Make advanced mobile-first. Do not let aesthetics outrun operational truth.

---

## Internal source notes

- `ARCHETYPES_CANONICAL.md` (=`ARCHETYPES.md`) — canonical archetype doctrine
- `interface_audit_extract.md` — existing surface inventory
- `visual_tokens_extract.txt` — existing visual + component clues
- `api/paysheet-accept.js` — current sub acceptance impl
- `api/proposal-accept.js` — current customer acceptance impl
- Mac's May 9 decisions — three-interface doctrine, maturity levels, locked visual tone, primary users, 2D EagleView roof, mobile-first advanced density, internal-first launch, five gating decisions
