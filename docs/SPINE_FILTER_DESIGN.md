# Per-person spine filter (design + MVP)

Status: MVP shipped 2026-06-27. The cross-machine brain (Supabase `session_entries` +
`context_principles`, see migration 101) transfers everything to everyone. As more
operators come online (Cat, future crew) that becomes noise. This adds a per-person
filter so each operator's LOAD pulls its relevant slice while the shared brain still
holds it all.

## Model: author + audience, defaulted by role

Each session entry carries:
- **author**: who wrote it (`mac`, `cat`, ...), from `RYUJIN_OPERATOR`.
- **role**: `owner` or `operator`, from `RYUJIN_ROLE` (per machine).
- **audience**: `all` (broadcast) or `self` (author's own stream). A specific operator
  name is also honored (addressed-to), but the MVP only sets `all` / `self`.

**Default audience by role** (so nobody has to tag by hand):
- Owner saves default to `all` (decisions and directives reach everyone).
- Operator saves default to `self` (routine work stays in their stream).
- Override per save with `--audience all|self`.

## How LOAD filters

`context-pull.mjs` reads `RYUJIN_OPERATOR` + `RYUJIN_ROLE` and rebuilds SESSION_CONTEXT.md
from the entries visible to that operator:

- An entry is visible if `audience='all'`, OR you are its `author`, OR it is addressed to
  you by name.
- Owners additionally get a one-line **digest** of operators' own-stream entries that were
  filtered out (latest per operator), so oversight survives the filter.
- `context-pull.mjs --full` bypasses the filter and pulls everything.
- If `RYUJIN_OPERATOR` is unset, there is no filter (you see everything). This is the
  back-compat default: an un-provisioned machine behaves exactly as before.

Result: Cat sees her own work + your broadcasts + the shared principles; you see your own
+ broadcasts + a digest of what Cat did, and `load full` when you want her detail.

## Identity provisioning

Per machine, in `.env.local`:
```
RYUJIN_OPERATOR=cat        # your short name; unset = unfiltered
RYUJIN_ROLE=operator       # owner | operator
```
`bootstrap.ps1 -Operator cat -Role operator` writes these. Owners set
`-Operator mac -Role owner`. Existing machines stay unset (unfiltered) until you add them,
so rollout is opt-in and risk-free.

## Schema (migration 105)

Additive, backward-compatible:
```
ALTER TABLE session_entries ADD COLUMN IF NOT EXISTS author   TEXT;            -- nullable
ALTER TABLE session_entries ADD COLUMN IF NOT EXISTS audience TEXT NOT NULL DEFAULT 'all';
CREATE INDEX IF NOT EXISTS idx_session_entries_tenant_author ON session_entries (tenant_id, author);
```
Existing rows get `audience='all'` (everyone still sees them) and `author=NULL` (treated as
shared). No regression.

## Files

- `schema/migration_105_session_entry_filter.sql` — the two columns + index.
- `api/context-store.js` — GET selects + POST stores `author` + `audience`.
- `scripts/context-push.mjs` — stamps author + role-defaulted audience; `--audience` flag.
- `scripts/context-pull.mjs` — filter + owner digest + `--full`; identity from env.
- `scripts/onboarding/bootstrap.ps1` — `-Operator` / `-Role` params write the identity.
- `scripts/onboarding/env.local.example` — documents the two vars.

## Rollout order

1. Apply migration 105 (owner / PAT gated).
2. Merge the code.
3. Deploy the API (`npx vercel --prod`) so pushes store author/audience.
4. Set identities per machine (bootstrap params, or hand-edit `.env.local`). Until then,
   every machine is unfiltered (current behavior).

## Verification

- Filter logic: deterministic fixture covering operator / owner / `--full` / legacy
  (all pass).
- Back-compat: a machine with no identity renders the full set, unchanged.
- Post-migration e2e: push a `self` entry as an operator, confirm an owner's normal load
  excludes it (digest only), the operator's load includes it, and `--full` shows all.

## Known limitations

- The unpushed-divergence guard checks the newest ~80 rows. For a filtered operator whose
  newest visible entry has aged out behind 80+ newer entries from others, the guard can
  raise a false CONNECTOR GAP (non-destructive: it keeps the local file, writes the sidecar,
  and self-heals on the next save). Unlikely with few operators; revisit the window or a
  targeted existence check if operator count grows.

## Out of scope (future)

- Per-role filtering of `context_principles` (today all load for everyone).
- Topic / stream subscriptions (sales, infra, marketing).
- A central console to manage operator capabilities and visibility in one place.
