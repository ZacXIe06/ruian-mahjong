@echo off
chcp 65001 >nul
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo 未检测到 Node.js，正在尝试自动安装 Node.js LTS...
  where winget >nul 2>nul
  if errorlevel 1 (
    echo 这台电脑没有 winget，无法自动安装 Node.js。
    echo 请先安装 Node.js LTS：https://nodejs.org/
    start https://nodejs.org/
    pause
    exit /b 1
  )

  winget install -e --id OpenJS.NodeJS.LTS --accept-source-agreements --accept-package-agreements
  if errorlevel 1 (
    echo Node.js 自动安装失败，请检查网络或权限后重试。
    pause
    exit /b 1
  )

  if exist "%ProgramFiles%\nodejs\node.exe" set "PATH=%ProgramFiles%\nodejs;%PATH%"
  if exist "%LocalAppData%\Programs\nodejs\node.exe" set "PATH=%LocalAppData%\Programs\nodejs;%PATH%"

  where node >nul 2>nul
  if errorlevel 1 (
    echo Node.js 已安装，但当前窗口还没有刷新到 node 命令。
    echo 请关闭这个窗口后重新双击“一键启动瑞安麻将.bat”。
    pause
    exit /b 1
  )
)

powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\start-server.ps1"
pause
