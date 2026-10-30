import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { rmSync } from 'node:fs';

if (process.platform !== 'darwin') {
  throw new Error('The Vyomara desktop app launcher currently requires macOS.');
}

const root = fileURLToPath(new URL('../', import.meta.url));
const electronApp = resolve(root, 'node_modules/electron/dist/Electron.app');
const appBundle = resolve(root, 'out/Vyomara.app');
const plist = resolve(appBundle, 'Contents/Info.plist');

function run(command, args) {
  const result = spawnSync(command, args, { cwd: root, stdio: 'inherit' });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${command} failed with exit code ${result.status}.`);
}

run(process.execPath, [resolve(root, 'node_modules/electron-vite/bin/electron-vite.js'), 'build']);
rmSync(appBundle, { recursive: true, force: true });
run('/bin/cp', ['-cR', electronApp, appBundle]);
run('/usr/libexec/PlistBuddy', [
  '-c', 'Set :CFBundleIdentifier app.vyomara.desktop',
  '-c', 'Set :CFBundleName Vyomara',
  '-c', 'Set :CFBundleDisplayName Vyomara',
  '-c', 'Set :NSMicrophoneUsageDescription Vyomara uses the microphone only when you press the voice-input button.',
  '-c', 'Add :NSSpeechRecognitionUsageDescription string Vyomara transcribes your speech on this Mac when you press the voice-input button.',
  plist,
]);
run('/usr/bin/codesign', ['--force', '--deep', '--sign', '-', '--identifier', 'app.vyomara.desktop', appBundle]);
run('/usr/bin/codesign', ['--verify', '--deep', '--strict', appBundle]);
run('/usr/bin/open', ['-n', appBundle, '--args', root]);
