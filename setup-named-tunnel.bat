@echo off
cd /d "%~dp0"
echo.
echo  Cloudflare Named Tunnel Setup
echo  =============================
echo.
powershell -NoExit -ExecutionPolicy Bypass -File "%~dp0scripts\setup-named-tunnel.ps1"
pause
