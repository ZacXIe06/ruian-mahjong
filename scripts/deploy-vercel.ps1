$ErrorActionPreference = 'Stop'

$ProjectRoot = Split-Path -Parent $PSScriptRoot
Set-Location $ProjectRoot

Write-Host 'Checking Vercel login...' -ForegroundColor Cyan
try {
  vercel whoami | Out-Null
} catch {
  Write-Host ''
  Write-Host 'Vercel is not logged in on this computer.' -ForegroundColor Yellow
  Write-Host 'Run: vercel login' -ForegroundColor Yellow
  Write-Host 'Then run this script again.' -ForegroundColor Yellow
  exit 1
}

Write-Host 'Pulling project settings...' -ForegroundColor Cyan
vercel pull --yes

Write-Host 'Deploying preview...' -ForegroundColor Cyan
vercel deploy --yes

