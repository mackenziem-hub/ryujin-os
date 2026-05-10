# Ryujin OS - Grok Asset Batch Downloader
# Run from PowerShell: .\download-batch.ps1
# Downloads all 29 generated assets to _review\images\ and _review\videos\

$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$imgDir = Join-Path $root "images"
$vidDir = Join-Path $root "videos"

New-Item -ItemType Directory -Force -Path $imgDir | Out-Null
New-Item -ItemType Directory -Force -Path $vidDir | Out-Null

$images = @{
    "icon-home.png"           = "https://d8j0ntlcm91z4.cloudfront.net/user_3DD6hYE3a5mN88Q6BxNtqBGzInz/hf_20260509_235540_61050f77-9ea9-427e-bf48-30f9c274cd7c.png"
    "icon-photos.png"         = "https://d8j0ntlcm91z4.cloudfront.net/user_3DD6hYE3a5mN88Q6BxNtqBGzInz/hf_20260509_235543_44a0b3ff-df58-49ee-8709-686efc55fa95.png"
    "quest-card-bg.png"       = "https://d8j0ntlcm91z4.cloudfront.net/user_3DD6hYE3a5mN88Q6BxNtqBGzInz/hf_20260509_235559_83e79b6e-2f61-4278-bab8-67760c91d1c3.png"
    "quest-icon-daily.png"    = "https://d8j0ntlcm91z4.cloudfront.net/user_3DD6hYE3a5mN88Q6BxNtqBGzInz/hf_20260509_235602_0d892d69-e01d-444a-87db-94df160aa546.png"
    "quest-icon-campaign.png" = "https://d8j0ntlcm91z4.cloudfront.net/user_3DD6hYE3a5mN88Q6BxNtqBGzInz/hf_20260509_235605_ab8e7374-5f50-4a84-8b83-69709bb6eeba.png"
    "quest-icon-optional.png" = "https://d8j0ntlcm91z4.cloudfront.net/user_3DD6hYE3a5mN88Q6BxNtqBGzInz/hf_20260509_235608_00f7a90a-7fce-455d-8449-f201789e66ff.png"
    "quest-cat-sales.png"     = "https://d8j0ntlcm91z4.cloudfront.net/user_3DD6hYE3a5mN88Q6BxNtqBGzInz/hf_20260509_235612_b8c32e6d-0243-4962-93fb-f3cb94b18c19.png"
    "quest-cat-marketing.png" = "https://d8j0ntlcm91z4.cloudfront.net/user_3DD6hYE3a5mN88Q6BxNtqBGzInz/hf_20260509_235615_934d61ee-faa5-46b2-87d1-79f7d317da1c.png"
    "quest-cat-ops.png"       = "https://d8j0ntlcm91z4.cloudfront.net/user_3DD6hYE3a5mN88Q6BxNtqBGzInz/hf_20260509_235617_eb778c8b-e8b1-481f-b0ea-aa7edc2b1ee6.png"
    "quest-cat-finance.png"   = "https://d8j0ntlcm91z4.cloudfront.net/user_3DD6hYE3a5mN88Q6BxNtqBGzInz/hf_20260509_235620_6278400c-2290-4890-a6ad-ea0342849032.png"
    "quest-cat-customer.png"  = "https://d8j0ntlcm91z4.cloudfront.net/user_3DD6hYE3a5mN88Q6BxNtqBGzInz/hf_20260509_235623_d8885297-e74f-49f1-a1b5-7fe8d98d47f1.png"
    "quest-cat-strategy.png"  = "https://d8j0ntlcm91z4.cloudfront.net/user_3DD6hYE3a5mN88Q6BxNtqBGzInz/hf_20260509_235626_92146601-3da8-437c-b0a0-cbe13ad4543a.png"
    "xp-bar-empty.png"        = "https://d8j0ntlcm91z4.cloudfront.net/user_3DD6hYE3a5mN88Q6BxNtqBGzInz/hf_20260509_235643_238778fe-b510-4249-9727-1efacd367a8f.png"
    "xp-bar-fill.png"         = "https://d8j0ntlcm91z4.cloudfront.net/user_3DD6hYE3a5mN88Q6BxNtqBGzInz/hf_20260509_235646_f9bca5fd-ff60-4c39-8330-f0d41045f345.png"
    "power-gauge.png"         = "https://d8j0ntlcm91z4.cloudfront.net/user_3DD6hYE3a5mN88Q6BxNtqBGzInz/hf_20260509_235649_1fff6dc3-7bb0-454a-90c7-57acceb5fd57.png"
    "agent-card-frame.png"    = "https://d8j0ntlcm91z4.cloudfront.net/user_3DD6hYE3a5mN88Q6BxNtqBGzInz/hf_20260509_235652_f6d64f33-c099-44d2-80c5-ea20f7c2ae01.png"
    "agent-report-bg.png"     = "https://d8j0ntlcm91z4.cloudfront.net/user_3DD6hYE3a5mN88Q6BxNtqBGzInz/hf_20260509_235655_3b1b0107-68ef-4852-9025-8cec3531f421.png"
    "kpi-gauge-circle.png"    = "https://d8j0ntlcm91z4.cloudfront.net/user_3DD6hYE3a5mN88Q6BxNtqBGzInz/hf_20260509_235658_48825874-c3b4-41f3-be9a-e4f6c78879fd.png"
    "kpi-gauge-bar.png"       = "https://d8j0ntlcm91z4.cloudfront.net/user_3DD6hYE3a5mN88Q6BxNtqBGzInz/hf_20260509_235703_2ecbcbd9-73e3-4982-9992-8b3b83459466.png"
    "kpi-gauge-trend.png"     = "https://d8j0ntlcm91z4.cloudfront.net/user_3DD6hYE3a5mN88Q6BxNtqBGzInz/hf_20260509_235705_0f762ce6-e01f-4982-b7c4-1add7faa3015.png"
    "briefing-hero.png"       = "https://d8j0ntlcm91z4.cloudfront.net/user_3DD6hYE3a5mN88Q6BxNtqBGzInz/hf_20260509_235708_aec64383-013e-45b3-821b-4ee75e92c520.png"
    "priority-urgent.png"     = "https://d8j0ntlcm91z4.cloudfront.net/user_3DD6hYE3a5mN88Q6BxNtqBGzInz/hf_20260509_235711_799e2f60-ff15-4dad-9b40-2aaa150811bf.png"
    "priority-high.png"       = "https://d8j0ntlcm91z4.cloudfront.net/user_3DD6hYE3a5mN88Q6BxNtqBGzInz/hf_20260509_235727_add0a76d-b0d3-4742-bd51-81f6b6b213e0.png"
    "priority-normal.png"     = "https://d8j0ntlcm91z4.cloudfront.net/user_3DD6hYE3a5mN88Q6BxNtqBGzInz/hf_20260509_235729_42bc6881-007f-4c2e-bd56-62e87fb80d8a.png"
    "badge-locked.png"        = "https://d8j0ntlcm91z4.cloudfront.net/user_3DD6hYE3a5mN88Q6BxNtqBGzInz/hf_20260509_235732_2e2294de-73cf-489d-87bb-52b12f957c2b.png"
    "badge-unlocked.png"      = "https://d8j0ntlcm91z4.cloudfront.net/user_3DD6hYE3a5mN88Q6BxNtqBGzInz/hf_20260509_235735_19c8c13d-c15b-4f56-abd1-e37fea43970b.png"
    "rule-editor-canvas.png"  = "https://d8j0ntlcm91z4.cloudfront.net/user_3DD6hYE3a5mN88Q6BxNtqBGzInz/hf_20260509_235738_f43f8bc9-c0b1-4243-85a1-50f738825555.png"
    "simulator-frame.png"     = "https://d8j0ntlcm91z4.cloudfront.net/user_3DD6hYE3a5mN88Q6BxNtqBGzInz/hf_20260509_235741_c955af9c-d67b-46d2-bc7c-cd25638d4c74.png"
}

