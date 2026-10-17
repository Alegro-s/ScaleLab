@echo off
set "JDK="
for /f "usebackq delims=" %%J in (`powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0find_jdk.ps1"`) do set "JDK=%%J"
if "%JDK%"=="" (
  echo.
  echo  Не найдена подходящая Java. У вас установлена Java 25, а Gradle в Flutter работает с Java 17-24.
  echo  Установите JDK 21, например командой:
  echo     winget install EclipseAdoptium.Temurin.21.JDK
  echo  затем запустите скрипт снова.
  exit /b 1
)
echo  Java для сборки: %JDK%
set "JAVA_HOME=%JDK%"
set "PATH=%JDK%\bin;%PATH%"
call flutter config --jdk-dir="%JDK%" >nul 2>&1
exit /b 0
