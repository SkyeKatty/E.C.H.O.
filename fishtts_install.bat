@echo off
cd /d "%~dp0"
echo Fish-only install — for full stack use setup.bat
call npx pnpm@9.15.0 install:server:fish
echo.
pause
exit /b %errorlevel%
