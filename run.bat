@echo off
setlocal enabledelayedexpansion

set NODE_VERSION=v26.3.0
set NODE_DIR=%~dp0.node
set NODE_EXE=%NODE_DIR%\node-windows\node.exe
set PATH=%NODE_DIR%\node-windows;%PATH%

echo Checking runtime environment...

:: 1. Download portable Node.js if it doesn't exist locally
if not exist "%NODE_EXE%" (
    echo Portable Node.js not found. Downloading %NODE_VERSION%...
    mkdir "%NODE_DIR%" 2>nul
    
    powershell -Command "Invoke-WebRequest -Uri 'https://nodejs.org/dist/%NODE_VERSION%/node-%NODE_VERSION%-win-x64.zip' -OutFile '%NODE_DIR%\node.zip'"
    
    echo Extracting files...
    powershell -Command "Expand-Archive -Path '%NODE_DIR%\node.zip' -DestinationPath '%NODE_DIR%\tmp' -Force"
    
    move "%NODE_DIR%\tmp\node-%NODE_VERSION%-win-x64" "%NODE_DIR%\node-windows"
    
    del "%NODE_DIR%\node.zip"
    rmdir /s /q "%NODE_DIR%\tmp"
    
    echo Runtime environment ready.
)

:: 2. Check if node_modules exists, run install if missing
if not exist "%~dp0node_modules" (
    echo Initializing first-time project setup...
    call "%NODE_DIR%\node-windows\npm.cmd" install
)

:: 3. ALWAYS verify browser binaries (Playwright skips instantly if already cached)
echo Verifying browser binaries...
call "%NODE_DIR%\node-windows\npx.cmd" playwright install chromium

:: 4. Execute the timesheet helper script and forward all parameters
echo Starting BambooHR Timesheet Helper...
call "%NODE_DIR%\node-windows\npm.cmd" run fill -- %*
pause