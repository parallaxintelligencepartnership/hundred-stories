# Cloudflare Workers (static assets) deploy

Cloudflare Workers with static assets is the primary hosting for Hundred
Stories. It is the successor to Cloudflare Pages: the site is served as a
set of static assets directly from Cloudflare's edge, asset requests are
free and unlimited, and there is no Worker code involved (`wrangler.jsonc`
has no `main` entry). The pi3 package in `deploy/` (see `deploy/README.md`)
remains the fallback.

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

This runs `npm run build` then `npx wrangler deploy`, which uploads `dist/`
as static assets and attaches the custom domains from `wrangler.jsonc`.

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

Save format warning (since 0.5.0, 2026-09-25): 0.5.0 writes save format 6. The previous release,
0.4.10 (`ship-2026-09-24b`), reads formats 1 to 5 only. If you roll back to it, every returning
player's tower is refused as unreadable: the old build keeps the bytes under `localStorage`
key `hs.save.unreadable`, starts a new tower and writes that new tower over the slot. Prefer
rolling forward with a fix. If a rollback is unavoidable, tell players how to get the tower back:
open the browser's storage inspector, copy the `hs.save.unreadable` value into a text file, and
use "Open a saved file" once 0.5.0 or later is live again. Any future release that raises the
save format inherits this note; the rollback target must read the current format.

## Where the headers live

Security headers are defined once, in `public/_headers`, and are served by
Workers static assets — no server config or Worker code applies them.

## Fallback

The pi3 package in `deploy/` (compose.yml, deploy.sh, nginx.conf) remains
the fallback hosting path. See `deploy/README.md`.
