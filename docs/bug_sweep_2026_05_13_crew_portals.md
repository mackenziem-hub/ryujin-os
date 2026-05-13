# Bug sweep — crew portals (commits `a500829^..HEAD`)

**Date:** 2026-05-13
**Reviewer:** Claude (in-context, project-memory-driven checklist — not /ultrareview cloud)
**Scope:** The recent crew-portal push — portal-mobile.html rebuild + Crew OS v1 + magic auth.
**Files in scope:**
- `public/portal-mobile.html` (4 commits — IA rebuild, interactive default, tickets switch, real-tab routing)
- `public/magic.html` (new — magic-link landing)
- `public/messages.html` (touched)
- `public/assets/portal-tabbar.js` (shared infra)
- `public/assets/ryujin-chat.js` (chat overlay — skimmed)
- `api/auth.js` (added magic-create + magic-consume)
- `api/sub-portal.js` (added crew sub-tokens)
- `schema/migration_061_user_magic_link.sql` (new)

**Out-of-scope but touched in window:** estimates.js, proposal.js, quote.js, dashboards, admin pages — covered by prior bug sweep on 2026-04-24, not re-reviewed here.

---

## Method

Reviewed against the project-memory checklist:
- `[[feedback_state_vs_tickets_source]]` — portal-mobile pulls /api/tickets not /api/state
- `[[feedback_mobile_visibility_principle]]` — first-frame content on landing
- `[[feedback_no_direct_to_mac_buttons]]` — topic-routing not "Text Mac" buttons
- `[[feedback_agent_slug_check_constraint]]` — new slugs in CHECK
- `[[feedback_snapshot_preservekeys]]` — new sections.* keys in preserveKeys
- `[[feedback_node_check_api_handlers]]` — all touched API handlers parse
- `[[feedback_prefer_customizable_config]]` — tunable values in tenant_settings, not hardcoded
- `[[feedback_close_the_loops]]` — persistence/migration gaps before shipping
- `[[reference_crew_app_schema]]` — RLS, tags-as-role, /api/files wrapped errors

Plus standard sweeps: authz, token handling, XSS, race conditions, error boundaries.

---

## What's good (sanity checks pass)

- ✅ All 8 touched API handlers pass `node --check`
- ✅ `/api/me` exists and field shape matches what portal-mobile reads (`user_id`, `name`, `is_admin`)
- ✅ portal-mobile.html confirmed switched to `/api/tickets` (line 650) — memory satisfied
- ✅ Migration 061 is a clean additive column add, no constraint conflicts
- ✅ No new agent_slugs added in this window — CHECK constraint (migration 057) still covers cron-daily's iteration set
- ✅ No new `sections.*` keys written — existing `preserveKeys` list is intact
- ✅ Self-elevation primitive in `/api/auth?action=register` correctly blocked (role_slug ignored, must come from invite)
- ✅ `getScope` DOCUMENTS_JSON shim correctly whitelists `public.blob.vercel-storage.com` and `ryujin-os.vercel.app`
- ✅ `approve_wo` correctly enforces `wo.subcontractor_id === sub.id`
- ✅ Crew members blocked from `approve_wo` (parent-sub-only) — good privilege separation
- ✅ `maskCustomer` strips parentheticals + reduces to first-name + last-initial
- ✅ Sub-facing materials response hides COGS, source_detail, and Kent-supplier text
- ✅ Sub portal routing via topic chips (AJ default, Mac only for pay) — `[[feedback_no_direct_to_mac_buttons]]` satisfied

---

## Findings

### 🔴 CRITICAL

**C1. `sub-portal.js` read endpoints leak across subs**
`api/sub-portal.js:82–355` — `getPhotos`, `getMaterials`, `getSchedule`, `getScope`, `updateChecklistStep` all accept a `woId` and look up the workorder by `(tenant_id, id)` only. They **never** check `wo.subcontractor_id === sub.id`. A sub with a valid magic link can read photos, materials, schedule, and scope for *any* work order in the tenant by guessing/iterating wo_ids, and can mark checklist steps complete on someone else's WO.

**Current blast radius:** Plus Ultra has one crew sub (Ryan/Atlantic). No other sub to leak to today.
**Real blast radius:** The moment a second crew sub is invited (e.g. an additional gutter or solar sub), the new sub gets read access to Ryan's full job pipeline.

