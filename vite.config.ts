import { defineConfig } from 'vitest/config';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  plugins: [
    VitePWA({
      registerType: 'autoUpdate',
      // The installable app is the game, not the landing site.
      scope: '/play/',
      includeAssets: ['icons/*.png'],
      manifest: {
        name: 'Hundred Stories',
        short_name: 'Hundred Stories',
        description:
          'A downtown skyscraper simulation: run and operate a tower, one hundred stories tall.',
        theme_color: '#0b1020',
        background_color: '#0b1020',
        display: 'standalone',
        scope: '/play/',
        start_url: '/play/',
        id: '/play/',
        icons: [
          { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          {
            src: 'icons/icon-512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'any maskable',
          },
        ],
      },
      workbox: {
        navigateFallback: '/play/index.html',
        globPatterns: ['**/*.{js,css,html,png,svg,woff2}'],
        // Google Fonts are fetched at runtime; cache them so the installed app keeps its faces offline.
        runtimeCaching: [
          {
            urlPattern: /^https:\/\/fonts\.googleapis\.com\/.*/i,
            handler: 'StaleWhileRevalidate',
            options: { cacheName: 'google-fonts-stylesheets' },
          },
          {
            urlPattern: /^https:\/\/fonts\.gstatic\.com\/.*/i,
            handler: 'CacheFirst',
            options: { cacheName: 'google-fonts-webfonts', expiration: { maxEntries: 20, maxAgeSeconds: 60 * 60 * 24 * 365 }, cacheableResponse: { statuses: [0, 200] } },
          },
        ],
      },
    }),
  ],
  build: {
    // Three pages, one build. Paths are relative to the Vite root: this repo
    // has no @types/node, so node:path and __dirname are not available here.
    rollupOptions: {
      input: {
        main: 'index.html',
        howto: 'how-to-play/index.html',
        play: 'play/index.html',
        notfound: '404.html',
      },
    },
  },
  test: {
    include: ['tests/**/*.test.ts'],
  },
});
