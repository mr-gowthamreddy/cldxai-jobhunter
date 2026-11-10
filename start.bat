@echo off
setlocal EnableExtensions
title Career-Ops Platform
cd /d "%~dp0"

echo.
echo  ==============================================
echo    Career-Ops Platform - starting up
echo  ==============================================
echo.

where node >nul 2>nul
if errorlevel 1 (
  echo  [ERROR] Node.js was not found.
  echo          Install Node.js 22 LTS or newer from https://nodejs.org and run start.bat again.
  pause
  exit /b 1
)
for /f "tokens=1 delims=." %%v in ('node -p "process.versions.node"') do set NODE_MAJOR=%%v
if %NODE_MAJOR% LSS 22 (
  echo  [ERROR] Node.js 22 or newer is required. You have:
  node -v
  pause
  exit /b 1
)

rem Core career-ops dependencies (job providers). Skip the large browser download.
if not exist "node_modules\js-yaml" (
  echo  Installing core dependencies...
  set PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1
  call npm install --no-audit --no-fund
  if errorlevel 1 goto :fail
)

cd platform
if not exist "node_modules\express" (
  echo  Installing platform dependencies...
  call npm install --no-audit --no-fund
  if errorlevel 1 goto :fail
)

echo  Preparing the database...
call node scripts\setup.mjs
if errorlevel 1 goto :fail

echo.
echo  Starting the web server and the job scheduler...
echo  The app opens in your browser at http://localhost:4300  (close this window or press Ctrl+C to stop)
echo.
call node scripts\start-all.mjs
goto :eof

:fail
echo.
echo  [ERROR] Setup failed. See the messages above, and platform\README.md - Troubleshooting.
pause
exit /b 1
