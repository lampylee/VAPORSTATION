@echo off
rem Vaporstation gig launcher: local server + Chrome in kiosk mode.
rem  - Own Chrome profile (%LOCALAPPDATA%\Vaporstation\chrome), so none of these flags touch your normal Chrome.
rem  - Audio starts without a click; the microphone / line-in prompt is accepted automatically (this profile only).
rem  - Fullscreen, no panel, no cursor. Press H to show the panel, Alt+F4 to quit.
rem  - `kiosk.bat dual`: for a projector. The laptop shows the operator view with the cursor; click "Open projector output",
rem    then click the projector window once to make it fullscreen. Popups are allowed (this profile only) so W / MIDI can reopen it.
rem  - Once the page has been opened here, it also starts from the offline cache if the server isn't running.
cd /d "%~dp0"
set PORT=8080
set URL=http://localhost:%PORT%/?kiosk
set PROFILE=%LOCALAPPDATA%\Vaporstation\chrome
set EXTRA=
if /i "%~1"=="dual" (
  set URL=http://localhost:%PORT%/?kiosk^&dual
  set EXTRA=--disable-popup-blocking
  rem pre-grant window-management (placing the projector on the other screen) for this profile only; needs node
  where node >nul 2>nul && node tools\grant-window-management.js "%PROFILE%" %PORT%
)

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
  --disable-features=Translate,HardwareMediaKeyHandling --overscroll-history-navigation=0 --disable-pinch %EXTRA%
