@echo off
cd /d "%~dp0"
echo.
echo ECHO Fish TTS — run setup.bat once if this is your first time.
echo.
call npx pnpm@9.15.0 dev:server:fish
set ERR=%errorlevel%
echo.
echo Fish TTS stopped (exit code %ERR%).
pause
exit /b %ERR%
