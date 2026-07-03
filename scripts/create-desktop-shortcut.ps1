$ErrorActionPreference = 'Stop'
$ProjectRoot = Split-Path -Parent $PSScriptRoot
$Desktop = [Environment]::GetFolderPath('Desktop')
$ShortcutPath = Join-Path $Desktop '瑞安麻将一键启动.lnk'
$Target = Join-Path $ProjectRoot '一键启动瑞安麻将.bat'
$Icon = Join-Path $ProjectRoot 'assets\red-zhong.ico'

if (-not (Test-Path $Target)) {
  throw "Start file not found: $Target"
}

$shell = New-Object -ComObject WScript.Shell
$shortcut = $shell.CreateShortcut($ShortcutPath)
$shortcut.TargetPath = $Target
$shortcut.WorkingDirectory = $ProjectRoot
$shortcut.WindowStyle = 1
if (Test-Path $Icon) {
  $shortcut.IconLocation = $Icon
}
$shortcut.Description = 'Start Ruian Mahjong server and public tunnel'
$shortcut.Save()

Write-Host "Desktop shortcut created:" -ForegroundColor Green
Write-Host $ShortcutPath
