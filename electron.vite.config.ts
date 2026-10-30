import react from '@vitejs/plugin-react';
import { defineConfig, externalizeDepsPlugin } from 'electron-vite';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import type { Plugin } from 'vite';

const nativeSpeechHelper: Plugin = {
  name: 'vyomara-native-speech-helper',
  buildStart() {
    if (process.platform !== 'darwin') return;
    const result = spawnSync(process.execPath, [
      fileURLToPath(new URL('./scripts/build-native-speech.mjs', import.meta.url)),
    ], { stdio: 'inherit' });
    if (result.error) throw result.error;
    if (result.status !== 0) throw new Error(`Native speech helper build failed with exit code ${result.status}.`);
  },
};

const developmentContentSecurityPolicy: Plugin = {
  name: 'vyomara-development-csp',
  transformIndexHtml: {
    order: 'pre',
    handler(html, context) {
      return context.server
        ? html.replace("script-src 'self';", "script-src 'self' 'unsafe-inline';")
        : html;
    },
  },
};

export default defineConfig({
  main: {
    plugins: [nativeSpeechHelper, externalizeDepsPlugin()],
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: {
        output: {
          format: 'cjs',
          entryFileNames: 'index.cjs',
        },
      },
    },
  },
  renderer: {
    plugins: [react(), developmentContentSecurityPolicy],
  },
});
