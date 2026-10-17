@echo off
chcp 65001 >nul
set "PATH=%PATH%;C:\Program Files\Docker\Docker\resources\bin"
taskkill /fi "WINDOWTITLE eq MasshtabLab*" /t /f >nul 2>&1
taskkill /fi "WINDOWTITLE eq ScaleLab*" /t /f >nul 2>&1
docker stop masshtablab-pg >nul 2>&1
docker stop scalelab-pg >nul 2>&1
echo МасштабЛаб остановлен.
pause
