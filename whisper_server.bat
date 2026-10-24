@echo off
cd /d "%~dp0"
call npx pnpm@9.15.0 dev:server:whisper
echo.
echo Whisper server stopped (exit code %errorlevel%).
pause
exit /b %errorlevel%
