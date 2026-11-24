// kiosk.bat dual: pre-grant the window-management permission for the kiosk profile only, so the projector window
// can be placed on the other screen without a permission prompt. Merges one entry into the profile's Preferences
// (Chrome must not be running with that profile; otherwise it rewrites the file on exit and the entry is lost,
// the prompt then simply appears once). Usage: node tools/grant-window-management.js <profile dir> <port>
const fs = require('fs');
const path = require('path');
const [dir, port = '8080'] = process.argv.slice(2);
if (!dir) process.exit(0);
try {
  const file = path.join(dir, 'Default', 'Preferences');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  let prefs = {};
  try { prefs = JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) { /* none yet */ }
  const ex = ((prefs.profile ??= {}).content_settings ??= {}).exceptions ??= {};
  (ex.window_placement ??= {})[`http://localhost:${port},*`] = { setting: 1 };
  fs.writeFileSync(file, JSON.stringify(prefs));
} catch (e) { console.log('Could not pre-grant window management (a prompt will appear once):', e.message); }
