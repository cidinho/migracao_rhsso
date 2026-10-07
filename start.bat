@echo off
rem Sobe o backend (NestJS) e o frontend (Nuxt), cada um em sua janela.
rem   start.bat         desenvolvimento, com recarga automatica
rem   start.bat prod    build e execucao em producao
rem Para encerrar, feche as janelas (ou Ctrl+C em cada uma).
setlocal
chcp 65001 >nul
cd /d "%~dp0"

set "MODE=%~1"
if "%MODE%"=="" set "MODE=dev"
if /i not "%MODE%"=="dev" if /i not "%MODE%"=="prod" (
  echo Uso: %~nx0 [dev^|prod]
  exit /b 1
)

where node >nul 2>nul || (echo Node.js não encontrado no PATH. & exit /b 1)
where pnpm >nul 2>nul || (echo pnpm não encontrado. Instale com: npm install -g pnpm@9 ^(ou corepack enable^) & exit /b 1)
if not exist backend\.env echo Aviso: backend\.env não existe. Copie backend\.env.example e preencha ^(veja o README^).

if not exist backend\node_modules (
  pushd backend
  call npm install
  if errorlevel 1 exit /b 1
  popd
)
if not exist frontend\node_modules (
  pushd frontend
  call pnpm install
  if errorlevel 1 exit /b 1
  popd
)

if /i "%MODE%"=="prod" goto prod

start "Backend - Importador RH-SSO" /d "%~dp0backend" cmd /k npm run start:dev
start "Frontend - Importador RH-SSO" /d "%~dp0frontend" cmd /k pnpm dev
goto done

:prod
pushd backend
call npm run build
if errorlevel 1 exit /b 1
popd
pushd frontend
call pnpm build
if errorlevel 1 exit /b 1
popd

start "Backend - Importador RH-SSO" /d "%~dp0backend" cmd /k npm run start:prod
rem Em producao o Nuxt nao le o .env sozinho.
if exist frontend\.env (
  start "Frontend - Importador RH-SSO" /d "%~dp0frontend" cmd /k node --env-file=.env .output/server/index.mjs
) else (
  start "Frontend - Importador RH-SSO" /d "%~dp0frontend" cmd /k node .output/server/index.mjs
)

:done
echo Backend: http://127.0.0.1:3001/api  -  Frontend: http://localhost:3000 (portas padrão)
echo Feche as janelas do backend e do frontend para encerrar.
