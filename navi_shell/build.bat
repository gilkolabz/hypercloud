@echo off
REM Build script for the Node-only Navi Shell on Windows
REM Produces browser bundle, navi_shell.exe (win-x64), and navi_shell-linux-x64
REM (cross-pkg from Windows; no Linux icon stamp — ELF has no PE icon resource)

REM Check for Node.js
where node >nul 2>nul
if %errorlevel% neq 0 (
    echo Error: Node.js is not installed or not in PATH
    echo Please install Node.js from https://nodejs.org/
    exit /b 1
)

echo ========================================
echo Building Navi Shell (Complete Rebuild)
echo ========================================

REM Clean previous builds to ensure fresh start
echo Cleaning previous builds...
if exist "navi_shell.exe" del "navi_shell.exe"
if exist "navi_shell-linux-x64" del "navi_shell-linux-x64"

echo.
echo Step 1: Building browser bundle + localnavi package input...

REM Ensure dependencies
if not exist "node_modules" (
    echo Installing dependencies...
    call npm install
    if %errorlevel% neq 0 (
        echo Error: Failed to install npm dependencies
        exit /b 1
    )
)

REM Always rebuild to ensure latest TypeScript changes
echo Running npm run build...
call npm run build
if %errorlevel% neq 0 (
    echo Error: Failed to build navi_shell
    exit /b 1
)

REM Verify that the required file was created
if not exist "dist\navi_shell_localnavi.cjs" (
    echo Error: dist/navi_shell_localnavi.cjs was not created
    echo This file is required for packaging navi_shell.exe
    exit /b 1
)

echo.
echo Step 2: Packaging navi_shell.exe ^(Node 22 / @yao-pkg/pkg / win-x64^)...
REM vercel/pkg only goes to node18; @yao-pkg/pkg supports node22/node24 (needed for node:sqlite).
REM Prefer node22 LTS over node23 (odd/non-LTS). Build host should be Node ^>=22.
call npx --yes @yao-pkg/pkg dist/navi_shell_localnavi.cjs -t node22-win-x64 -o navi_shell.exe
if %errorlevel% neq 0 (
    echo Error: Failed to package navi_shell.exe
    echo Hint: install/use Node.js 22+ on the build machine, then: npm install
    exit /b 1
)

if not exist "navi_shell.exe" (
    echo Error: navi_shell.exe was not created
    exit /b 1
)

echo.
echo Step 3: Stamping Windows icon + metadata ^(resedit^)...
set "FAVICON=%~dp0favicon.ico"
if not exist "%FAVICON%" (
    echo Error: favicon not found: %FAVICON%
    exit /b 1
)
REM pkg leaves the Node binary icon; resedit is the supported post-process path.
if exist "navi_shell.stamped.exe" del "navi_shell.stamped.exe"
call npx --yes resedit-cli navi_shell.exe navi_shell.stamped.exe --icon 1,"%FAVICON%" --product-name "Navi Shell" --file-description "Navi Shell" --company-name "foobarch" --product-version "1.0.0.0" --file-version "1.0.0.0" --original-filename "navi_shell.exe"
if %errorlevel% neq 0 (
    echo Error: Failed to stamp navi_shell.exe icon/metadata
    exit /b 1
)
move /Y "navi_shell.stamped.exe" "navi_shell.exe" >nul
if %errorlevel% neq 0 (
    echo Error: Failed to replace navi_shell.exe with stamped binary
    exit /b 1
)

echo.
echo Step 4: Packaging navi_shell-linux-x64 ^(cross-pkg node22-linux-x64^)...
REM No favicon stamp: Linux ELF binaries do not carry a Windows-style icon resource.
REM Desktop icons use a separate .desktop + PNG if you want a GUI launcher.
REM --public: avoid Windows-host bytecode cache (V8 rejects cross-pkg on Linux).
call npx --yes @yao-pkg/pkg dist/navi_shell_localnavi.cjs -t node22-linux-x64 -o navi_shell-linux-x64 --public --public-packages "*"
if %errorlevel% neq 0 (
    echo Error: Failed to package navi_shell-linux-x64
    exit /b 1
)

if not exist "navi_shell-linux-x64" (
    echo Error: navi_shell-linux-x64 was not created
    exit /b 1
)

echo.
echo ========================================
echo Build complete!
echo ========================================
echo.
echo Generated files:
echo - navi_shell.exe               ^(Windows Node-only localnavi shell^)
echo - navi_shell-linux-x64         ^(Linux x64 localnavi shell; no embedded icon^)
echo - dist/navi_shell.js           ^(browser bundle^)
echo - dist/navi_shell_localnavi.cjs   ^(pkg input^)
echo.
echo To run the localnavi shell:
echo   .\navi_shell.exe
echo User data: %%USERPROFILE%%\.navi_shell
echo.
echo Note: Changes to src/index.ts are picked up after re-running this script.
echo.
