@echo off
cd /d "%~dp0"
echo ========================================================
echo   Streamvance Local Music Server
echo ========================================================
echo.

python -c "import urllib.request; urllib.request.urlopen('http://localhost:3000', timeout=1)" >nul 2>&1
if %errorlevel% equ 0 (
    echo [INFO] Server is already running on http://localhost:3000
    echo Opening browser...
    start http://localhost:3000
    timeout /t 2 >nul
    exit /b
)

echo Starting Python server on port 3000...
start "" cmd /c "timeout /t 2 >nul && start http://localhost:3000"
python server.py