**Fix:** In every read handler, after `verifyToken` returns `sub`, add to the workorder query:
```js
.eq('subcontractor_id', sub.id)
```
The 404 path stays the same — sub never learns the WO exists.

---

### 🟠 HIGH

**H1. Magic token survives in URL → browser history + Referer**
`public/magic.html:79` reads `?t=...` from query string. `api/sub-portal.js:618` accepts the persistent sub token in `?token=...`. Browsers log query strings in history, and any cross-origin navigation from these pages leaks the token via the Referer header.
**Sub-portal token is the one that matters** — it doesn't expire in 30 days the way user magic tokens do. It's the only auth factor for the sub portal and persists until rotated.
**Fix (magic.html):** Switch to fragment (`#t=...`) — JS still reads it but it never hits the server log or referer. Replace `location.search` parse with `location.hash` parse.
**Fix (sub-portal.js):** Accept `Authorization: Bearer <token>` header *as well as* `?token=`, migrate sub-portal.html to send the header, then remove the query-param fallback in a later pass.

**H2. `magic-consume` is server-side single-use but client doesn't gate on localStorage availability**
`public/magic.html:92–110` POSTs `magic-consume`, which clears the token server-side, **then** writes to localStorage, **then** redirects. If localStorage is unavailable (iOS private mode, restrictive WebView), the user sees "You're in" → redirect → portal-mobile finds no token → kicks them to /login.html. They've burned their single-use link with nothing to show for it.
**Fix:** Detect localStorage write capability with a probe write *before* calling magic-consume. If unavailable, show "Open in your default browser — private mode prevents sign-in" and don't consume.

**H3. `sub-portal.js` recipient match uses substring `ilike`**
`api/sub-portal.js:495` builds `name.ilike.%aj%` etc. If a future crew member's name contains `aj` as a substring (`Pajaman`, `Tanaja`), they receive sub-portal questions intended for AJ. Same for "ryan" matches in `getRatesForSub`.
**Fix:** Match by exact role/slug, not name substring. Add a `routing_handles` jsonb column to `users` (e.g. `["aj","supervisor"]`) and match `.contains('routing_handles', [handle])`. Or, simpler short-term, require an exact `name.ilike` match (`AJ Smith`) without leading/trailing `%`.

**H4. Hardcoded SMS contactId in `approve_wo`**
`api/sub-portal.js:663` — `'02IhxZfSwZZAZ2fooVGu'` is Mac's LeadConnector contact ID baked into source. Violates `[[feedback_prefer_customizable_config]]`. Won't work for tenant #2.
**Fix:** Move to `tenant_settings.automator_owner_contact_id` (jsonb). Skip the SMS if unset.

**H5. `auth.js` admin role check uses legacy `role` text column**
`api/auth.js:301–305` (`magic-create`) reads `caller.role` and checks against `['owner','admin']`. The newer `role_id → roles.slug` path used elsewhere in the same file isn't consulted. If a user's legacy `role` text drifted out of sync with `role_id`, the wrong gate fires.
**Fix:** Resolve via `role_id → roles.slug` (same pattern as login response at lines 67–69). Or, treat `role` as authoritative everywhere and remove `role_id` complexity — but pick one.

**H6. Sessions table grows forever**
`api/auth.js:57–62, 354–356` — every login + magic-consume inserts a session row with a 30-day expiry. Nothing reaps expired rows. Long-term storage + index bloat.
**Fix:** Add a daily cron that `delete from sessions where expires_at < now() - interval '7 days'` (keep a grace window for audit).

