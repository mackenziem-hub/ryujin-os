# Proposal v2 Renderer — Rollout / Gating Contract

Status: OFF by default. This document describes the cutover contract so the human
flips the flag deliberately. Routing in `api/proposal.js` is intentionally NOT
modified yet — only the clean-path rewrite and this contract exist so far.

## The flag

The v2 surface (`proposal-v2.html`) is gated by:

1. `tenant_settings.proposal_v2_enabled` (boolean, per tenant). Defaults to
   `false` / absent. When `true`, newly created proposals for that tenant render v2.
2. `?v2=1` on the URL. A per-request override that forces v2 regardless of the
   tenant flag — used for previews and QA before flipping the tenant flag.

Render v2 only when EITHER is satisfied:

```
renderV2 = tenant_settings.proposal_v2_enabled === true || urlHasParam("v2", "1")
```

When neither holds, render the legacy surface.

## What stays on legacy

- Every existing share / slug continues to route to the legacy
  `proposal-client.html` / `custom-proposal.html` until the flag is flipped.
- Legacy shares NEVER move. A slug that was minted against legacy keeps resolving
  to legacy even after `proposal_v2_enabled` is turned on for the tenant. The flag
  governs only NEW proposals; it must not retroactively repoint already-shared
  links. (Customer-facing share links are frozen — see the "no changes to sent
  proposals" doctrine.)

## Routing today

- Clean path: `/p/:slug` -> `/proposal-v2.html?instance=:slug`
  (added to `vercel.json` rewrites; sits ahead of the `/(.*)` catch-all and after
  the existing `/proposals/custom/:slug` -> `/custom-proposal.html?slug=:slug` rule).
- Legacy paths are untouched.
- `api/proposal.js` routing is unchanged in this task. The human owns the cutover:
  when ready, wire `api/proposal.js` to read `tenant_settings.proposal_v2_enabled`
  and the `?v2=1` override, and to mint v2 share URLs (`/p/:slug`) only for NEW
  proposals while leaving legacy slug resolution intact.

## Cutover checklist (for the human, later)

1. Confirm `proposal-v2.html` renders correctly via `?v2=1` against a real instance.
2. Add/confirm a `proposal_v2_enabled` boolean in `tenant_settings` (default false).
3. Wire `api/proposal.js`: NEW proposals choose v2 when the flag is true; existing
   slugs keep their original renderer; honor `?v2=1` as a per-request override.
4. Flip `proposal_v2_enabled = true` for the pilot tenant only.
5. Verify legacy shares still resolve to legacy (they must not move).
