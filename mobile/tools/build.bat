@echo off
chcp 65001 >nul
cd /d "%~dp0.."
set API=%1
if "%API%"=="" set API=http://72.56.244.26:47310
echo.
echo  МасштабЛаб Mobile: сборка APK
echo  Сервер: %API%
echo.
call "%~dp0find_flutter.bat"
if errorlevel 1 goto end
call "%~dp0find_jdk.bat"
if errorlevel 1 goto end
if not exist android (
  echo  Нет папки android. Сначала запустите setup.bat
  goto end
)
if exist android-overrides\AndroidManifest.xml copy /Y android-overrides\AndroidManifest.xml android\app\src\main\AndroidManifest.xml >nul
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0fix_android.ps1"
if errorlevel 1 goto fail
call flutter build apk --release --dart-define=API_URL=%API%
if errorlevel 1 goto fail
copy /Y build\app\outputs\flutter-apk\app-release.apk "%~dp0..\MasshtabLab.apk" >nul
echo.
echo  ============================================
echo   Готово: %~dp0..\MasshtabLab.apk
echo   Скопируйте файл на телефон и установите.
echo  ============================================
start "" explorer /select,"%~dp0..\MasshtabLab.apk"
goto end
:fail
echo.
echo  Сборка не удалась, см. ошибки выше.
:end
echo.
pause
