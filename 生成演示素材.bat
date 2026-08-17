@echo off
chcp 65001 >nul
title AutoVideoEditor - Demo Assets
cd /d "%~dp0"

echo.
echo  Generating demo assets...
echo   - 12 photos + 6 clips  (samples/input)
echo   - 10 generated tracks + real built-in music  (music/)
echo.

node samples/make_samples.js
node samples/make_music.js
node samples/download_music.js

echo.
echo  Done.
pause
