#!/usr/bin/env bash
# Ryujin OS - new machine bootstrap (macOS / Linux). Mirror of bootstrap.ps1.
#
# Gets a new machine (e.g. Cat's Mac) onto the shared brain: validates prereqs,
# computes this machine's brain paths, wires .env.local + CLAUDE.local.md +
# .claude/settings.local.json, and pulls the brain. Safe to re-run.
#
# Usage:  bash scripts/onboarding/bootstrap.sh [-o <operator>] [-r <role>]
#   -o catplusultraroofing -r operator   (owners: -o mac -r owner)
set -euo pipefail

OPERATOR=""; ROLE="operator"
while getopts "o:r:" opt; do case "$opt" in o) OPERATOR="$OPTARG";; r) ROLE="$OPTARG";; esac; done

say(){ printf '%s\n' "$*"; }
die(){ printf 'ERROR: %s\n' "$*" >&2; exit 1; }

say "=== Ryujin machine bootstrap (macOS / Linux) ==="

# 1) repo root = two levels up from this script
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO="$(cd "$SCRIPT_DIR/../.." && pwd)"
[ -f "$REPO/CLAUDE.md" ] || die "Not in the ryujin-os repo (no CLAUDE.md at $REPO). Clone it and run from inside."
say "Repo: $REPO"

# 2) prerequisites
command -v node >/dev/null 2>&1 || die "node not installed. Install Node LTS from https://nodejs.org"
command -v git  >/dev/null 2>&1 || die "git not installed. Install from https://git-scm.com"
NODEV="$(node -v | sed 's/^v//')"; MAJ="${NODEV%%.*}"; REST="${NODEV#*.}"; MIN="${REST%%.*}"
if [ "$MAJ" -lt 20 ] || { [ "$MAJ" -eq 20 ] && [ "$MIN" -lt 6 ]; }; then
  die "Node $NODEV is too old. 'node --env-file' needs Node 20.6 or newer."
fi
say "Found node $NODEV, git $(git --version | awk '{print $3}')"
if command -v gh >/dev/null 2>&1; then say "Found gh $(gh --version | head -1 | awk '{print $3}')"
else say "Note: gh (GitHub CLI) is not installed. Install with: brew install gh   then: gh auth login"; fi

# 3) this machine's brain paths (slug = cwd with every non-alnum char as a dash)
SLUG="$(printf '%s' "$REPO" | sed 's/[^A-Za-z0-9]/-/g')"
MEMDIR="$HOME/.claude/projects/$SLUG/memory"
BRAINDIR="$HOME/ryujin-brain"
say "MEMORY dir: $MEMDIR"
say "BRAIN  dir: $BRAINDIR"

# 4) ensure .env.local exists
ENVF="$REPO/.env.local"
if [ ! -f "$ENVF" ]; then cp "$REPO/scripts/onboarding/env.local.example" "$ENVF"; say "Created .env.local from the template."; fi

# 5) set or replace a key in .env.local
set_env(){
  local k="$1" v="$2" f="$3" tmp
  if grep -qE "^[[:space:]]*$k[[:space:]]*=" "$f"; then
    tmp="$(mktemp)"
    awk -v k="$k" -v v="$v" '{ if ($0 ~ "^[[:space:]]*"k"[[:space:]]*=") print k"="v; else print }' "$f" > "$tmp" && mv "$tmp" "$f"
  else
    printf '%s=%s\n' "$k" "$v" >> "$f"
  fi
}
set_env RYUJIN_MEMORY_DIR "$MEMDIR" "$ENVF"
set_env RYUJIN_BRAIN_DIR  "$BRAINDIR" "$ENVF"
say "Wrote RYUJIN_MEMORY_DIR + RYUJIN_BRAIN_DIR into .env.local"

# 6) identity: only when an operator is named (else stay fully unset = unfiltered)
if [ -n "$OPERATOR" ]; then
  set_env RYUJIN_OPERATOR "$OPERATOR" "$ENVF"
  set_env RYUJIN_ROLE "$ROLE" "$ENVF"
  say "Set identity: RYUJIN_OPERATOR=$OPERATOR, RYUJIN_ROLE=$ROLE"
else
  say "No -o operator given; identity left unset (unfiltered). Pass -o <name> -r owner|operator to enable the per-person filter."
