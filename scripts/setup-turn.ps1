#Requires -Version 5.1
param(
  [string]$MeteredApp = '',
  [string]$MeteredApiKey = '',
  [string]$MeteredTurnUrl = ''
)

$ErrorActionPreference = 'Stop'
$ProjectRoot = Split-Path -Parent $PSScriptRoot
$DeployDir = Join-Path $ProjectRoot 'deploy'
$TargetPath = Join-Path $DeployDir 'turn.local.json'

if (-not (Test-Path $DeployDir)) {
  New-Item -ItemType Directory -Path $DeployDir | Out-Null
}

if (-not $MeteredTurnUrl) {
  if (-not $MeteredApp) {
    $MeteredApp = Read-Host 'Metered app name, for example abc123 in https://abc123.metered.live'
  }
  if (-not $MeteredApiKey) {
    $MeteredApiKey = Read-Host 'Metered API key'
  }
  if ($MeteredApp -and $MeteredApiKey) {
    $MeteredTurnUrl = "https://$MeteredApp.metered.live/api/v1/turn/credentials?apiKey=$MeteredApiKey"
  }
}

if (-not $MeteredTurnUrl) {
  throw 'No TURN config was provided.'
}

$config = [ordered]@{
  meteredTurnUrl = $MeteredTurnUrl
  iceServers = @()
}

$json = $config | ConvertTo-Json -Depth 8
$utf8NoBom = New-Object System.Text.UTF8Encoding($false)
[System.IO.File]::WriteAllText($TargetPath, $json, $utf8NoBom)

Write-Host ''
Write-Host 'TURN config saved:' -ForegroundColor Green
Write-Host $TargetPath
Write-Host ''
Write-Host 'Restart the mahjong server to use TURN.'
