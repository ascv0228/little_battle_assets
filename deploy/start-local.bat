@echo off
setlocal
set "PROJECT_ROOT=%~dp0.."
for %%I in ("%PROJECT_ROOT%") do set "PROJECT_ROOT=%%~fI"
set "HOST=127.0.0.1"
set "PORT=5000"
if not exist "%PROJECT_ROOT%\atlas-credentials.env" if not exist "%PROJECT_ROOT%\.env" (
  echo Missing MongoDB environment file. Create .env or atlas-credentials.env first.
  exit /b 1
)

start "Little Battle API" /D "%PROJECT_ROOT%" cmd /k npm start

echo Local Little Battle application launch requested: http://127.0.0.1:5000/
echo Health check: http://127.0.0.1:5000/health
echo For public access, run deploy\start-tunnel.bat.
endlocal
exit /b 0