fi

# 7) validate the 3 secrets are filled
MISS=""
for k in SUPABASE_URL SUPABASE_SERVICE_KEY RYUJIN_SERVICE_TOKEN; do
  v="$(grep -E "^[[:space:]]*$k[[:space:]]*=" "$ENVF" | head -1 | sed 's/^[^=]*=//' | tr -d '[:space:]')"
  case "$v" in ""|PASTE_FROM_MAC*|https://YOUR-PROJECT*) MISS="$MISS $k";; esac
done
if [ -n "$MISS" ]; then
  say ""; say "Almost there. Paste these values into .env.local (ask Mac), then re-run this script:"
  for k in $MISS; do say "   $k"; done
  say "File to edit: $ENVF"
  exit 0
fi

# 8) CLAUDE.local.md (machine-specific, gitignored) so 'load' / 'save' work
cat > "$REPO/CLAUDE.local.md" <<EOF
# This machine - Ryujin brain wiring

You are running in the ryujin-os repo on this operator's machine. The cross-machine
brain is wired via .env.local (RYUJIN_MEMORY_DIR + RYUJIN_BRAIN_DIR). MEMORY.md and
the principle files in the memory dir auto-load; SESSION_CONTEXT.md lives at
$BRAINDIR/SESSION_CONTEXT.md.

## When the operator says "load"
  node --env-file=.env.local scripts/context-pull.mjs
  (then read: $BRAINDIR/SESSION_CONTEXT.md)

## When the operator says "save"
Author a new session entry at the TOP of $BRAINDIR/SESSION_CONTEXT.md, then:
  node --env-file=.env.local scripts/context-push.mjs session

## Access posture: full peer, with guardrails
This operator can build, commit, open PRs, and deploy routine codex-reviewed fixes.
Follow the troubleshoot-ryujin skill. GATE behind Mac (do NOT do solo): pricing or
money math, edits to already-sent proposals, customer email or SMS, data deletes,
and database schema migrations (Mac holds the DDL token). When unsure, ask Mac.
EOF
say "Wrote CLAUDE.local.md (gitignored)"

# 9) starter permission posture (.claude/settings.local.json, gitignored)
mkdir -p "$REPO/.claude"
if [ ! -f "$REPO/.claude/settings.local.json" ]; then
  cat > "$REPO/.claude/settings.local.json" <<'EOF'
{
  "permissions": {
    "defaultMode": "default",
    "allow": [
      "Read", "Grep", "Glob", "Edit", "Write",
      "Bash(git status:*)", "Bash(git diff:*)", "Bash(git log:*)", "Bash(git show:*)",
      "Bash(git add:*)", "Bash(git commit:*)", "Bash(git branch:*)", "Bash(git checkout:*)",
      "Bash(git switch:*)", "Bash(git restore:*)", "Bash(git stash:*)", "Bash(git fetch:*)",
      "Bash(git pull:*)", "Bash(node --check:*)", "Bash(npm test:*)", "Bash(npm run:*)",
      "Bash(npm ci:*)", "Bash(gh pr create:*)", "Bash(gh pr view:*)", "Bash(gh pr list:*)"
    ],
    "ask": [
      "Bash(git push:*)", "Bash(npx vercel:*)", "Bash(vercel:*)", "Bash(gh pr merge:*)",
      "Bash(curl:*)", "Bash(psql:*)"
    ],
    "deny": [
      "Bash(git push --force:*)", "Bash(git push -f:*)", "Bash(rm -rf:*)", "Bash(rm -fr:*)"
    ]
  }
}
EOF
  say "Wrote .claude/settings.local.json (starter permission posture, gitignored)"
else
  say ".claude/settings.local.json already exists, left as-is"
fi

# 10) pull the brain once
say ""; say "Pulling the shared brain..."
node --env-file="$ENVF" "$REPO/scripts/context-pull.mjs"

# 11) next steps
say ""
say "=== Done. Next steps ==="
say "1) GitHub:  gh auth login   (ask Mac to add you to the ryujin-os repo)"
say "2) Deploy:  ask Mac to add you to the ryujin-os Vercel project (for npx vercel)"
say "3) Open this folder in Claude Code, then say 'load'."
