@echo off
chcp 65001 >nul
title AutoVideoEditor - Web UI
cd /d "%~dp0"

echo.
echo  ============================================
echo   AutoVideoEditor  -  Web UI
echo   Starting... your browser will open shortly.
echo   Keep this window open while using the tool.
echo   Close this window to stop the server.
echo  ============================================
echo.

node web/server.js

echo.
echo  Server stopped.
pause
