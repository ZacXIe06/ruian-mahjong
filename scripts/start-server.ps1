#Requires -Version 5.1
param(
  [int]$Port = 3000,
  [switch]$NamedTunnelOnly
)

$ErrorActionPreference = 'Stop'
$ProjectRoot = Split-Path -Parent $PSScriptRoot
$LogPath = Join-Path $ProjectRoot 'cloudflared-tunnel.log'
$LocalMetaPath = Join-Path $ProjectRoot 'deploy\tunnel.local.json'
$CloudflaredConfig = Join-Path $env:USERPROFILE '.cloudflared\config.yml'
$Node = (Get-Command node -ErrorAction Stop).Source

function Get-CloudflaredPath {
  $local = Join-Path $ProjectRoot 'tools\cloudflared.exe'
  if (Test-Path $local) { return $local }
  $cmd = Get-Command cloudflared -ErrorAction SilentlyContinue
  if ($cmd) { return $cmd.Source }
  $winget = Get-ChildItem -Path "$env:LOCALAPPDATA\Microsoft\WinGet\Packages" -Recurse -Filter cloudflared.exe -ErrorAction SilentlyContinue | Select-Object -First 1
  if ($winget) { return $winget.FullName }
  return $null
}

function Get-NamedTunnelInfo {
  if (Test-Path $LocalMetaPath) {
    try {
      $meta = Get-Content -LiteralPath $LocalMetaPath -Raw | ConvertFrom-Json
      if ($meta.mode -eq 'named' -and $meta.hostname) { return $meta }
    } catch {}
  }
  if (Test-Path $CloudflaredConfig) {
    $content = Get-Content -LiteralPath $CloudflaredConfig -Raw
    if ($content -match 'hostname:\s*(\S+)') {
      return [PSCustomObject]@{
        mode     = 'named'
        hostname = $Matches[1]
        port     = $Port
        publicUrl = "https://$($Matches[1])"
      }
    }
  }
  return $null
}

$Cloudflared = Get-CloudflaredPath
$NamedTunnel = Get-NamedTunnelInfo
$UseNamedTunnel = $NamedTunnel -and (Test-Path $CloudflaredConfig)

Write-Host 'Stopping old mahjong server and tunnel...' -ForegroundColor Cyan
Get-CimInstance Win32_Process -Filter "name = 'node.exe'" |
  Where-Object { $_.CommandLine -match 'server\.js' -and $_.CommandLine -like "*$ProjectRoot*" } |
  ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
Get-NetTCPConnection -LocalPort $Port -ErrorAction SilentlyContinue |
  Where-Object { $_.State -eq 'Listen' -and $_.OwningProcess } |
  ForEach-Object { Stop-Process -Id $_.OwningProcess -Force -ErrorAction SilentlyContinue }
Get-CimInstance Win32_Process -Filter "name = 'cloudflared.exe'" |
  ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }

if (Test-Path $LogPath) { Remove-Item -LiteralPath $LogPath -Force -ErrorAction SilentlyContinue }

Write-Host 'Starting local server...' -ForegroundColor Cyan
Start-Process -FilePath $Node -ArgumentList 'server.js' -WorkingDirectory $ProjectRoot -WindowStyle Hidden
Start-Sleep -Seconds 1

try {
  $status = (Invoke-WebRequest -UseBasicParsing "http://localhost:$Port" -TimeoutSec 8).StatusCode
  if ($status -ne 200) { throw "HTTP $status" }
} catch {
  throw "Local server failed to start: $($_.Exception.Message)"
}

if (-not $Cloudflared) {
  Write-Host ''
  Write-Host 'Local URL: http://localhost:' + $Port -ForegroundColor Green
  Write-Host 'cloudflared not found. LAN only.' -ForegroundColor Yellow
  Start-Process "http://localhost:$Port"
  exit 0
}

if ($NamedTunnelOnly -and -not $UseNamedTunnel) {
  throw 'Named tunnel not configured. Run scripts\setup-named-tunnel.ps1 first.'
}

$PublicUrl = $null

if ($UseNamedTunnel) {
  $tunnelName = if ($NamedTunnel.tunnelName) { $NamedTunnel.tunnelName } else { 'ruian-mahjong' }
  $PublicUrl = if ($NamedTunnel.publicUrl) { $NamedTunnel.publicUrl } else { "https://$($NamedTunnel.hostname)" }

  Write-Host 'Starting named tunnel (fixed domain)...' -ForegroundColor Cyan
  Write-Host "  -> $PublicUrl" -ForegroundColor Gray
  Start-Process -FilePath $Cloudflared -ArgumentList @(
    'tunnel', '--config', $CloudflaredConfig, 'run', $tunnelName,
    '--logfile', $LogPath,
    '--loglevel', 'info'
  ) -WorkingDirectory $ProjectRoot -WindowStyle Hidden

  Start-Sleep -Seconds 3
} else {
  Write-Host 'Starting quick tunnel (random URL)...' -ForegroundColor Yellow
  Write-Host 'Tip: run scripts\setup-named-tunnel.ps1 for a fixed domain.' -ForegroundColor Gray
  Start-Process -FilePath $Cloudflared -ArgumentList @(
    'tunnel',
    '--protocol', 'http2',
    '--url', "http://localhost:$Port",
    '--logfile', $LogPath,
    '--loglevel', 'info'
  ) -WorkingDirectory $ProjectRoot -WindowStyle Hidden

  for ($i = 0; $i -lt 30; $i++) {
    Start-Sleep -Seconds 1
    if (Test-Path $LogPath) {
      $PublicUrl = Get-Content -LiteralPath $LogPath -ErrorAction SilentlyContinue |
        Select-String -Pattern 'https://[-a-zA-Z0-9]+\.trycloudflare\.com' -AllMatches |
        ForEach-Object { $_.Matches.Value } |
        Select-Object -First 1
    }
    if ($PublicUrl) { break }
  }
}

Write-Host ''
Write-Host 'Local URL:' -ForegroundColor Green
Write-Host "http://localhost:$Port"

if ($PublicUrl) {
  $PublicUrl | Set-Clipboard
  Write-Host ''
  if ($UseNamedTunnel) {
    Write-Host 'Fixed public URL (copied):' -ForegroundColor Green
  } else {
    Write-Host 'Temporary public URL (copied):' -ForegroundColor Yellow
  }
  Write-Host $PublicUrl
  Start-Process $PublicUrl
} else {
  Write-Host ''
  Write-Host 'Could not confirm public URL. Check log:' -ForegroundColor Yellow
  Write-Host $LogPath
  Start-Process "http://localhost:$Port"
}

Write-Host ''
if ($UseNamedTunnel) {
  Write-Host 'Named tunnel running. This URL stays the same every time.' -ForegroundColor Gray
} else {
  Write-Host 'Keep running while playing. Quick tunnel URL changes on restart.' -ForegroundColor Gray
}
