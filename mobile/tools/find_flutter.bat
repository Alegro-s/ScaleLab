@echo off
where flutter >nul 2>&1
if not errorlevel 1 exit /b 0
if not exist "%~dp0flutter_path.txt" goto scan
set /p FP=<"%~dp0flutter_path.txt"
if exist "%FP%\bin\flutter.bat" set "PATH=%FP%\bin;%PATH%"
where flutter >nul 2>&1
if not errorlevel 1 exit /b 0
:scan
for %%D in ("%FLUTTER_ROOT%" "%USERPROFILE%\flutter" "%USERPROFILE%\develop\flutter" "%USERPROFILE%\source\flutter" "%USERPROFILE%\Downloads\flutter" "%USERPROFILE%\Desktop\flutter" "%USERPROFILE%\Documents\flutter" "%USERPROFILE%\fvm\default" "%LOCALAPPDATA%\flutter" "%LOCALAPPDATA%\Programs\flutter" "C:\flutter" "C:\src\flutter" "C:\dev\flutter" "C:\tools\flutter" "C:\Program Files\flutter" "D:\flutter" "D:\src\flutter" "D:\dev\flutter" "D:\Hak's\flutter") do (
  if exist "%%~D\bin\flutter.bat" ( set "PATH=%%~D\bin;%PATH%" & exit /b 0 )
)
for /f "delims=" %%F in ('dir /b /s "%USERPROFILE%\develop\flutter.bat" "%USERPROFILE%\source\flutter.bat" 2^>nul') do (
  for %%G in ("%%~dpF.") do ( set "PATH=%%~fG;%PATH%" & exit /b 0 )
)
echo.
echo  Flutter не найден автоматически.
echo  Введите папку, куда распакован Flutter SDK (внутри неё должна быть папка bin),
echo  например C:\src\flutter
set /p FP= Путь: 
if not exist "%FP%\bin\flutter.bat" goto bad
echo %FP%> "%~dp0flutter_path.txt"
set "PATH=%FP%\bin;%PATH%"
exit /b 0
:bad
echo  В "%FP%" нет bin\flutter.bat
exit /b 1
