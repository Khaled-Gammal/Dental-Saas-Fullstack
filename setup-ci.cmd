@echo off
REM Moves ci.yml into .github\workflows (GitHub Actions). Run once; this file then deletes itself.
cd /d "%~dp0"
if not exist ".github\workflows" mkdir ".github\workflows"
move /Y "ci.yml" ".github\workflows\ci.yml" >NUL
if exist ".github\workflows\ci.yml" (echo Done: .github\workflows\ci.yml is in place.) else (echo Something went wrong: ci.yml was not moved.)
pause
(goto) 2>NUL & del "%~f0"
