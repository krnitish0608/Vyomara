import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

if (process.platform !== 'darwin') {
  throw new Error('The Vyomara desktop app launcher currently requires macOS.');
}

const root = fileURLToPath(new URL('../', import.meta.url));
const electronApp = resolve(root, 'node_modules/electron/dist/Electron.app');
const appBundle = resolve(root, 'out/Vyomara.app');
const plist = resolve(appBundle, 'Contents/Info.plist');
const iconSource = resolve(root, 'src/renderer/src/ui/assets/vyomara-app-icon.svg');

function run(command, args) {
  const result = spawnSync(command, args, { cwd: root, stdio: 'inherit' });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${command} failed with exit code ${result.status}.`);
}

run(process.execPath, [resolve(root, 'node_modules/electron-vite/bin/electron-vite.js'), 'build']);
rmSync(appBundle, { recursive: true, force: true });
run('/bin/cp', ['-cR', electronApp, appBundle]);
const temporaryDirectory = mkdtempSync(join(tmpdir(), 'vyomara-app-icon-'));
const iconset = resolve(temporaryDirectory, 'Vyomara.iconset');
const appIcon = resolve(appBundle, 'Contents/Resources/vyomara.icns');
mkdirSync(iconset);

try {
  for (const [size, filename] of [
    [16, 'icon_16x16.png'],
    [32, 'icon_16x16@2x.png'],
    [32, 'icon_32x32.png'],
    [64, 'icon_32x32@2x.png'],
    [128, 'icon_128x128.png'],
    [256, 'icon_128x128@2x.png'],
    [256, 'icon_256x256.png'],
    [512, 'icon_256x256@2x.png'],
    [512, 'icon_512x512.png'],
    [1024, 'icon_512x512@2x.png'],
  ]) {
    run('/usr/bin/sips', ['-s', 'format', 'png', '-z', String(size), String(size), iconSource, '--out', resolve(iconset, filename)]);
  }
  run('/usr/bin/iconutil', ['--convert', 'icns', '--output', appIcon, iconset]);
} finally {
  rmSync(temporaryDirectory, { recursive: true, force: true });
}

run('/usr/libexec/PlistBuddy', [
  '-c', 'Set :CFBundleIdentifier app.vyomara.desktop',
  '-c', 'Set :CFBundleName Vyomara',
  '-c', 'Set :CFBundleDisplayName Vyomara',
  '-c', 'Set :CFBundleIconFile vyomara.icns',
  '-c', 'Set :NSMicrophoneUsageDescription Vyomara uses the microphone only while local voice listening is enabled.',
  plist,
]);
run('/usr/bin/codesign', ['--force', '--deep', '--sign', '-', '--identifier', 'app.vyomara.desktop', appBundle]);
run('/usr/bin/codesign', ['--verify', '--deep', '--strict', appBundle]);
run('/usr/bin/open', ['-n', appBundle, '--args', root]);
