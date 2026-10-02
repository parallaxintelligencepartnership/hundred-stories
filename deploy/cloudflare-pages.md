# Cloudflare Workers (static assets) deploy

Cloudflare Workers with static assets is the primary hosting for Hundred
Stories. It is the successor to Cloudflare Pages: the site is served as a
set of static assets directly from Cloudflare's edge, and asset requests are
free and unlimited. A small Worker (`src/worker/index.ts`, the `main` entry in
`wrangler.jsonc`) answers two things the static assets cannot: `POST
/api/feedback` for the in-game feedback card, and byte-range requests for the
videos under `/trailers/` (`src/worker/range.ts`). Static assets are served first;
a request that matches no static asset, plus every `/trailers/*` request, reaches
the Worker, which answers `POST /api/feedback` and byte ranges and hands anything
else to the 404 page. The pi3 package in `deploy/` (see `deploy/README.md`)
remains the fallback, for the static site only.

## One-time setup

1. `npx wrangler login` — opens a browser login the first time you run it.
2. Custom domains are not configured separately: they come from the
   `routes` block in `wrangler.jsonc` (`hundredstories.xyz` and
   `www.hundredstories.xyz`, both `custom_domain: true`). Cloudflare attaches
   them automatically on the first deploy, provided the zone is already on
   the account. `workers_dev` and `preview_urls` are both set to `false` in
   `wrangler.jsonc`, so the `*.workers.dev` subdomain and preview URLs do not
   serve the site.

## Deploy

```
npm run deploy
```

A release is `sh scripts/verify.sh` (typecheck and the whole suite on a clean tree; it stamps the tree id inside the git folder) and then `sh scripts/ship.sh <version>`, both run on main after main is fast-forwarded to the verified commit; ship.sh refuses any branch but main and any tree without a matching stamp. `npm run deploy` by itself builds and deploys without the test gate and is for emergencies only.

This runs `npm run build`, then `scripts/predeploy-check.mjs`, then `npx wrangler deploy`,
which uploads `dist/` as static assets and attaches the custom domains from `wrangler.jsonc`.
The predeploy check gates on the built `dist/` output plus `src-tauri/Cargo.lock`: it fails
the build before anything is uploaded if `dist/_headers` no longer sends a `script-src 'self'`
CSP with no `unsafe-eval` for `/play/`, if `dist/play/index.html` is missing, if the PixiJS
`unsafe-eval` shim is missing from the built JS (that shim is required because the CSP has
no `unsafe-eval`), or if `cargo metadata --locked --offline` cannot resolve the Cargo lock
(skipped, with a warning, when cargo is not installed on the machine running the check).

## Verification

```
curl -sI https://hundredstories.xyz/
curl -sI https://hundredstories.xyz/nope
curl -sI https://hundred-stories.matthew-c50.workers.dev/
```

The first must return 200 with the five security headers from
`public/_headers` (Strict-Transport-Security, X-Content-Type-Options,
Referrer-Policy, Permissions-Policy, Content-Security-Policy). The second
must return 404 (served from `dist/404.html` via `not_found_handling:
"404-page"`). The third, the old `*.workers.dev` URL, must stop returning
200 after the next deploy now that `workers_dev` is `false`.

`vite preview` does not send `public/_headers`; test the CSP with the nginx
container before deploying:

```
npm run build
docker run --rm -d --name hs-csp -p 8089:80 -v "$PWD/dist:/usr/share/nginx/html:ro" -v "$PWD/deploy/nginx.conf:/etc/nginx/nginx.conf:ro" nginx:1.29.4-alpine
```

## Rollback

Cloudflare keeps every deployed version.

```
npx wrangler versions list
npx wrangler rollback
```

`wrangler rollback` reverts to the previous version.

Save format (checked at the 0.5.0 closeout, 2026-09-25): 0.5.0 still writes save format 5, with one
optional field (the cockroach spread timer) that older builds ignore, so a rollback to 0.4.10 loads
every tower; only that timer resets. Keep it that way: a release that raises the format number
must not ship until the rollback target reads the new format, or players who are rolled back lose
their tower.

## Where the headers live

Security headers are defined in `public/_headers` and served by Workers static
assets. The responses the Worker builds itself (`/api/feedback`, `/trailers/*`)
come from `src/worker/`. The pi3 fallback's `deploy/nginx.conf` carries its own
copy of the Content-Security-Policy; keep it identical to `public/_headers`.

## Fallback

The pi3 package in `deploy/` (compose.yml, deploy.sh, nginx.conf) remains
the fallback hosting path. It serves the static site only: there is no
`/api/feedback` route (the in-game feedback card shows its plain failure
message) and no Worker, since nginx answers byte-range requests for the
trailers itself. See `deploy/README.md`.
