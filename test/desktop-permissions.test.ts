import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { mkdir, realpath, symlink } from 'node:fs/promises';
import test from 'node:test';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  grantDesktopFilesystemRoot,
  initializeDesktopFilesystemRoots,
  revokeDesktopFilesystemRoot,
} from '../src/app/application.ts';
import { loadConfig } from '../src/config/config.ts';
import { createDefaultToolRegistry } from '../src/tools/default-tools.ts';

test('desktop folder grants are canonical, persistent, and revocable', async t => {
  const root = mkdtempSync(join(tmpdir(), 'vyomara-desktop-permissions-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const selected = join(root, 'selected');
  await mkdir(selected);
  const readableFile = join(selected, 'note.txt');
  writeFileSync(readableFile, 'permission fixture');
  const alias = join(root, 'selected-alias');
  await symlink(selected, alias);
  const config = loadConfig({
    VYOM_PROVIDER: 'placeholder',
    VYOM_DATA_DIR: join(root, 'app-data'),
  });

  const initialized = initializeDesktopFilesystemRoots(config);
  assert.deepEqual(initialized.filesystemAllowedRoots, []);
  const granted = await grantDesktopFilesystemRoot(initialized, alias);
  const canonicalSelected = await realpath(selected);
  assert.deepEqual(granted.filesystemAllowedRoots, [canonicalSelected]);
  const readTool = createDefaultToolRegistry(granted).get('filesystem.read-file');
  assert.ok(readTool);
  const canonicalFile = join(canonicalSelected, 'note.txt');
  assert.deepEqual(await readTool.run({ path: canonicalFile }, new AbortController().signal), {
    content: 'permission fixture',
    bytes: 18,
  });
  assert.deepEqual(
    initializeDesktopFilesystemRoots(config).filesystemAllowedRoots,
    [canonicalSelected],
  );
  const revoked = revokeDesktopFilesystemRoot(granted, canonicalSelected);
  assert.deepEqual(revoked.filesystemAllowedRoots, []);
  const revokedReadTool = createDefaultToolRegistry(revoked).get('filesystem.read-file');
  assert.ok(revokedReadTool);
  await assert.rejects(
    revokedReadTool.run({ path: canonicalFile }, new AbortController().signal),
    (error: unknown) => typeof error === 'object' && error !== null && 'code' in error &&
      error.code === 'permission-denied',
  );
  assert.deepEqual(initializeDesktopFilesystemRoots(config).filesystemAllowedRoots, []);

  const file = join(root, 'not-a-folder.txt');
  writeFileSync(file, 'fixture');
  await assert.rejects(grantDesktopFilesystemRoot(config, file), /not a folder/);
  await assert.rejects(grantDesktopFilesystemRoot(config, join(root, 'missing')), /unavailable/);
});
