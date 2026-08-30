@echo off
setlocal

set "PROJECT_DIR=%~dp0"
set "BACKEND_DIR=%PROJECT_DIR%backend"

if not exist "%BACKEND_DIR%\.clasp.json" (
  echo ERROR: backend\.clasp.json not found.
  echo Run this file from the rdf-billing-app project root.
  exit /b 1
)

where clasp >nul 2>nul
if errorlevel 1 (
  echo ERROR: clasp was not found in PATH.
  echo Install or run it with npx, then deploy from the backend folder:
  echo   cd /d "%BACKEND_DIR%"
  echo   npx @google/clasp push
  echo   npx @google/clasp deploy --description "backend update"
  exit /b 1
)

cd /d "%BACKEND_DIR%"
echo Pushing Google Apps Script backend from:
echo %CD%
echo.
clasp push
if errorlevel 1 exit /b %errorlevel%

echo.
echo Push complete. To create a new deployment version, run:
echo   clasp deploy --description "backend update"

