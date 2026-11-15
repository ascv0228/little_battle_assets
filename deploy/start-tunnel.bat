@echo off
setlocal
set "PROJECT_ROOT=%~dp0.."
for %%I in ("%PROJECT_ROOT%") do set "PROJECT_ROOT=%%~fI"
set "NGROK_EXE=D:\Tool\ngrok\ngrok.exe"

if not exist "%NGROK_EXE%" (
  echo ngrok not found: %NGROK_EXE%
  exit /b 1
)
"%NGROK_EXE%" config check
if errorlevel 1 exit /b 1

call "%PROJECT_ROOT%\deploy\start-local.bat"
if errorlevel 1 exit /b 1

set /a attempts=0
:wait_health
curl.exe --silent --fail --max-time 2 http://127.0.0.1:5000/health >nul 2>nul
if not errorlevel 1 goto start_tunnel
set /a attempts+=1
if %attempts% GEQ 20 goto service_not_ready
timeout /t 1 /nobreak >nul
goto wait_health

:start_tunnel
start "Little Battle ngrok" "%NGROK_EXE%" http --domain=bee-content-finch.ngrok-free.app 5000
echo Public URL: https://bee-content-finch.ngrok-free.app
echo Health check: https://bee-content-finch.ngrok-free.app/health
endlocal
exit /b 0

:service_not_ready
echo Local health check failed. Check the API window and MongoDB before opening the ngrok tunnel.
exit /b 1
