@echo off
chcp 65001 >nul
cd /d "%~dp0"
where git >nul 2>&1
if errorlevel 1 ( echo  Git не найден. Установите Git for Windows. & goto end )
echo.
echo  Публикация в https://github.com/Alegro-s/ScaleLab.git
echo.
if not exist .git git init
git rm -r -q --cached . >nul 2>&1
git add .
echo  Файлов в коммите:
git ls-files | find /c /v ""
git rev-parse --verify HEAD >nul 2>&1
if errorlevel 1 (
  git commit -m "МасштабЛаб: первая версия"
) else (
  git commit --amend -m "МасштабЛаб: первая версия"
)
git branch -M main
git remote remove origin >nul 2>&1
git remote add origin https://github.com/Alegro-s/ScaleLab.git
git push -u origin main
:end
echo.
pause
