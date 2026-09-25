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

// The Capacitor and Tauri plugin code only ever loads inside a shell, through the dynamic imports
// in src/game/storage.ts and src/steam/steam.ts. Each package gets a stable chunk named
// native-<scope>-<package> so the web service worker can leave the whole family out of its
// precache (globIgnores below). src/steam/steam.ts itself is not one of them: main.ts imports it
// statically on every platform, and it reaches Tauri only through the dynamic import this rule
// already names.
const NATIVE_PACKAGE = /[\\/]node_modules[\\/]@(capacitor|tauri-apps)[\\/]([^\\/]+)[\\/]/;

export function nativeChunk(id: string): string | undefined {
  const match = NATIVE_PACKAGE.exec(id);
  if (!match) return undefined;
  const scope = match[1] === 'tauri-apps' ? 'tauri' : 'capacitor';
  return `native-${scope}-${match[2]}`;
}

// Rolldown's manual chunk groups (the Vite 8 form of Rollup's manualChunks). A group takes its
// members' dependencies with it, and Vite adds its preload helper to every module with a dynamic
// import, the Capacitor plugins included; left alone the helper lands in a native chunk and the
// play page imports that chunk statically, which would break the offline boot. The helper's own
// group outranks the native ones, so it stays in a chunk the precache keeps.
const CHUNK_GROUPS = [
  { name: 'preload-helper', test: /vite[\\/]preload-helper/, priority: 2 },
  { name: (id: string) => nativeChunk(id) ?? null, test: NATIVE_PACKAGE, priority: 1 },
];

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
                'Hundred Stories is a tower-building simulation for the browser, coming to the App Store and Google Play. Place offices, condos, shops and elevators, keep your tenants happy, and climb from one star to TOWER. Plays offline, saves in your browser, nothing uploaded.',
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
              // App-only chunks (nativeChunk above): the web never loads them. The rest of this
              // list is the landing site: pages, assets and images only index.html, 404.html,
              // privacy/ and how-to-play/ reference. The worker's scope is /play/, so it never
              // gets a fetch event for any of them and precaching them only wastes bandwidth.
              globIgnores: [
                '**/node_modules/**',
                'assets/native-*',
                'index.html',
                '404.html',
                'privacy/**',
                'how-to-play/**',
                'og.png',
                'wordmark-*',
                'assets/site-*',
                'assets/main-*',
                'assets/theme-init-*',
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
        output: { codeSplitting: { groups: CHUNK_GROUPS } },
      },
    },
    test: {
      include: ['tests/**/*.test.ts'],
    },
  };
});