**H7. Magic tokens logged to Vercel console at full strength**
`api/auth.js:244` (forgot reset URL) and `api/auth.js:328` (magic-create URL) both `console.log` the full landing URL. **Intentional** per the inline comment ("until Gmail email-send is wired"), but anyone with Vercel log access can claim accounts. Acceptable as a stop-gap, but track the Gmail-send TODO.
**Fix:** Wire `gmailSend` from `lib/google.js` (it's already imported in `sub-portal.js`). Then redact tokens from logs.

**H8. portal-mobile pillar-derivation has hardcoded user list**
`public/portal-mobile.html:600–608` — `byUser` map covers Mac, Mackenzie, Catherine, Melodie, AJ, Darcy, Diego, Pavanjot. Anyone else (Ryan, future hires) falls through to `pillar = 'hq'`, which is wrong for crew. Violates `[[feedback_prefer_customizable_config]]`.
**Fix:** Move the user→pillar mapping into `users.default_pillar` column or `tenant_settings.user_pillar_map`. Default for crew role → 'production'. Pull from `/api/me` (extend response to include `default_pillar`).

**H9. `getRatesForSub` matches sub identity by name/company regex**
`api/sub-portal.js:394–402` — uses `/atlantic/i.test(company) || /ryan/i.test(name)` to pick the Atlantic rate sheet. Brittle: any future "Ryan" sub gets Atlantic rates. Any sub with "atlantic" anywhere in their company name (e.g. "Atlantic Restoration", "Mid-Atlantic Roofing") gets the same sheet.
**Fix:** Add `subcontractors.rate_sheet_slug` column. Default null. Admin sets it explicitly. Lookup becomes `SUB_RATES[sub.rate_sheet_slug]` with no regex.

**H10. `portal-mobile.html` job-card customer fallback shows employer name**
`public/portal-mobile.html:697` — when `top.customer` is missing, falls back to `'Plus Ultra Roofing'`. For a crew member, "customer: Plus Ultra Roofing" means nothing — Plus Ultra is *their* company, not the customer. The address-less branch at line 700 falls back to `''` correctly.
**Fix:** Change line 697 to `top.customer || ''` for consistency, or `top.customer || 'Customer name pending'`.

---

### 🟡 MEDIUM

**M1. `magic.html` UA sniff for mobile redirect**
`public/magic.html:109` — `/iPhone|iPad|iPod|Android/i.test(navigator.userAgent)`. iPad Pro reports as Mac in iPadOS 13+. Crew with iPads land on admin.html instead of portal-mobile.
**Fix:** `'ontouchstart' in window && window.innerWidth < 900` is a better mobile-form-factor heuristic.

**M2. `portal-mobile.html` TENANT hardcoded**
`public/portal-mobile.html:613` — `const TENANT = 'plus-ultra'`. Acceptable for tenant #1 prod but Ryujin OS is multi-tenant by design. Future-proof from start.
**Fix:** Pull tenant slug from `localStorage.getItem('ryujin_tenant')` (already set by magic.html and login.html).

**M3. `portal-mobile.html` loadAlertsPanel runs unconditionally on init**
`public/portal-mobile.html:1156` — `await Promise.all([loadToday(), loadPay(), refreshBadge(), loadAlertsPanel()])`. Alerts panel loads on every page open even if user never taps Alerts tab. Wasted network + snapshot read for every cold start.
**Fix:** Lazy-load alerts via `PANEL_LOADERS.alerts = loadAlertsPanel` only — remove from init. Show a stale badge from cached snapshot count.

**M4. `portal-mobile.html` pay card useless for non-admin**
`public/portal-mobile.html:735–764` — `loadPay` shows team total for admin, `'—'` for crew users. A crew member sees a card titled "Your pay" with no number and "see pay page" subtitle.
**Fix:** Either build the per-user pay endpoint or hide the card for crew until it's built. A `—` doesn't earn its slot on the landing.

**M5. `sub-portal.js` sendQuestion → 0 recipients on missing teammate**
`api/sub-portal.js:511–514` — if Mac is unreachable (renamed, archived, or `name.ilike` regex misses), pay-topic returns 500 "No teammate available". Sub sees a fail with no fallback.
**Fix:** Always-fallback to owner role even if name match fails. Track which case fired in metadata for debugging.

**M6. `sub-portal.js` AUTOMATOR_HOOK_ID empty → broken POST URL**
`api/sub-portal.js:660` — `'https://services.leadconnectorhq.com/hooks/' + (process.env.AUTOMATOR_HOOK_ID || '')`. If env is empty, posts to `https://services.leadconnectorhq.com/hooks/` (404 endpoint).
**Fix:** Skip the SMS attempt entirely if `AUTOMATOR_HOOK_ID` is unset. Add an `else { console.log('SMS skipped: no AUTOMATOR_HOOK_ID') }`.

**M7. `messages.html` voice memo imports from esm.sh CDN at runtime**
`public/messages.html:494` — `await import('https://esm.sh/@vercel/blob/client@0.27')`. External CDN at runtime = stability risk. If esm.sh has an outage, voice memos break and Mac's debugging journey starts with "why doesn't voice work."
**Fix:** Bundle `@vercel/blob/client` into a local asset, or move voice-memo upload server-side.

**M8. `messages.html` still uses sci-fi cyan/purple theme**
`public/messages.html:11–14, 28–30, 45–46` — Orbitron font, cyan, purple, `--bg:#060a14`. Violates `[[feedback_jewels_visual_rules]]` (milky cream, no sci-fi). Admin-only surface so impact is small, but this is one of the few pages crew sees post-magic-link.
**Decision needed:** Keep dark sci-fi for admin tools intentionally, or bring it to the cream system used in portal-mobile?

**M9. `getScope` DOCUMENTS_JSON shim is brittle**
`api/sub-portal.js:311–326` — documents stored as `additional_scope` string with `"DOCUMENTS_JSON: ..."` prefix. Parser tolerates JSON errors silently. Fragile encoding.
**Fix:** Add `workorders.documents jsonb` column, migrate string-prefix data, drop the shim.

**M10. `magic-consume` doesn't transactionally check + clear**
`api/auth.js:340–361` — reads token, validates, then *separately* clears it. Two concurrent consumes of the same token can both pass the validation step before either writes the clear, both create sessions, only the second `update` lands. Race window is tiny but real.
**Fix:** Use an atomic `.update({ magic_token: null, ... }).eq('magic_token', token).eq('magic_expires_at.gt', now).select()` and only succeed if exactly one row updated.

---

### 🟢 LOW

**L1.** `priRank('active')` returns 1.5 (`portal-mobile.html:678`) — odd ranking value. Cosmetic.
**L2.** `messages.html` setInterval(loadList, 60s) re-renders breaks `.active` class momentarily. Cosmetic.
**L3.** `portal-mobile.html` `data-portal-auth="off"` on line 2 — page renders shell without auth. Cosmetic; all data loads fail gracefully.
**L4.** `magic-consume` returns 404 if token not found, 410 if expired → token-existence enumeration. Token space is 64 hex chars so brute force is infeasible. Cosmetic.
**L5.** `messages.html` `data.users || data.data || data || []` — triple-fallback parsing on `/api/users`. Pick one shape.
**L6.** `messages.html` `extractMentions` resolves @firstname by `Array.find` — first match wins. If two users share first names, the wrong one gets tagged.
**L7.** `portal-tabbar.js` renders on `<768px` — iPad portrait gets the mobile tabbar. Acceptable.

---

## Candidates for Path 2 (external multi-model review)

If you spin up `/ultrareview` against a PR (or run a subset through Codex), the highest-leverage subset is:

1. **`api/auth.js` magic-create / magic-consume flow** (lines 287–383) — auth code, second pair of eyes always worth it
2. **`api/sub-portal.js` token verify + read-endpoint authz** (lines 42–355) — C1 above
3. **`public/magic.html` end-to-end** (117 lines, small) — single-use token lifecycle has multiple race surfaces

The rest of the findings are project-context-dependent — an external reviewer without `[[feedback_no_direct_to_mac_buttons]]`, `[[reference_crew_app_schema]]`, etc. would either miss them or flag them noisily.

---

## Suggested prioritization

**Ship-this-week:**
- C1 (cross-sub leak) — `subcontractor_id` check in 4 functions, mechanical fix
- H1 (token in URL) — magic.html fragment migration is small
- H8 (hardcoded user→pillar map) — affects any new hire
- H10 (job card customer fallback) — one-line UX fix

**Before July ship:**
- All H findings + M5/M6/M9
- M2 (hardcoded TENANT) — required for Tenant #2 onboarding

**Backlog:**
- L findings, M3/M4/M7/M8/M10

---

## What this review did NOT cover

- `public/assets/ryujin-chat.js` (1723 lines) — skimmed, not line-by-line. Worth its own review session.
- `public/admin-*.html`, `public/dashboard-v2.html`, `public/proposal-*.html`, `public/simulator.html` — touched in window but not crew-portal scope.
- Server-side API handlers `api/agents/*.js`, `api/estimates.js`, `api/proposal.js`, `api/quote.js` — touched in window, not crew-portal scope. Covered by 2026-04-24 sweep.
- Live runtime smoke test — no curl against deployed endpoints per `[[feedback_post_deploy_curl_smoke_test]]`. Recommend follow-up smoke against `/api/auth?action=magic-consume` + `/api/sub-portal?action=schedule` after C1 fix lands.
