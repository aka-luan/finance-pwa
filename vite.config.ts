import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  optimizeDeps: {
    exclude: ['@electric-sql/pglite'],
  },
  worker: {
    format: 'es',
  },
  plugins: [
    VitePWA({
      registerType: 'autoUpdate',
      workbox: {
        // PGlite ships a multi-MB wasm + data bundle; Workbox's 2 MiB default
        // silently drops it from the precache, which breaks offline boot.
        globPatterns: ['**/*.{js,css,html,ico,png,svg,wasm,data}'],
        maximumFileSizeToCacheInBytes: 20 * 1024 * 1024,
      },
      manifest: {
        name: 'Termômetro',
        short_name: 'Termômetro',
        description: 'Controle financeiro pessoal',
        start_url: '/',
        display: 'standalone',
        background_color: '#0b3d2e',
        theme_color: '#0b3d2e',
        icons: [
          { src: '/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any maskable' },
        ],
      },
      includeAssets: ['apple-touch-icon.png'],
    }),
  ],
});
