@echo off
REM Build navi_shell with embedded hostparkinator_5000 (separate from build.bat).
REM Plants navi:hostparkinator_5000 tip+bin on first boot; mount with: mount navi:hostparkinator_5000

where node >nul 2>nul
if %errorlevel% neq 0 (
    echo Error: Node.js is not installed or not in PATH
    exit /b 1
)

echo ========================================
echo Building Navi Shell + hostparkinator_5000 embed
echo ========================================

if exist "navi_shell_host.exe" del "navi_shell_host.exe"

if not exist "node_modules" (
    echo Installing dependencies...
    call npm install
    if %errorlevel% neq 0 exit /b 1
)

echo Running build_host.js...
call node build_host.js
if %errorlevel% neq 0 (
    echo Error: build_host.js failed
    exit /b 1
)

if not exist "dist\navi_shell_host_localnavi.cjs" (
    echo Error: dist\navi_shell_host_localnavi.cjs was not created
    exit /b 1
)

echo.
echo Packaging navi_shell_host.exe...
call npx --yes @yao-pkg/pkg dist/navi_shell_host_localnavi.cjs -t node22-win-x64 -o navi_shell_host.exe
if %errorlevel% neq 0 exit /b 1

echo.
echo Stamping icon + metadata...
set "FAVICON=%~dp0favicon.ico"
if not exist "%FAVICON%" (
    echo Error: favicon not found: %FAVICON%
    exit /b 1
)
if exist "navi_shell_host.stamped.exe" del "navi_shell_host.stamped.exe"
call npx --yes resedit-cli navi_shell_host.exe navi_shell_host.stamped.exe --icon 1,"%FAVICON%" --product-name "Navi Shell (host)" --file-description "Navi Shell with hostparkinator_5000" --company-name "foobarch" --product-version "1.0.0.0" --file-version "1.0.0.0" --original-filename "navi_shell_host.exe"
if %errorlevel% neq 0 exit /b 1
move /Y "navi_shell_host.stamped.exe" "navi_shell_host.exe" >nul

echo.
echo ========================================
echo Host-mod build complete!
echo ========================================
echo.
echo Generated:
echo - navi_shell_host.exe
echo - dist/navi_shell_host.js
echo - dist/navi_shell_host_localnavi.cjs
echo.
echo Deploy beside hostparkinator_5000.sqlite, run once, then:
echo   mount navi:hostparkinator_5000
echo   hostparkinator_5000 start
echo.
