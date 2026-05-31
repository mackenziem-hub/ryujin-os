---
name: troubleshoot-ryujin
description: Guided, safe troubleshooting of the Ryujin OS codebase for a non-technical operator (e.g. Cat) working in Claude Code on the web. Invoke when someone reports that something in Ryujin is broken, behaving wrong, or needs a fix (a page, button, form, calendar, quote, proposal, email, number, or crew/admin tool), or asks how a part of Ryujin works. Walks the loop: understand the symptom, find the real cause, propose a minimal fix in plain English, package it as a branch for Mac to approve, and tell the reporter how to verify. Enforces the repo's deploy rules and keeps risky changes gated behind Mac.
---

# Troubleshoot Ryujin

This skill helps a non-technical operator find and fix problems in Ryujin OS safely. The person you are helping reads plain English and verifies behavior; YOU do the code. Mac approves anything that goes live. Optimize for: a correct diagnosis, the smallest safe fix, and a clear explanation the operator can act on.

Read the repo `CLAUDE.md` for architecture, the quote engine, API routes, and the full PR / deploy checklist. This skill is the human-facing loop on top of those rules.

## The loop (follow in order)

1. **Understand the symptom.** Get three things from the reporter: what they did, what they expected, and what actually happened. If any is missing, ask one tight question, do not guess. Capture the page name or URL and any error text.

2. **Reproduce or locate.** Find the exact file and line behind the symptom before proposing anything. Use search across the repo. Confirm you are looking at the real cause, not a plausible-looking one. State the cause in one or two plain sentences ("two workflows both send a booking notice; only one should").

3. **Propose a minimal fix as a plan, first.** Before editing, tell the reporter in plain English what you would change and why. Smallest change that fixes the root cause. No drive-by refactors, no renames, no "while I am here" edits. Wait for a "go ahead" on anything non-trivial.

4. **Make the change on a branch, never on `main`.**
   - Branch from `main` (e.g. `fix/double-booking-email`). Never commit to `main`; branch protection is on.
   - Match the surrounding code style. Keep the diff tight and reviewable.

5. **Self-check before handing off.**
   - `node --check` every modified API handler. Vercel does not syntax-check serverless functions; a broken handler ships clean and crashes at runtime as `FUNCTION_INVOCATION_FAILED`.
   - For an HTML page with an inline `<script>`, extract and `node --check` that script block too.
   - New agent slug, new `sections.*` key, or a DB migration: see the repo `CLAUDE.md` checklist (CHECK constraints, snapshot `preserveKeys`). If a fix needs one of these, treat it as risky (step 7).
   - No em dashes anywhere: code, comments, copy, commit message, or chat. Use commas or "to" for ranges.

6. **Package it for Mac.** Open a PR (or push the branch and give the branch name). In the PR/summary state: the symptom, the cause, the fix, and how to verify. Tell the reporter to send Mac the link. Then run `codex review` on the change; fix every P1 and P2 before it is considered ready.

7. **Gate the risky stuff behind Mac.** Stop and route to Mac BEFORE changing anything that:
   - touches pricing, margins, money math, or a proposal that has already been sent (sent proposals are frozen, do not edit),
   - sends or changes email/SMS to customers,
   - deletes data or runs a database migration,
   - spans many files or changes shared behavior.
   When unsure, say so plainly and ask the reporter to loop Mac in. Never deploy these on your own.

8. **Deploy and verify (Mac's call, or with his go-ahead).**
   - After merge to `main`: `npx vercel --prod --yes` from the repo root. Auto-deploy is broken, so a manual prod deploy is required.
   - Curl-smoke each touched endpoint against `ryujin-os.vercel.app`. Build success is not runtime success.
   - Tell the reporter the exact steps to confirm the fix in the live app, then have them verify.

## Production incidents (live site down)

If customers are hitting errors right now (a page is down, bookings failing), this is an incident, not a routine fix:
- Tell the reporter to alert Mac immediately, in parallel with investigating.
- Diagnose fast: most likely cause, with the error text. Propose, do not silently ship.
- Do not rush an unreviewed fix to production. Mac drives the deploy.

## How to talk to a non-technical operator

- Explain in plain English. Lead with the cause and the fix in one or two sentences; keep code detail optional and below.
- Show your work: what was wrong, what you changed, why.
- Always end with "how to verify": the concrete steps they can repeat to confirm it is fixed.
- If asked "is this risky and who approves it?", answer honestly and name Mac for anything in step 7.
- Offer the smaller, safer option when there is a choice. Do not overwhelm with alternatives.

## Reminders specific to this repo

- The repo is multi-tenant: every table has `tenant_id`, every API route uses `requireTenant()`. Never expose or mix data across tenants.
- `.trim()` env var reads (Vercel newline bug).
- Customer-facing pages (`proposal-client.html`, `photos-share.html`) use the cream + royal-blue brand; internal portals (`portal-mobile.html`, `command-center.html`, `admin.html`) use the navy + teal-mint mockup. Do not mix the two.
- Prices are CAD, HST 15% (configurable per tenant). Round selling prices to the nearest $25.
