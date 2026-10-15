@echo off
setlocal
set "FOOBARCH_HOST=https://foobarch.net"
cd /d "%~dp0..\.."
node "C_devops\identity\_migrate_park_method.mjs" %*
endlocal
