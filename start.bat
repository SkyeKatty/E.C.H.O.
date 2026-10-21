@echo off
start controler.bat
timeout /t 5 /nobreak > nul
start memory.bat
timeout /t 5 /nobreak > nul
start llm.bat
start webserv.bat