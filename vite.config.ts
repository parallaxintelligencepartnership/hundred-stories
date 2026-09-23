import { defineConfig } from 'vitest/config';
import type { Plugin } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';
import { readdirSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';

// `vite build --mode app` (npm run build:app) is the bundle the iOS and Android shells load
// (capacitor.config.ts webDir). It builds the game page only: no landing site, no how-to or 404
// page, and no service worker (the shell serves every file from the app bundle already). The game
// page is emitted at the root as dist-app/index.html. Asset URLs stay absolute (/assets/...,
// /theme.js, /icons/...) and the shell serves dist-app at its origin root, so nothing is rewritten.
const APP_MODE = 'app';

// Files copied verbatim from public/ into dist-app that the app shells never load: the
// landing site's Cloudflare headers, crawler files, social preview image and wordmark
// exports. theme.js is not on this list — it is left for closeBundle to decide, since the
// game page (play/index.html) references it.
const APP_UNUSED_PUBLIC_FILES = ['_headers', 'robots.txt', 'sitemap.xml', 'og.png'];

function gameAtRoot(): Plugin {
  let outDir = 'dist-app';
  return {
    name: 'hundred-stories-game-at-root',
    apply: 'build',
    configResolved(config) {
      outDir = config.build.outDir;
    },
    // After Vite's own html plugin, which emits the page in its generateBundle.
    enforce: 'post',
    generateBundle(_options, bundle) {
      const page = bundle['play/index.html'];
      if (!page || page.type !== 'asset') return this.error('app build: play/index.html was not emitted');
      delete bundle['play/index.html'];
      this.emitFile({ type: 'asset', fileName: 'index.html', source: page.source });
    },
    closeBundle() {
      let entries: string[];
      try {
        entries = readdirSync(outDir);
      } catch {
        return;
      }
      let indexHtml = '';
      try {
        indexHtml = readFileSync(join(outDir, 'index.html'), 'utf8');
      } catch {
        // no-op: if index.html is missing something else already failed the build.
      }
      const keepThemeJs = indexHtml.includes('theme.js');
      for (const name of entries) {
        const isUnusedFile = APP_UNUSED_PUBLIC_FILES.includes(name) || name.startsWith('wordmark');
        const isThemeJs = name === 'theme.js' && !keepThemeJs;
        if (isUnusedFile || isThemeJs) {
          rmSync(join(outDir, name), { force: true });
        }
      }
    },
  };
}

export default defineConfig(({ mode }) => {
  const app = mode === APP_MODE;
  return {
    plugins: app
      ? [gameAtRoot()]
      : [
          VitePWA({
            registerType: 'autoUpdate',
            // The installable app is the game, not the landing site.
            scope: '/play/',
            includeAssets: ['icons/*.png'],
            manifest: {
              name: 'Hundred Stories',
              short_name: 'Hundred Stories',
              description:
                'Hundred Stories is a free tower-building simulation for the browser. Place offices, condos, shops and elevators, keep your tenants happy, and climb from one star to TOWER. Plays offline, saves in your browser, nothing uploaded.',
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
      outDir: app ? 'dist-app' : 'dist',
      rollupOptions: {
        input: app
          ? { play: 'play/index.html' }
          : {
              main: 'index.html',
              howto: 'how-to-play/index.html',
              play: 'play/index.html',
              privacy: 'privacy/index.html',
              notfound: '404.html',
            },
      },
    },
    test: {
      include: ['tests/**/*.test.ts'],
    },
  };
});
