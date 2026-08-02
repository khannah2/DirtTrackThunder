@echo off
cd /d "%~dp0"
echo Starting Dirt Track Thunder local server...
echo Open the URL shown below in your browser.
echo.
where py >nul 2>&1 && (
  py -m http.server 8765
  goto :eof
)
where python >nul 2>&1 && (
  python -m http.server 8765
  goto :eof
)
where npx >nul 2>&1 && (
  npx --yes serve -l 8765
  goto :eof
)
echo No Python or Node found. Install Python, then re-run play.bat
pause
