@echo off
cd /d "%~dp0"
if not exist logs mkdir logs

echo.
echo  ECHO setup — install prerequisites (run after clone or git pull)
echo.

set ERR=0

echo ===== [1/4] Node workspace (pnpm install) =====
call npx pnpm@9.15.0 install
if errorlevel 1 set ERR=1

echo.
echo ===== [2/4] Whisper STT server Python deps =====
call npx pnpm@9.15.0 install:server:whisper
if errorlevel 1 set ERR=1

echo.
echo ===== [3/4] Fish Speech TTS (clone + pip — can take several minutes) =====
call npx pnpm@9.15.0 install:server:fish
if errorlevel 1 set ERR=1

echo.
echo ===== [4/4] Memory module embeddings Python deps =====
call npx pnpm@9.15.0 install:memory
if errorlevel 1 set ERR=1

echo.
if %ERR% neq 0 (
  echo Setup finished with errors ^(exit %ERR%^).
) else (
  echo Setup finished OK. You can run start.bat
)
echo.
pause
exit /b %ERR%
