// kiosk.bat dual: pre-grant the window-management permission for the kiosk profile only, so the projector window
// can be placed on the other screen without a permission prompt. Merges one entry into the profile's Preferences
// (Chrome must not be running with that profile; otherwise it rewrites the file on exit and the entry is lost,
// the prompt then simply appears once). Usage: node tools/grant-window-management.js <profile dir> <port>
// Never loses the profile's other settings: only a missing file counts as "start empty"; a file that can't be read
// or parsed is left alone. Written via a temp file + rename, so a crash mid-write can't leave half a file.
const fs = require('fs');
const path = require('path');
const [dir, port = '8080'] = process.argv.slice(2);
if (!dir) process.exit(0);
const skip = (why) => { console.log(`Could not pre-grant window management (a prompt will appear once): ${why}`); process.exit(0); };
const file = path.join(dir, 'Default', 'Preferences');
let prefs = {};
try {
  prefs = JSON.parse(fs.readFileSync(file, 'utf8'));
} catch (e) {
  if (e.code !== 'ENOENT') skip(`${file} left unchanged (${e.message})`);
}
if (!prefs || typeof prefs !== 'object' || Array.isArray(prefs)) skip(`${file} left unchanged (unexpected content)`);
try {
  const ex = ((prefs.profile ??= {}).content_settings ??= {}).exceptions ??= {};
  (ex.window_placement ??= {})[`http://localhost:${port},*`] = { setting: 1 };
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.vaporstation-tmp`;
  fs.writeFileSync(tmp, JSON.stringify(prefs));
  fs.renameSync(tmp, file);
} catch (e) { skip(e.message); }
