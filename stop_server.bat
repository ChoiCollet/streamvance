@echo off
cd /d "%~dp0"
echo Stopping Streamvance server on port 3000...
for /f "tokens=5" %%a in ('netstat -ano ^| findstr ":3000 " ^| findstr "LISTENING"') do (
    taskkill /f /pid %%a >nul 2>&1
    echo Terminated process %%a
)
echo Server stopped.
