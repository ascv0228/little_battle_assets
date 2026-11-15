@echo off
setlocal
taskkill /FI "WINDOWTITLE eq Little Battle API" /T /F >nul 2>nul
echo Local Little Battle processes stopped.
endlocal
