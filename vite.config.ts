import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  optimizeDeps: {
    exclude: ['@electric-sql/pglite'],
  },
  worker: {
    format: 'es',
  },
  // Allows testing on a phone via a localtunnel/ngrok HTTPS URL, which iOS
  // Safari requires before it will register the service worker.
  server: {
    allowedHosts: ['.loca.lt'],
  },
  preview: {
    allowedHosts: ['.loca.lt'],
  },
  plugins: [
    VitePWA({
      registerType: 'autoUpdate',
      workbox: {
        // PGlite ships a multi-MB wasm + data bundle; Workbox's 2 MiB default
        // silently drops it from the precache, which breaks offline boot.
        // woff2/woff: as fontes são self-hosted justamente para o app abrir
        // offline — fora do precache elas falhariam igual a um <link> para o
        // Google Fonts, que é o que se quis evitar.
        globPatterns: ['**/*.{js,css,html,ico,png,svg,wasm,data,woff,woff2}'],
        maximumFileSizeToCacheInBytes: 20 * 1024 * 1024,
      },
      manifest: {
        name: 'Termômetro',
        short_name: 'Termômetro',
        description: 'Controle financeiro pessoal',
        lang: 'pt-BR',
        start_url: '/',
        id: '/',
        display: 'standalone',
        display_override: ['standalone'],
        orientation: 'portrait',
        background_color: '#0d0f10',
        theme_color: '#0d0f10',
        icons: [
          { src: '/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any maskable' },
        ],
      },
      includeAssets: ['apple-touch-icon.png'],
    }),
  ],
});
