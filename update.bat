@echo off
rem FableChat: fetch the new version and rebuild what changed. Double-click it.
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo FableChat needs Node.js 22.18 or newer, and it isn't installed.
  echo Get it from https://nodejs.org ^(the "LTS" download is fine^), then run this again.
  echo.
  pause
  exit /b 1
)

node scripts\update.mjs %*
echo.
pause
