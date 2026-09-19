# Landing site spec (2026-09-19)

Goal: hundredstories.xyz gets a real front door. The root serves a static landing site that search engines and link previews can read. The game moves to `/play/`. One repo, one Vite build, one Cloudflare Pages deploy. No framework on the landing pages, no new dependencies.

## Build shape

- Vite multi-page. `index.html` at the repo root becomes the landing page. The game shell moves to `play/index.html` and keeps loading `/src/main.ts` (path `../src/main.ts` from that file, or absolute `/src/main.ts`; Vite accepts either).
- `vite.config.ts`: add `build.rollupOptions.input` with `main: resolve(__dirname, 'index.html')`, `howto: resolve(__dirname, 'how-to-play/index.html')`, `play: resolve(__dirname, 'play/index.html')`.
- PWA: the installable app is the game only. In `VitePWA`: `scope: '/play/'`, manifest `scope: '/play/'`, `start_url: '/play/'`, `id: '/play/'`. Workbox: `navigateFallback: '/play/index.html'`. Keep `globPatterns`, `runtimeCaching`, icons and `registerType` unchanged. The service worker file still lands at `/sw.js`; a worker may control a scope below its own path, so nothing else changes.
- `src/main.ts`: no logic change. The `?seed` and `?new` query params keep working at `/play/?seed=…`.
- `public/_headers`: add a `/play/index.html` block identical to the existing `/index.html` block (no-cache), and a `/how-to-play/index.html` block the same. Keep the rest byte-identical to `deploy/nginx.conf`'s equivalents where they exist; add the matching `location` blocks to `deploy/nginx.conf` so the pi3 fallback keeps parity (nginx already serves `index.html` for directories; only the cache headers need the two new locations).
- `public/robots.txt`:
  ```
  User-agent: *
  Allow: /
  Sitemap: https://hundredstories.xyz/sitemap.xml
  ```
- `public/sitemap.xml`: three `<url>` entries, `https://hundredstories.xyz/`, `https://hundredstories.xyz/how-to-play/`, `https://hundredstories.xyz/play/`, `<lastmod>2026-09-19</lastmod>`.
- `public/og.png`: 1200x630 PNG. Generate it with a new script `scripts/make-og.mjs` in the same style as `scripts/make-icons.mjs` (same drawing library that script already uses, no new dependency): dark background `#0b1020`, the word "Hundred Stories" large in the page font stack, the line "Build a tower. Run it well." beneath, and a simple procedural tower silhouette of stacked cream cells on the right. Add `"og": "node scripts/make-og.mjs"` to package.json scripts and run it once so the PNG is committed.

## Landing page `index.html`

Head, in this order:
```
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Hundred Stories: a tower-building sim you can play in the browser</title>
<meta name="description" content="Hundred Stories is a free browser recreation of the 1994 tower-building sim. Place offices, condos, shops and elevators, keep your tenants happy, and climb from one star to TOWER. Plays offline, saves in your browser, nothing uploaded.">
<link rel="canonical" href="https://hundredstories.xyz/">
<meta property="og:type" content="website">
<meta property="og:site_name" content="Hundred Stories">
<meta property="og:title" content="Hundred Stories">
<meta property="og:description" content="A free browser recreation of the 1994 tower-building sim. Plays offline, saves in your browser, nothing uploaded.">
<meta property="og:url" content="https://hundredstories.xyz/">
<meta property="og:image" content="https://hundredstories.xyz/og.png">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="Hundred Stories">
<meta name="twitter:description" content="A free browser recreation of the 1994 tower-building sim. Plays offline, saves in your browser, nothing uploaded.">
<meta name="twitter:image" content="https://hundredstories.xyz/og.png">
<meta name="theme-color" content="#0b1020">
<link rel="icon" href="/icons/icon-192.png">
<link rel="apple-touch-icon" href="/icons/icon-192.png">
<link rel="stylesheet" href="/src/site/site.css">
```
Plus one JSON-LD block (`<script type="application/ld+json">`, which the CSP does not execute and does not block):
```
{"@context":"https://schema.org","@type":"VideoGame","name":"Hundred Stories","url":"https://hundredstories.xyz/","description":"A free browser recreation of the 1994 tower-building sim.","applicationCategory":"Game","operatingSystem":"Any (web browser)","gamePlatform":"Web browser","offers":{"@type":"Offer","price":"0","priceCurrency":"USD"},"author":{"@type":"Organization","name":"Parallax Intelligence","url":"https://parallaxintelligence.ai"},"license":"https://www.gnu.org/licenses/agpl-3.0.html"}
```

Body, semantic HTML, no JavaScript:

