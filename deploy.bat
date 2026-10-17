@echo off
chcp 65001 >nul
cd /d "%~dp0"
set HOST=72.56.244.26
set USER=root
set TGZ=%TEMP%\masshtablab_deploy.tgz
echo.
echo  МасштабЛаб: выгрузка на сервер %USER%@%HOST%
echo  Пароль будет запрошен при подключении (один раз).
echo.
where ssh >nul 2>&1
if errorlevel 1 ( echo  Не найден ssh. Включите "Клиент OpenSSH" в компонентах Windows. & goto end )
where tar >nul 2>&1
if errorlevel 1 ( echo  Не найден tar. Нужна Windows 10 версии 1803 или новее. & goto end )
echo [1/2] Упаковка проекта...
tar -czf "%TGZ%" --exclude=node_modules --exclude=dist --exclude=.venv --exclude=localdata --exclude=logs --exclude=wheels --exclude=.git --exclude=data/runtime --exclude=data/datasets --exclude=mobile/build --exclude=mobile/.dart_tool --exclude=mobile/android --exclude=MasshtabLab.apk --exclude=*.zip --exclude=.env -C "%~dp0." .
if errorlevel 1 goto fail
echo [2/2] Передача и запуск на сервере...
ssh -o PreferredAuthentications=password -o PubkeyAuthentication=no -o StrictHostKeyChecking=accept-new %USER%@%HOST% "mkdir -p /opt/masshtablab && tar xzf - -C /opt/masshtablab && sed -i 's/\r$//' /opt/masshtablab/server/setup.sh && bash /opt/masshtablab/server/setup.sh" < "%TGZ%"
if errorlevel 1 goto fail
del "%TGZ%" >nul 2>&1
echo.
echo  ============================================
echo   Готово: http://%HOST%:47310
echo  ============================================
start http://%HOST%:47310
goto end
:fail
echo.
echo  Не удалось. Проверьте пароль, доступ по ssh и сообщения выше.
:end
echo.
pause
