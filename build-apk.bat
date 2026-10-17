@echo off
chcp 65001 >nul
cd /d "%~dp0mobile"
if not exist android call "%~dp0mobile\tools\setup.bat"
if not exist android goto :eof
call "%~dp0mobile\tools\build.bat" http://72.56.244.26:47310