1. `<header>` with the wordmark "Hundred Stories" (text, not an image) and a nav: How to play, Play, Source (GitHub link `https://github.com/parallaxintelligencepartnership/hundred-stories`).
2. `<main>`:
   - Hero: `<h1>Build a tower. Run it well.</h1>`, paragraph: "Hundred Stories is a free recreation of the 1994 tower-building sim, rebuilt for the browser with original art. Place offices, condos, shops and elevators, keep your tenants happy, and climb from one star to TOWER." Primary button "Play in your browser" linking to `/play/`. Beneath the button, small text: "Free. No account. Nothing uploaded." Hero image: `<img src="/og.png" alt="A tower of cream office cells against a dark sky, with the words Hundred Stories">` for now; a real screenshot replaces it in a later step, so give the img an id `hero-shot`.
   - Three feature cards in a grid (`<section aria-labelledby="features">`):
     - "The original rules": "Every room, price, elevator limit and stress rule follows the 1994 ruleset. No additions, no shortcuts. If you remember what made it hard, it is still hard."
     - "Plays offline": "Install it once from your browser and it runs with no connection. Your tower is saved on your device as you play, and you can export it as a file whenever you like."
     - "Yours, and open": "There is no account, no server and nothing tracked. The source is public under the AGPL, so you can read exactly how the tower thinks."
   - A short "How it plays" section: three numbered steps. "1. Start with a lobby and a little cash. 2. Rent floors to tenants and give them elevators that do not make them wait. 3. Earn stars as the tower grows. One hundred stories is the ceiling." Ends with a text link "Read the full guide" to `/how-to-play/`.
   - A "Best on a desktop" note in a muted box: "The game plays best with a mouse and a screen wider than a phone. It loads on a phone, but building is fiddly there for now."
3. `<footer>`: "Made by Parallax Intelligence" (link `https://parallaxintelligence.ai`) · "Source on GitHub" · "AGPL-3.0". Second line, small: "This is original work. It is not affiliated with, endorsed by, or connected to Electronic Arts, Maxis, or OPeNBooK."

## `how-to-play/index.html`

Same head pattern with its own title "How to play Hundred Stories", its own description ("Rooms, elevators, tenant stress, the quarterly economy and the star ladder, explained."), canonical `https://hundredstories.xyz/how-to-play/`, same OG image, same stylesheet, same header and footer. Body content is written from `docs/DESIGN.md`: one `<h2>` per topic (Rooms, Elevators, Tenants and stress, Money and the quarter, Stars, Saving and exporting, Controls), two to five short paragraphs or a list each, plain English, no code. Facts must come from DESIGN.md; do not invent numbers. If DESIGN.md does not state a fact you want, leave it out. Controls come from `src/ui/ui.ts` key handling and `src/render/camera.ts` (pan, wheel zoom, tool keys): read them and list only what exists.

## `play/index.html`

The existing game shell, moved. Title "Play Hundred Stories". Add `<meta name="description" content="Play Hundred Stories in your browser.">`, `<link rel="canonical" href="https://hundredstories.xyz/play/">`, and a `<noscript>` line "Hundred Stories needs JavaScript and WebGL." Nothing else changes.

## `src/site/site.css`

One stylesheet for landing and guide. Use the same font stack and the same colour tokens as `src/ui/ui.css` (read its `:root` and reuse the variable names and values; copy the light-mode media query too). Dark by default. Mobile first: single column with a 16px gutter, the feature grid goes to three columns at 720px and above, max content width 1040px centred, no horizontal scroll at 360px. Buttons and links have visible focus. `prefers-reduced-motion` respected (no animations anyway).

## Docs and state

- `README.md`: update the run section to say the landing is at `/` and the game at `/play/`; update the layout table in `.itworks/MAP.md` with the new files (`play/`, `how-to-play/`, `src/site/`, `public/robots.txt`, `public/sitemap.xml`, `public/og.png`, `scripts/make-og.mjs`). Update the MAP Run line: dev URL for the game is now `http://localhost:5173/play/`.
- `deploy/cloudflare-pages.md` and `deploy/README.md`: the verification curl gains `/play/` and the headers check covers both pages.

## Verification (all must pass before reporting)

1. `npm run typecheck` clean, `npm test` green (update any test that referenced the root `index.html` as the game shell; `tests/harness.test.ts` may).
2. `npm run build` emits `dist/index.html`, `dist/how-to-play/index.html`, `dist/play/index.html`, `dist/robots.txt`, `dist/sitemap.xml`, `dist/og.png`, `dist/sw.js`, `dist/manifest.webmanifest`; `grep start_url dist/manifest.webmanifest` shows `/play/`.
3. `npm run preview` then `curl -s http://localhost:4173/ | grep -c 'og:image'` is 1, `curl -s http://localhost:4173/play/ | grep -c 'src/main\|assets/'` is at least 1, `curl -sI http://localhost:4173/how-to-play/` is 200.
4. `grep -rn 'wrangler@latest'` still empty.
