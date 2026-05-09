# One-shot: PUT EagleView measurements to WO-11 (95 Cornhill / Donna Boosamra).
#
# Usage (after reading the PDF at C:\Users\Owner\95cornhill.pdf):
#   .\put-95cornhill-measurements.ps1 -EavesLF 120 -RakesLF 95 -ValleysLF 40 -RidgesLF 55 -HipsLF 22 -WallsLF 0
#
# Optional: -Pipes 1 -Vents 2 -Chimneys 0 -OsbSheets 0
# Defaults assume the baseline (1 pipe, no other penetrations or redeck).
#
# Requires migration_015 (workorders edge LF columns) to be applied first.
# If you get "column does not exist" errors, paste schema/migration_015_workorder_measurements.sql
# into Supabase SQL Editor and re-run.

param(
  [Parameter(Mandatory=$true)] [double]$EavesLF,
  [Parameter(Mandatory=$true)] [double]$RakesLF,
  [Parameter(Mandatory=$true)] [double]$ValleysLF,
  [Parameter(Mandatory=$true)] [double]$RidgesLF,
  [Parameter(Mandatory=$true)] [double]$HipsLF,
  [double]$WallsLF = 0,
  [int]$Pipes = 1,
  [int]$Vents = 0,
  [int]$Chimneys = 0,
  [int]$OsbSheets = 0
)

$envFile = Get-Content "C:\Users\Owner\OneDrive\Desktop\Ryujin\ryujin-os\.env.local"
$env:SUPABASE_URL = (($envFile | Where-Object { $_ -match '^SUPABASE_URL=' }) -replace '^SUPABASE_URL=','').Trim().Trim('"')
$env:SUPABASE_SERVICE_KEY = (($envFile | Where-Object { $_ -match '^SUPABASE_SERVICE_KEY=' }) -replace '^SUPABASE_SERVICE_KEY=','').Trim().Trim('"')

$tenant = '84c91cb9-df07-4424-8938-075e9c50cb3b'
$woId   = 'b472365f-957b-4128-9720-445d14f575a3'  # WO-11, 95 Cornhill, Donna Boosamra

$headers = @{
  apikey = $env:SUPABASE_SERVICE_KEY
  Authorization = "Bearer $($env:SUPABASE_SERVICE_KEY)"
  'Content-Type' = 'application/json'
  Prefer = 'return=representation'
}

$body = @{
  eaves_lf = $EavesLF; rakes_lf = $RakesLF; ridges_lf = $RidgesLF
  hips_lf = $HipsLF;   valleys_lf = $ValleysLF; walls_lf = $WallsLF
  pipes = $Pipes; vents = $Vents; chimneys = $Chimneys
  osb_sheets = $OsbSheets
} | ConvertTo-Json

Write-Output "PATCHing WO-11 with measurements:"
Write-Output $body

$resp = Invoke-RestMethod -Method Patch `
  -Uri "$($env:SUPABASE_URL)/rest/v1/workorders?id=eq.$woId&tenant_id=eq.$tenant" `
  -Headers $headers `
  -Body $body

Write-Output "`nUpdated WO-11. New measurements:"
$resp | Select-Object eaves_lf, rakes_lf, ridges_lf, hips_lf, valleys_lf, walls_lf, pipes, vents, chimneys, osb_sheets | Format-List

Write-Output "`nNext: open /production-materials.html in the app, view WO-11, confirm the material list regenerated."
