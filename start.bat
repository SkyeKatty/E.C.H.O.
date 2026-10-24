@echo off
cd /d "%~dp0"
rem After clone or pull, run setup.bat once if deps changed.
start controler.bat
start "ECHO Fish TTS" cmd /k "%~dp0fishtts_server.bat"
start "ECHO Whisper" cmd /k "%~dp0whisper_server.bat"
timeout /t 5 /nobreak > nul
start memory.bat
timeout /t 5 /nobreak > nul
start llm.bat
timeout /t 10 /nobreak > nul
start discord.bat
start timer.bat
timeout /t 10 /nobreak > nul
start stt.bat
timeout /t 5 /nobreak > nul
start tts.bat
start webserv.bat