#Requires -Version 5.1
param(
  [string]$TunnelName = 'ruian-mahjong',
  [string]$Hostname = '',
  [int]$Port = 3000,
  [switch]$InstallService
)

$ErrorActionPreference = 'Stop'
$ProjectRoot = Split-Path -Parent $PSScriptRoot
$DeployDir = Join-Path $ProjectRoot 'deploy'
$CloudflaredDir = Join-Path $env:USERPROFILE '.cloudflared'
$ConfigPath = Join-Path $CloudflaredDir 'config.yml'
$LocalMetaPath = Join-Path $DeployDir 'tunnel.local.json'

function Get-CloudflaredPath {
  $cmd = Get-Command cloudflared -ErrorAction SilentlyContinue
  if ($cmd) { return $cmd.Source }
  $winget = Get-ChildItem -Path "$env:LOCALAPPDATA\Microsoft\WinGet\Packages" -Recurse -Filter cloudflared.exe -ErrorAction SilentlyContinue | Select-Object -First 1
  if ($winget) { return $winget.FullName }
  throw 'cloudflared not found. Run: winget install Cloudflare.cloudflared'
}

function Ensure-CloudflaredLogin {
  param([string]$Cloudflared, [string]$Dir)
  New-Item -ItemType Directory -Force -Path $Dir | Out-Null
  $cert = Join-Path $Dir 'cert.pem'
  if (Test-Path $cert) { return }
  Write-Host ''
  Write-Host '[1/4] Login Cloudflare (browser will open)' -ForegroundColor Cyan
  & $Cloudflared tunnel login
  if (-not (Test-Path $cert)) {
    throw 'Login failed: cert.pem not found'
  }
}

function Find-TunnelByName {
  param([string]$Cloudflared, [string]$Name)
  $listJson = & $Cloudflared tunnel list --output json 2>$null
  if (-not $listJson) { return $null }
  try {
    $tunnels = $listJson | ConvertFrom-Json
    return $tunnels | Where-Object { $_.name -eq $Name } | Select-Object -First 1
  } catch {
    return $null
  }
}

function Get-OrCreateTunnel {
  param([string]$Cloudflared, [string]$Name)
  Write-Host ''
  Write-Host '[2/4] Create Named Tunnel' -ForegroundColor Cyan
  $existing = Find-TunnelByName -Cloudflared $Cloudflared -Name $Name
  if ($existing) {
    Write-Host ('    Tunnel exists: ' + $Name + ' id=' + $existing.id) -ForegroundColor Green
    return [PSCustomObject]@{ Id = $existing.id; Name = $Name }
  }
  $output = & $Cloudflared tunnel create $Name 2>&1 | Out-String
  Write-Host $output
  $created = Find-TunnelByName -Cloudflared $Cloudflared -Name $Name
  if (-not $created) { throw ('Failed to create tunnel: ' + $Name) }
  return [PSCustomObject]@{ Id = $created.id; Name = $Name }
}

function Write-TunnelConfig {
  param(
    [string]$TunnelId,
    [string]$Hostname,
    [int]$Port,
    [string]$CredentialsFile,
    [string]$OutConfig
  )
  $credPath = $CredentialsFile -replace '\\', '/'
  $lines = @(
    ('tunnel: ' + $TunnelId)
    ('credentials-file: ' + $credPath)
    ''
    'ingress:'
    ('  - hostname: ' + $Hostname)
    ('    service: http://localhost:' + $Port)
    '  - service: http_status:404'
  )
  Set-Content -LiteralPath $OutConfig -Value $lines -Encoding UTF8
}

function Install-CloudflaredService {
  param([string]$Cloudflared)
  Write-Host ''
  Write-Host 'Install cloudflared Windows service (admin required)' -ForegroundColor Cyan
  $isAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
  if (-not $isAdmin) {
    Write-Host 'Skipped: not running as admin. Re-run with -InstallService as admin.' -ForegroundColor Yellow
    return
  }
  try { & $Cloudflared service uninstall 2>$null | Out-Null } catch {}
  & $Cloudflared service install
  Write-Host 'cloudflared service installed.' -ForegroundColor Green
}

