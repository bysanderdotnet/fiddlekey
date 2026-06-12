import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { defineConfig } from 'vite';
import { nodePolyfills } from 'vite-plugin-node-polyfills';
import { VitePWA } from 'vite-plugin-pwa';

const require = createRequire(import.meta.url);

// essentia.js loads its WASM binary at runtime; make sure it ships with the bundle.
function copyEssentiaWasm() {
  return {
    name: 'copy-essentia-wasm',
    generateBundle() {
      this.emitFile({
        type: 'asset',
        fileName: 'assets/essentia-wasm.web.wasm',
        source: readFileSync(require.resolve('essentia.js/dist/essentia-wasm.web.wasm')),
      });
    },
  };
}

export default defineConfig({
  optimizeDeps: { exclude: ['essentia.js'] },
  plugins: [
    nodePolyfills(),
    copyEssentiaWasm(),
    VitePWA({
      registerType: 'autoUpdate',
      manifest: {
        name: 'Fiddlekey',
        short_name: 'Fiddlekey',
        description: 'Automatically detect the key of a jam session.',
        start_url: '/',
        display: 'standalone',
        theme_color: '#000000',
        icons: [
          { src: '/favicon.svg', sizes: '192x192', type: 'image/svg+xml' },
          { src: '/android-chrome-192x192.png', sizes: '192x192', type: 'image/png' },
          { src: '/android-chrome-512x512.png', sizes: '512x512', type: 'image/png' },
          { src: '/apple-touch-icon.png', sizes: '180x180', type: 'image/png' }
        ]
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,ico,png,svg,wasm}'],
        // Essentia's WASM runtime is several MB; raise the precache limit so it works offline.
        maximumFileSizeToCacheInBytes: 16 * 1024 * 1024
      }
    })
  ]
});
