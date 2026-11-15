@echo off
setlocal
set "PROJECT_ROOT=%~dp0.."
for %%I in ("%PROJECT_ROOT%") do set "PROJECT_ROOT=%%~fI"
set "NGINX_ROOT=D:\Tool\nginx-1.31.8"
set "NGINX_CONFIG=%PROJECT_ROOT%\deploy\nginx.public.conf"

if not exist "%NGINX_CONFIG%" (
  echo Copy nginx.public.conf.example to nginx.public.conf, then set your domain and TLS paths.
  exit /b 1
)
if not exist "%PROJECT_ROOT%\atlas-credentials.env" if not exist "%PROJECT_ROOT%\.env" (
  echo Missing MongoDB environment file. Create .env or atlas-credentials.env first.
  exit /b 1
)

"%NGINX_ROOT%\nginx.exe" -t -p "%NGINX_ROOT%/" -c "%NGINX_CONFIG%"
if errorlevel 1 exit /b 1

start "Little Battle API" /D "%PROJECT_ROOT%" cmd /k npm start
timeout /t 2 /nobreak >nul
"%NGINX_ROOT%\nginx.exe" -p "%NGINX_ROOT%/" -c "%NGINX_CONFIG%"
if errorlevel 1 (
  echo Nginx failed to start. Check %NGINX_ROOT%\logs\little-battle-public-error.log
  exit /b 1
)

echo Public HTTPS proxy started. Verify https://YOUR_DOMAIN/health
endlocal
