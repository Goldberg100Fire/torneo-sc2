@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo.
echo === Subir torneo-sc2 a GitHub ===
echo.
where gh >nul 2>&1 || (
  echo Instala GitHub CLI: winget install GitHub.cli
  pause
  exit /b 1
)
gh auth status >nul 2>&1 || (
  echo Primero inicia sesion en GitHub:
  gh auth login
  echo.
)
echo Creando repositorio publico torneo-sc2 en tu cuenta...
gh repo create torneo-sc2 --public --source=. --remote=origin --push
if errorlevel 1 (
  echo.
  echo Si el repo ya existe, prueba solo:
  echo   git remote add origin https://github.com/TU_USUARIO/torneo-sc2.git
  echo   git push -u origin main
)
echo.
pause
