# Ryujin OS - new machine setup (shared brain + full code access)

This gets a new machine (for example Cat's) onto the same Ryujin codebase and the
same cross-machine "brain" (session context + durable memory) that Mac's machine
uses. After this, the new machine can read the shared brain, build and fix code,
open PRs, and deploy routine reviewed changes.

The brain mechanics live in `scripts/context-pull.mjs` (LOAD) and
`scripts/context-push.mjs` (SAVE). Source of truth is Supabase; local files are a
rebuildable cache.

## Access model: full peer, with guardrails

Shared with the new machine (same values as Mac's machine, treat like passwords):
- `SUPABASE_URL`, `SUPABASE_SERVICE_KEY` (read and write the shared brain + data)
- `RYUJIN_SERVICE_TOKEN` (app writes, for example `context-push`)
- Vercel project access (deploy), via a personal Vercel login
- GitHub repo access, via a personal GitHub login

Withheld by design:
- `SUPABASE_PAT` (database schema / DDL). Schema migrations stay with Mac. Ask him
  to run any migration.

Guardrails (enforced by the `troubleshoot-ryujin` skill): route these to Mac, do
not do them solo: pricing or money math, edits to already-sent proposals, customer
email or SMS, data deletes, and database migrations.

Revoking access: Vercel and GitHub are per person, revoke those directly. The two
shared secrets (service key, service token) are shared, so revoking them means
rotating them for everyone.

## One time: what Mac does

1. Send the operator these three values from his `.env.local`, over a secure
   channel (a password manager, not plain email):
   `SUPABASE_URL`, `SUPABASE_SERVICE_KEY`, `RYUJIN_SERVICE_TOKEN`.
2. Add the operator to the ryujin-os Vercel project (Vercel dashboard, project,
   Settings, Members).
3. Add the operator to the ryujin-os GitHub repository as a collaborator.

## One time: what the operator does

Prerequisites (install if missing):
- Node.js LTS: https://nodejs.org
- Git: https://git-scm.com
- Claude Code (in the Claude desktop app, or the CLI)

Steps:
1. Clone the repo, outside OneDrive:
   ```
   git clone <repo-url> C:\Users\<you>\Code\ryujin-os
   ```
2. From the repo folder, run the bootstrap:
   ```
   powershell -ExecutionPolicy Bypass -File scripts\onboarding\bootstrap.ps1
   ```
   It checks prerequisites, sets this machine's brain paths in `.env.local`, and
   then asks you to paste the three secrets from Mac.
3. Paste the three secrets into `.env.local`, then run the bootstrap again. It
   finishes: pulls the brain, writes `CLAUDE.local.md`, and prints next steps.
4. Sign in to deploy and to GitHub:
   ```
   npx vercel login
   gh auth login
   ```
5. Open the ryujin-os folder in Claude Code (desktop app: Open Folder). This loads
   the repo `CLAUDE.md`, the `troubleshoot-ryujin` skill, and `CLAUDE.local.md`.
6. Say "load" to pull the latest brain and see current state.

## Daily use

- "load" at the start of a session:
  ```
  node --env-file=.env.local scripts/context-pull.mjs
  ```
  then read the top entry of `<brain dir>/SESSION_CONTEXT.md`.
- "save" at the end: author a new entry at the top of `SESSION_CONTEXT.md`, then
  ```
  node --env-file=.env.local scripts/context-push.mjs session
  ```

`CLAUDE.local.md` (written by the bootstrap) tells Claude these commands on this
machine, so the operator can just say "load" and "save".

## What setup cannot fix (harness guardrails)

A few actions are blocked by Claude Code itself, not by permissions, so they will
be blocked on the new machine too. Workarounds:
- Bulk database writes (mass RLS-bypass): loop the app's per-record API instead.
- Self-modifying Claude's own settings or config: have a human edit it.
- Installing skills: a human adds the allowlist rule, or runs the install via "!".

## How the brain wiring works

- Source of truth is Supabase (`session_entries` + `context_principles`). Local
  files are a rebuildable cache.
- `context-pull.mjs` rebuilds, on THIS machine: `SESSION_CONTEXT.md` (in
  `RYUJIN_BRAIN_DIR`) and the durable memory + `MEMORY.md` (in `RYUJIN_MEMORY_DIR`).
- Paths default to Mac's machine. A new machine sets `RYUJIN_MEMORY_DIR` and
  `RYUJIN_BRAIN_DIR` (the bootstrap does this) and the brain materializes there.
- `context-push.mjs` writes one record at a time through the app, tagged with this
  machine's hostname, so two machines saving at once never fork the file.

## Troubleshooting

- "MEMORY.md is not auto-loading": confirm `RYUJIN_MEMORY_DIR` matches this
  machine's real Claude Code project memory dir. Claude creates
  `<home>/.claude/projects/<project-slug>/memory` on first run in a folder; the
  slug is the folder path with `:` `\` `/` replaced by `-`. Launch Claude Code in
  the repo folder so the slug matches what the bootstrap computed.
- "context-pull prints [FAIL] context_store": a connector gap. Check the three
  secrets in `.env.local` are correct and that the machine is online.
- "context-push exits non-zero": the push failed (missing token, network). Re-run
  before relying on it; nothing propagates until it succeeds.
