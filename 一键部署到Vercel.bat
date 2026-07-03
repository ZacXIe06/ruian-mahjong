@echo off
cd /d "%~dp0"
powershell -ExecutionPolicy Bypass -File ".\scripts\deploy-vercel.ps1"
pause
