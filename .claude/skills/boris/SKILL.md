---
name: boris
description: Apply Boris Cherny's agentic-coding loop doctrine when writing, debugging, or shipping code — verification-target-first, plan-then-execute, isolated worktrees, adversarial review, then the Ryujin deploy ritual. Invoke `/boris` at the start of any non-trivial coding task (especially Ryujin / Vercel serverless work). Skip for one-sentence diffs.
---

# Boris mode — the coding loop

Operating doctrine distilled from Boris Cherny (creator of Claude Code). The point isn't to memorize it — when this skill is active, **run the loop**.

## Core law

**Never code without a verification target.** A loop only converges if there's a machine-readable pass/fail check (a test, `node --check`, a curl that must return 200, a screenshot vs. a mock). If there's no check, *Mac is the check* — so define one **before** writing code. Boris's #1 lever: give Claude its own verify-and-iterate loop ("2-3x the quality").

## The loop — run every coding task

0. **Trivial? Jump to step 3.** Typo, log line, rename, one-line fix → no plan, just do it + check.
1. **Name the verification target first.** State the exact check that will prove this works (see table). If one doesn't exist, create it before editing.
2. **Plan, then commit to the plan.** For non-trivial work, write a short plan: files to change, the flow, what's out of scope, and the end-to-end check. Iterate the *plan* with Mac before touching code. Pour the energy here so implementation one-shots — *"pour your energy into the plan so Claude can 1-shot the implementation."*
3. **Implement against the plan.** Don't drift from agreed scope mid-stream.
4. **Close the loop yourself.** Run the verification target → read the result → fix → repeat until green. **Show the evidence** (command + output / screenshot). Never report "done" without it.
5. **Adversarial review before declaring done.** `codex review` on the diff (block on P1/P2). If codex quota is out, run a fresh-context reviewer subagent scoped to **correctness + the stated requirements only**.
6. **Ship the Ryujin way.** Manual `npx vercel --prod --yes`, then **curl-smoke each touched handler** (build success ≠ runtime success). Apply DB migrations by hand (Supabase Management API + PAT) and `SELECT` to confirm.
7. **Capture the miss.** If something broke in a way that will recur, add a one-line memory / CLAUDE.md rule so it can't bite twice.

## Verification targets by task type (Ryujin)

| Task | The check |
| --- | --- |
| serverless handler (`api/*.js`) | `node --check` the file + curl the endpoint for 200 / expected JSON |
| UI page | headless screenshot vs. intent, or load it and confirm zero console errors |
| pricing / quote logic | a fixture case with a known expected output |
| migration | apply via Management API, then `SELECT` to confirm it took |
| bulk data / script | run on 2-3 items, eyeball the result, **then** scale |

## Parallelism

Running alongside other Claude sessions? **Isolated `git worktree` off `origin/main`, outside any cloud-synced folder (OneDrive, iCloud, Dropbox).** Never checkout or deploy from a cloud-synced tree while another session is live — that's the collision + `*-DESKTOP-*` sync-conflict trap.

## Course-correct, don't nag

Corrected twice on the same issue → the context is polluted with failed approaches. `/rewind` or `/clear` and re-prompt with what you learned, rather than steering line-by-line. Delegate the goal ("fix the failing checks"), gate the result.

## Watch-outs

- A naive check can be gamed (hardcoded pass). Keep the codex / human review layer — don't let the auto-loop be the only gate.
- Adversarial reviewers over-report; a reviewer told to find gaps always finds some. Scope to correctness + requirements; ignore phantom "could-be-better."
- No verification target = an unconverging loop = the "close the loops" failure Mac hits when racing. Don't start without one.

---
*Source: Boris Cherny. Full doctrine + citations: `reference_boris_loop_doctrine.md` and the 2026-05-29 research session.*
