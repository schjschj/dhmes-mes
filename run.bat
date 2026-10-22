@echo off
chcp 65001 >nul
cd /d "%~dp0"
set MES_PORT=8000
"C:\Users\schjs\AppData\Local\Python\pythoncore-3.14-64\python.exe" server\app.py
pause
