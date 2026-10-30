import { spawnSync } from 'node:child_process';
import { cpSync, mkdirSync, rmSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

if (process.platform !== 'darwin') process.exit(0);

const root = fileURLToPath(new URL('../', import.meta.url));
const appPath = resolve(root, 'out/native/VyomaraSpeech.app');
const executablePath = join(appPath, 'Contents/MacOS/VyomaraSpeech');
mkdirSync(dirname(executablePath), { recursive: true });
rmSync(appPath, { recursive: true, force: true });
mkdirSync(dirname(executablePath), { recursive: true });
cpSync(resolve(root, 'src/native/Info.plist'), join(appPath, 'Contents/Info.plist'));

for (const [command, args] of [
  ['/usr/bin/swiftc', [
    '-swift-version', '5',
    '-framework', 'Speech',
    '-framework', 'AVFoundation',
    resolve(root, 'src/native/SpeechRecognition.swift'),
    '-o', executablePath,
  ]],
  ['/usr/bin/codesign', ['--force', '--deep', '--sign', '-', appPath]],
]) {
  const result = spawnSync(command, args, { stdio: 'inherit' });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${command} failed with exit code ${result.status}.`);
}
