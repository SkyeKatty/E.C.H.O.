@echo off
start controler.bat
timeout /t 5 /nobreak > nul
start memory.bat
timeout /t 5 /nobreak > nul
start llm.bat
timeout /t 10 /nobreak > nul
start discord.bat
start timer.bat
start webserv.bat