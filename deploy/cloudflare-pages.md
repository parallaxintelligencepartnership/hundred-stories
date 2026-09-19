# Cloudflare Pages deploy

Cloudflare Pages is the primary hosting for Hundred Stories. The pi3 package in `deploy/` (see `deploy/README.md`) remains the fallback.

## One-time setup

There are two ways to set up the Pages project. Pick one.

### (a) Dashboard, connected to GitHub

1. In the Cloudflare dashboard, go to Workers and Pages and create a new Pages project.
2. Connect the GitHub repo `parallaxintelligencepartnership/hundred-stories`.
3. Set the build command to `npm ci && npm run build`.
4. Set the output directory to `dist`.
5. Node version: this repo has an `.nvmrc` pinning Node `26`; Cloudflare Pages reads it automatically.
6. Under Custom domains, add `hundredstories.xyz`. Cloudflare adds the CNAME itself when the zone is already on the account.

### (b) Direct upload, no GitHub

1. Create the project: `npx wrangler@latest pages project create hundred-stories --production-branch main`
2. Build locally: `npm run build`
3. Deploy: `npx wrangler@latest pages deploy dist --project-name hundred-stories`

Wrangler opens a browser login the first time you run it.

## Verification

```
curl -sI https://hundredstories.xyz/
```

Check for the security headers from `public/_headers` (Strict-Transport-Security, X-Content-Type-Options, Referrer-Policy, Permissions-Policy, Content-Security-Policy) and confirm `/manifest.webmanifest` is served with a content type of `application/manifest+json` (or `application/json`). Then install the site as a PWA from the browser's install prompt to confirm the service worker and manifest are wired up correctly.

## Rollback

Cloudflare Pages keeps every deployment. Roll back either by:

- Opening the project's Deployments list in the dashboard and promoting a previous deployment to production, or
- Redeploying a previous git tag (checkout the tag, run `npm run build`, then `npx wrangler@latest pages deploy dist --project-name hundred-stories`).

## Fallback

The pi3 package in `deploy/` (compose.yml, deploy.sh, nginx.conf) remains the fallback hosting path. See `deploy/README.md`.
