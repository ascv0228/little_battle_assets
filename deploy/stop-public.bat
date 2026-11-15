@echo off
setlocal
set "PROJECT_ROOT=%~dp0.."
for %%I in ("%PROJECT_ROOT%") do set "PROJECT_ROOT=%%~fI"
set "NGINX_ROOT=D:\Tool\nginx-1.31.8"
if exist "%NGINX_ROOT%\logs\little-battle-public.pid" (
  "%NGINX_ROOT%\nginx.exe" -p "%NGINX_ROOT%/" -c "%PROJECT_ROOT%\deploy\nginx.public.conf" -s quit
)
taskkill /FI "WINDOWTITLE eq Little Battle API" /T /F >nul 2>nul
echo Public Little Battle processes stopped.
endlocal