function Install-NodeAutostart {
  param([string]$Root)
  $taskName = 'RuianMahjongServer'
  $ps1 = Join-Path $Root 'scripts\start-node-only.ps1'
  $arg = '-WindowStyle Hidden -ExecutionPolicy Bypass -File "' + $ps1 + '"'
  $action = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument $arg
  $trigger = New-ScheduledTaskTrigger -AtLogOn
  $settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable
  Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger -Settings $settings -Force | Out-Null
  Write-Host ('Scheduled task registered: ' + $taskName) -ForegroundColor Green
}

function Test-Hostname {
  param([string]$Value)
  if ([string]::IsNullOrWhiteSpace($Value)) { return $false }
  if ($Value -notlike '*.*') { return $false }
  if ($Value -match '\s') { return $false }
  return $true
}

Write-Host ''
Write-Host '========================================' -ForegroundColor Yellow
Write-Host ' Ruian Mahjong - Cloudflare Named Tunnel' -ForegroundColor Yellow
Write-Host '========================================' -ForegroundColor Yellow
Write-Host ''
Write-Host 'Requirement: domain DNS must be on Cloudflare.' -ForegroundColor Gray

$Cloudflared = Get-CloudflaredPath
Write-Host ('cloudflared: ' + $Cloudflared) -ForegroundColor Gray

Ensure-CloudflaredLogin -Cloudflared $Cloudflared -Dir $CloudflaredDir

if (-not $Hostname) {
  Write-Host ''
  $Hostname = Read-Host 'Enter hostname (e.g. mahjong.example.com)'
}
$Hostname = $Hostname.Trim().ToLower()
if (-not (Test-Hostname $Hostname)) {
  throw ('Invalid hostname: ' + $Hostname)
}

$tunnel = Get-OrCreateTunnel -Cloudflared $Cloudflared -Name $TunnelName
$credFile = Join-Path $CloudflaredDir ($tunnel.Id + '.json')
if (-not (Test-Path $credFile)) {
  throw ('Credentials file not found: ' + $credFile)
}

Write-Host ''
Write-Host '[3/4] Route DNS' -ForegroundColor Cyan
Write-Host ('    ' + $Hostname + ' -> tunnel ' + $tunnel.Name) -ForegroundColor Gray
& $Cloudflared tunnel route dns $TunnelName $Hostname
Write-Host '    DNS CNAME created.' -ForegroundColor Green

Write-Host ''
Write-Host '[4/4] Write config.yml' -ForegroundColor Cyan
Write-TunnelConfig -TunnelId $tunnel.Id -Hostname $Hostname -Port $Port -CredentialsFile $credFile -OutConfig $ConfigPath
Write-Host ('    ' + $ConfigPath) -ForegroundColor Green

$publicUrl = 'https://' + $Hostname
$meta = @{
  mode       = 'named'
  tunnelName = $TunnelName
  tunnelId   = $tunnel.Id
  hostname   = $Hostname
  port       = $Port
  publicUrl  = $publicUrl
} | ConvertTo-Json -Depth 3
Set-Content -LiteralPath $LocalMetaPath -Value $meta -Encoding UTF8

Write-Host ''
Write-Host '========================================' -ForegroundColor Green
Write-Host ' Done!' -ForegroundColor Green
Write-Host '========================================' -ForegroundColor Green
Write-Host ''
Write-Host ('Fixed URL: ' + $publicUrl) -ForegroundColor Green
Write-Host ''
Write-Host 'Next steps:' -ForegroundColor Cyan
Write-Host '  1. Run scripts\start-server.ps1 to start the game' -ForegroundColor White
Write-Host ('  2. Share ' + $publicUrl + ' with friends') -ForegroundColor White
Write-Host '  3. DNS may take 1-5 minutes to propagate' -ForegroundColor Gray
Write-Host ''

if ($InstallService) {
  Install-CloudflaredService -Cloudflared $Cloudflared
  Install-NodeAutostart -ProjectRoot $ProjectRoot
}

$publicUrl | Set-Clipboard
Write-Host 'URL copied to clipboard.' -ForegroundColor Gray