$videos = @{
    "splash-loop.mp4"              = "https://d8j0ntlcm91z4.cloudfront.net/user_3DD6hYE3a5mN88Q6BxNtqBGzInz/hf_20260509_235850_19d7e73a-73d4-4d0b-a973-faea60f69593.mp4"
    "hero-bg-loop.mp4"             = "https://d8j0ntlcm91z4.cloudfront.net/user_3DD6hYE3a5mN88Q6BxNtqBGzInz/hf_20260509_235853_508edaed-ba8a-4c22-b3a0-af4837a4388c.mp4"
    "login-bg-loop.mp4"            = "https://d8j0ntlcm91z4.cloudfront.net/user_3DD6hYE3a5mN88Q6BxNtqBGzInz/hf_20260509_235856_e93e5931-b579-4cf9-b341-598c10f98d9c.mp4"
    "task-complete.mp4"            = "https://d8j0ntlcm91z4.cloudfront.net/user_3DD6hYE3a5mN88Q6BxNtqBGzInz/hf_20260509_235859_0634cb90-aa28-49db-8407-b3359fdfa5ec.mp4"
    "notification-pulse.mp4"       = "https://d8j0ntlcm91z4.cloudfront.net/user_3DD6hYE3a5mN88Q6BxNtqBGzInz/hf_20260509_235902_f5387a9c-11c0-4b58-8ccc-437091d690c0.mp4"
    "level-up-effect.mp4"          = "https://d8j0ntlcm91z4.cloudfront.net/user_3DD6hYE3a5mN88Q6BxNtqBGzInz/hf_20260509_235914_95b0d62f-14e9-48e0-b413-ed972daba785.mp4"
    "achievement-unlock-toast.mp4" = "https://d8j0ntlcm91z4.cloudfront.net/user_3DD6hYE3a5mN88Q6BxNtqBGzInz/hf_20260509_235917_160715c9-c96d-41e7-9da0-6aced0e93efa.mp4"
}

Write-Host "`n=== Ryujin OS - Downloading 22 images ===" -ForegroundColor Cyan
foreach ($file in $images.GetEnumerator()) {
    $dest = Join-Path $imgDir $file.Key
    Write-Host "  $($file.Key)" -NoNewline
    try {
        Invoke-WebRequest -Uri $file.Value -OutFile $dest -UseBasicParsing
        Write-Host " OK" -ForegroundColor Green
    } catch {
        Write-Host " FAILED: $_" -ForegroundColor Red
    }
}

Write-Host "`n=== Downloading 7 videos ===" -ForegroundColor Cyan
foreach ($file in $videos.GetEnumerator()) {
    $dest = Join-Path $vidDir $file.Key
    Write-Host "  $($file.Key)" -NoNewline
    try {
        Invoke-WebRequest -Uri $file.Value -OutFile $dest -UseBasicParsing
        Write-Host " OK" -ForegroundColor Green
    } catch {
        Write-Host " FAILED: $_" -ForegroundColor Red
    }
}

Write-Host "`n=== Complete ===" -ForegroundColor Cyan
Write-Host "Images: $(Get-ChildItem $imgDir -Filter *.png | Measure-Object | Select-Object -ExpandProperty Count)/22"
Write-Host "Videos: $(Get-ChildItem $vidDir -Filter *.mp4 | Measure-Object | Select-Object -ExpandProperty Count)/7"
