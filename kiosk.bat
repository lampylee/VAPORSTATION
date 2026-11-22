@echo off
rem Vaporstation gig launcher: local server + Chrome in kiosk mode.
rem  - Own Chrome profile (%LOCALAPPDATA%\Vaporstation\chrome), so none of these flags touch your normal Chrome.
rem  - Audio starts without a click; the microphone / line-in prompt is accepted automatically (this profile only).
rem  - Fullscreen, no panel, no cursor. Press H to show the panel, Alt+F4 to quit.
rem  - Once the page has been opened here, it also starts from the offline cache if the server isn't running.
cd /d "%~dp0"
set PORT=8080
set URL=http://localhost:%PORT%/?kiosk
set PROFILE=%LOCALAPPDATA%\Vaporstation\chrome

where node >nul 2>nul
if errorlevel 1 (
  echo Node.js not found: starting from the offline cache only.
) else (
  rem a second copy just exits if the server is already running on this port
  start "Vaporstation server" /min node serve.js %PORT%
  timeout /t 1 /nobreak >nul
)

set CHROME=
for %%P in ("%ProgramFiles%\Google\Chrome\Application\chrome.exe" "%ProgramFiles(x86)%\Google\Chrome\Application\chrome.exe" "%LOCALAPPDATA%\Google\Chrome\Application\chrome.exe" "%ProgramFiles(x86)%\Microsoft\Edge\Application\msedge.exe" "%ProgramFiles%\Microsoft\Edge\Application\msedge.exe") do (
  if not defined CHROME if exist %%P set CHROME=%%P
)
if not defined CHROME (
  echo Chrome or Edge not found. Open %URL% yourself and press F for fullscreen.
  pause
  exit /b 1
)

start "" %CHROME% --kiosk "%URL%" --user-data-dir="%PROFILE%" ^
  --autoplay-policy=no-user-gesture-required --use-fake-ui-for-media-stream ^
  --no-first-run --no-default-browser-check --noerrdialogs --disable-session-crashed-bubble --disable-infobars ^
  --disable-background-timer-throttling --disable-renderer-backgrounding --disable-backgrounding-occluded-windows ^
  --disable-features=Translate,HardwareMediaKeyHandling --overscroll-history-navigation=0 --disable-pinch
