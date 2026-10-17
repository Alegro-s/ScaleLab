@echo off
chcp 65001 >nul
setlocal
cd /d "%~dp0"
set "PATH=%PATH%;C:\Program Files\Docker\Docker\resources\bin"
set PG_PORT=47313
set CORE_PORT=47312
set GW_PORT=47311
set WEB_PORT=47310
if not exist logs mkdir logs
set LOG=%~dp0logs\start.log
echo === МасштабЛаб === > "%LOG%"
echo.
echo  МасштабЛаб. Порты: интерфейс %WEB_PORT%, шлюз %GW_PORT%, ядро %CORE_PORT%, БД %PG_PORT%
echo  Это окно останется открытым. Не закрывайте его, пока идёт запуск.
echo.

echo [1/5] База данных PostgreSQL...
docker info >nul 2>&1
if not errorlevel 1 goto dockerok
echo       Docker Desktop не запущен, запускаю. Подождите до 2 минут...
start "" "C:\Program Files\Docker\Docker\Docker Desktop.exe"
set /a w=0
:waitdocker
timeout /t 5 >nul
docker info >nul 2>&1
if not errorlevel 1 goto dockerok
set /a w+=1
if %w% LSS 30 goto waitdocker
echo Docker не запустился. Откройте Docker Desktop вручную и запустите start.bat снова.
pause
exit /b 1
:dockerok
docker rm -f scalelab-pg >nul 2>&1
docker rm -f masshtablab-pg >nul 2>&1
docker run -d --name masshtablab-pg --restart unless-stopped -e POSTGRES_DB=masshtablab -e POSTGRES_USER=masshtablab -e POSTGRES_PASSWORD=masshtablab -p 127.0.0.1:%PG_PORT%:5432 -v masshtablab_pg:/var/lib/postgresql/data postgres:16-alpine >> "%LOG%" 2>&1
if errorlevel 1 (
  echo Не удалось создать базу, см. logs\start.log
  pause
  exit /b 1
)
set /a n=0
:waitpg
timeout /t 2 >nul
docker exec masshtablab-pg pg_isready -U masshtablab -d masshtablab >nul 2>&1
if not errorlevel 1 goto pgready
set /a n+=1
if %n% LSS 30 goto waitpg
:pgready
echo       готово

echo [2/5] Python-окружение для ядра (один раз, 2-4 минуты)...
if not exist ".venv\Scripts\python.exe" ( py -3.12 -m venv .venv >> "%LOG%" 2>&1 )
if not exist ".venv\.ok" (
  if exist wheels ( ".venv\Scripts\python.exe" -m pip install -q --no-index --find-links wheels -r wheels\req.txt opencv-python-headless colorama >> "%LOG%" 2>&1 ) else ( ".venv\Scripts\python.exe" -m pip install -q -r services\core\requirements.txt >> "%LOG%" 2>&1 )
  if errorlevel 1 ( echo Ошибка pip, см. logs\start.log & pause & exit /b 1 )
  echo ok> ".venv\.ok"
)
echo       готово

echo [3/5] Node-зависимости (один раз)...
if not exist "node_modules\@masshtablab\shared" (
  call npm install --no-audit --no-fund >> "%LOG%" 2>&1
  if errorlevel 1 ( echo Ошибка npm, см. logs\start.log & pause & exit /b 1 )
)
echo       готово

if not exist localdata mkdir localdata

echo [4/5] Запуск ядра и шлюза...
start "MasshtabLab core" /min cmd /c "set DATA_DIR=%~dp0localdata& cd /d services\core & ..\..\.venv\Scripts\python.exe -m uvicorn app.main:app --host 127.0.0.1 --port %CORE_PORT% > ..\..\logs\core.log 2>&1"
start "MasshtabLab gateway" /min cmd /c "set DATABASE_URL=postgres://masshtablab:masshtablab@localhost:%PG_PORT%/masshtablab& set NOSQL=memory& set CORE_URL=http://127.0.0.1:%CORE_PORT%& set DATA_DIR=%~dp0localdata& set DEMO_DIR=%~dp0data\demo& set MIGRATIONS_DIR=%~dp0db\postgres& set JWT_SECRET=local-dev-secret-change& set PORT=%GW_PORT%& cd /d services\gateway & ..\..\node_modules\.bin\tsx.cmd src\server.ts > ..\..\logs\gateway.log 2>&1"

echo [5/5] Запуск интерфейса...
start "MasshtabLab web" /min cmd /c "set VITE_API_PROXY=http://127.0.0.1:%GW_PORT%& cd /d web & ..\node_modules\.bin\vite.cmd --host 127.0.0.1 --port %WEB_PORT% --strictPort > ..\logs\web.log 2>&1"

set /a t=0
:waitweb
timeout /t 2 >nul
powershell -NoProfile -Command "try{(Invoke-WebRequest -UseBasicParsing http://127.0.0.1:%WEB_PORT%/api/health -TimeoutSec 3).StatusCode}catch{exit 1}" >nul 2>&1
if not errorlevel 1 goto up
set /a t+=1
if %t% LSS 30 goto waitweb
echo.
echo  Не запустилось за минуту. Смотрите logs\gateway.log, logs\core.log, logs\web.log
echo  Чаще всего порт занят: проверьте netstat -ano ^| findstr :%WEB_PORT%
pause
exit /b 1
:up
start http://localhost:%WEB_PORT%
echo.
echo  ============================================
echo   Готово: http://localhost:%WEB_PORT%
echo   Остановка: stop.bat
echo  ============================================
echo.
echo  Окно можно закрыть, сервисы работают в фоне (свёрнутые окна MasshtabLab).
pause
