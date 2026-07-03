#Requires -Version 5.1
#Requires -RunAsAdministrator

$ErrorActionPreference = 'Stop'
$ProjectRoot = Split-Path -Parent $PSScriptRoot
$LocalMetaPath = Join-Path $ProjectRoot 'deploy\tunnel.local.json'
$NodeScript = Join-Path $ProjectRoot 'scripts\start-node-only.ps1'

if (-not (Test-Path $LocalMetaPath)) {
  Write-Host 'Please run scripts\setup-named-tunnel.ps1 first.' -ForegroundColor Yellow
  exit 1
}

$CloudflaredCommand = Get-Command cloudflared -ErrorAction SilentlyContinue
$Cloudflared = if ($CloudflaredCommand) { $CloudflaredCommand.Source } else { $null }
if (-not $Cloudflared) {
  $Cloudflared = (Get-ChildItem -Path "$env:LOCALAPPDATA\Microsoft\WinGet\Packages" -Recurse -Filter cloudflared.exe -ErrorAction SilentlyContinue | Select-Object -First 1).FullName
}
if (-not $Cloudflared) { throw 'cloudflared not found.' }

Write-Host '1/2 Installing cloudflared Windows service...' -ForegroundColor Cyan
try { & $Cloudflared service uninstall 2>$null | Out-Null } catch {}
& $Cloudflared service install
Write-Host '    cloudflared service installed.' -ForegroundColor Green

Write-Host '2/2 Registering Node server scheduled task...' -ForegroundColor Cyan
$taskName = 'RuianMahjongNode'
$action = New-ScheduledTaskAction -Execute 'powershell.exe' `
  -Argument "-WindowStyle Hidden -ExecutionPolicy Bypass -File `"$NodeScript`""
$trigger = New-ScheduledTaskTrigger -AtLogOn
$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable -ExecutionTimeLimit ([TimeSpan]::Zero)
Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger -Settings $settings -Force | Out-Null
Write-Host "    Scheduled task registered: $taskName" -ForegroundColor Green

$meta = Get-Content $LocalMetaPath -Raw | ConvertFrom-Json
Write-Host ''
Write-Host 'Done. Fixed URL:' -ForegroundColor Green
Write-Host $meta.publicUrl
