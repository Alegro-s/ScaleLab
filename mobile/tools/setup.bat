@echo off
chcp 65001 >nul
cd /d "%~dp0.."
echo.
echo  МасштабЛаб Mobile: подготовка проекта (один раз)
echo.
call "%~dp0find_flutter.bat"
if errorlevel 1 goto end
call "%~dp0find_jdk.bat"
if errorlevel 1 goto end
echo [1/3] flutter create...
call flutter create --platforms=android --org ru.masshtablab --project-name masshtablab_mobile .
if errorlevel 1 goto fail
echo [2/3] Настройка манифеста (HTTP без шифрования)...
copy /Y android-overrides\AndroidManifest.xml android\app\src\main\AndroidManifest.xml >nul
if errorlevel 1 goto fail
echo [3/3] flutter pub get...
call flutter pub get
if errorlevel 1 goto fail
echo.
echo  ============================================
echo   Готово. Теперь запустите build.bat
echo  ============================================
goto end
:fail
echo.
echo  Ошибка, см. сообщения выше. Проверьте: flutter doctor
:end
echo.
pause
