@echo off
setlocal
set "PROJECT_ROOT=%~dp0.."
for %%I in ("%PROJECT_ROOT%") do set "PROJECT_ROOT=%%~fI"
set "NGINX_ROOT=D:\Tool\nginx-1.31.8"

if not exist "%NGINX_ROOT%\nginx.exe" (
  echo Nginx not found: %NGINX_ROOT%\nginx.exe
  exit /b 1
)
if not exist "%PROJECT_ROOT%\atlas-credentials.env" if not exist "%PROJECT_ROOT%\.env" (
  echo Missing MongoDB environment file. Create .env or atlas-credentials.env first.
  exit /b 1
)

"%NGINX_ROOT%\nginx.exe" -t -p "%NGINX_ROOT%/" -c "%PROJECT_ROOT%\deploy\nginx.local.conf"
if errorlevel 1 exit /b 1

start "Little Battle API" /D "%PROJECT_ROOT%" cmd /k npm start
timeout /t 2 /nobreak >nul
"%NGINX_ROOT%\nginx.exe" -p "%NGINX_ROOT%/" -c "%PROJECT_ROOT%\deploy\nginx.local.conf"
if errorlevel 1 (
  echo Nginx failed to start. Check %NGINX_ROOT%\logs\little-battle-local-error.log
  exit /b 1
)

echo Local Little Battle proxy started: http://127.0.0.1:5000/
echo Health check: http://127.0.0.1:5000/health
echo For public access, run deploy\start-tunnel.bat.
endlocal