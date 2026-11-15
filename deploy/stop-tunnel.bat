@echo off
setlocal
taskkill /FI "WINDOWTITLE eq Little Battle ngrok" /T /F >nul 2>nul
call "%~dp0stop-local.bat"
endlocal
