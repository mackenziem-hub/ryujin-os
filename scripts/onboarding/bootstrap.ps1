#requires -Version 5.1
<#
  Ryujin OS - new machine bootstrap (Windows).

  Gets a new machine (e.g. Cat's) onto the shared brain: validates prerequisites,
  computes this machine's brain paths, wires .env.local + CLAUDE.local.md, and
  pulls the brain once. Safe to re-run (idempotent).

  Run from the repo folder:
    powershell -ExecutionPolicy Bypass -File scripts\onboarding\bootstrap.ps1
#>
$ErrorActionPreference = 'Stop'
function Say($m){ Write-Host $m }
function Warn($m){ Write-Host $m -ForegroundColor Yellow }
function Die($m){ Write-Host $m -ForegroundColor Red; exit 1 }
# UTF-8 no BOM: a BOM breaks Node --env-file (first key name gets a hidden prefix).
function Write-TextNoBom($path,$text){ [System.IO.File]::WriteAllText($path, $text, (New-Object System.Text.UTF8Encoding($false))) }

Say "=== Ryujin machine bootstrap ==="

# 1) repo root = two levels up from this script (scripts/onboarding/)
$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
if (-not (Test-Path (Join-Path $repoRoot 'CLAUDE.md'))) {
  Die "Not in the ryujin-os repo (no CLAUDE.md at $repoRoot). Clone the repo and run this from inside it."
}
Say "Repo: $repoRoot"

# 2) prerequisites
foreach ($tool in 'node','git') {
  if (-not (Get-Command $tool -ErrorAction SilentlyContinue)) {
    Die "$tool is not installed. Install it first.  node -> https://nodejs.org (LTS),  git -> https://git-scm.com"
  }
  Say ("Found {0}: {1}" -f $tool, (& $tool --version))
}

# 3) compute this machine's brain paths
$slug = ($repoRoot -replace '[:\\/]','-')           # Claude Code project-dir slug
$userHome = ($env:USERPROFILE -replace '\\','/')
$memoryDir = "$userHome/.claude/projects/$slug/memory"
$brainDir  = "$userHome/ryujin-brain"
Say "MEMORY dir: $memoryDir"
Say "BRAIN  dir: $brainDir"

# 4) ensure .env.local exists
$envFile = Join-Path $repoRoot '.env.local'
$example = Join-Path $repoRoot 'scripts/onboarding/env.local.example'
if (-not (Test-Path $envFile)) {
  Copy-Item $example $envFile
  Warn "Created .env.local from the template."
}

# 5) set or replace the two path vars in .env.local
function Set-EnvVar($path,$key,$val){
  $lines = @(Get-Content $path)
  $set = $false
  $out = foreach($l in $lines){
    if ($l -match "^\s*$key\s*="){ $set=$true; "$key=$val" } else { $l }
  }
  if (-not $set){ $out += "$key=$val" }
  Write-TextNoBom $path (($out -join "`n") + "`n")
}
Set-EnvVar $envFile 'RYUJIN_MEMORY_DIR' $memoryDir
Set-EnvVar $envFile 'RYUJIN_BRAIN_DIR'  $brainDir
Say "Wrote RYUJIN_MEMORY_DIR + RYUJIN_BRAIN_DIR into .env.local"

# 6) validate the 3 secrets are filled (not placeholders)
$envText = Get-Content $envFile -Raw
$missing = @()
foreach($k in 'SUPABASE_URL','SUPABASE_SERVICE_KEY','RYUJIN_SERVICE_TOKEN'){
  if ($envText -match "(?m)^\s*$k\s*=\s*(.*)$"){
    $v = $Matches[1].Trim()
    if ($v -eq '' -or $v -like 'PASTE_FROM_MAC*' -or $v -like 'https://YOUR-PROJECT*'){ $missing += $k }
  } else { $missing += $k }
}
if ($missing.Count -gt 0){
  Warn ""
  Warn "Almost there. Paste these values into .env.local (ask Mac), then re-run this script:"
  foreach($k in $missing){ Warn "   $k" }
  Warn "File to edit: $envFile"
  exit 0
}

# 7) write CLAUDE.local.md (machine-specific, gitignored) so 'load' / 'save' work
$claudeLocal = Join-Path $repoRoot 'CLAUDE.local.md'
$cl = @"
# This machine - Ryujin brain wiring

You are running in the ryujin-os repo on this operator's machine. The cross-machine
brain is wired via .env.local (RYUJIN_MEMORY_DIR + RYUJIN_BRAIN_DIR). MEMORY.md and
the principle files in the memory dir auto-load; SESSION_CONTEXT.md lives at
$brainDir/SESSION_CONTEXT.md.

## When the operator says "load"
Run, then read the top entry of the rebuilt SESSION_CONTEXT.md:
  node --env-file=.env.local scripts/context-pull.mjs
  (then read: $brainDir/SESSION_CONTEXT.md)

## When the operator says "save"
Author a new session entry at the TOP of $brainDir/SESSION_CONTEXT.md (what got
done, decisions made, what is still loose), then push it to the shared brain:
  node --env-file=.env.local scripts/context-push.mjs session

## Access posture: full peer, with guardrails
This operator can build, commit, open PRs, and deploy routine codex-reviewed fixes.
Follow the troubleshoot-ryujin skill. GATE behind Mac (do NOT do solo): pricing or
money math, edits to already-sent proposals, customer email or SMS, data deletes,
and database schema migrations (Mac holds the DDL token). When unsure, ask Mac.
"@
Write-TextNoBom $claudeLocal ($cl + "`n")
Say "Wrote CLAUDE.local.md (gitignored)"

# 8) pull the brain once
Say ""
Say "Pulling the shared brain..."
& node "--env-file=$envFile" (Join-Path $repoRoot 'scripts/context-pull.mjs')

# 9) next steps
Say ""
Say "=== Done. Next steps ==="
Say "1) Deploy access:  npx vercel login        (ask Mac to add you to the ryujin-os Vercel project)"
Say "2) GitHub access:  gh auth login           (ask Mac to add you to the GitHub repo)"
Say "3) Open THIS folder in Claude Code (desktop app: Open Folder -> $repoRoot), then say 'load'."
