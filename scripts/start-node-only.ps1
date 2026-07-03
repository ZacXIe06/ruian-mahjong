#Requires -Version 5.1
param([int]$Port = 3000)

$ErrorActionPreference = 'Stop'
$ProjectRoot = Split-Path -Parent $PSScriptRoot
$Node = (Get-Command node -ErrorAction Stop).Source

Get-CimInstance Win32_Process -Filter "name = 'node.exe'" |
  Where-Object { $_.CommandLine -match 'server\.js' -and $_.CommandLine -like "*$ProjectRoot*" } |
  ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }

Start-Process -FilePath $Node -ArgumentList 'server.js' -WorkingDirectory $ProjectRoot -WindowStyle Hidden
