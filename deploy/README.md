# Deploying Hundred Stories to pi3

Static Vite build served by nginx, behind the existing Traefik on pi3, same
shape as stillpub (see `pubworks/docs/deploy-stillpub.md` and
`claude-knowledge-base/stacks/pi3-stillpub-compose.yml`).

## One-time setup

1. **Buy the domain** (the value that will go in `SITE_HOST`, e.g.
   `hundredstories.xyz`).
2. **Cloudflare DNS**: add an A record for the apex to pi3's public address (the same A record stillpub.com uses, DNS only),
   DNS only (grey cloud, not proxied — Traefik on pi3 needs to see and
   terminate TLS directly). Optionally add a `www` CNAME to the apex.
3. **Create the remote directory, if it does not already exist:**

   ```sh
   ssh pi3 "sudo mkdir -p /opt/hundred-stories/html && sudo chown -R \$USER /opt/hundred-stories"
   ```

   Note: stillpub's own deploy doc (`pubworks/docs/deploy-stillpub.md` and
   `deploy/push-to-pi3.sh`) does not document an initial chown step at all —
   every remote file operation for stillpub runs under `sudo`, implying its
   `/opt/stillpub` tree stays root-owned. This deploy instead chowns
   `/opt/hundred-stories` to the deploying user so `deploy.sh` can rsync
   without `sudo`. Flagging this divergence: if you want the two stacks to
   share the exact same ownership model, that's a follow-up decision, not
   something this file changes on its own.
4. **Configure `deploy/.env`** (copy from `deploy/.env.example`) with the
   real `SITE_HOST`.
5. **Run the deploy** (see below).
6. **Verify the certificate**: `curl -vI https://$SITE_HOST/ 2>&1 | grep -i
   "subject\|issuer\|HTTP/"` — confirm a Let's Encrypt cert for `SITE_HOST`
   and a `200` response.

## Deploy

```sh
cp deploy/.env.example deploy/.env   # first time only; edit SITE_HOST
deploy/deploy.sh                     # build, rsync, compose up, curl checks
```

Before DNS/TLS exist for `SITE_HOST`, stage files without bringing the stack
up:

```sh
deploy/deploy.sh --no-up
```

Then once DNS is live, ssh in and run `docker compose up -d` in
`/opt/hundred-stories`, or just re-run `deploy/deploy.sh` without the flag.

## Update

Re-run `deploy/deploy.sh`. It rebuilds `dist/`, snapshots the current
`/opt/hundred-stories/html` to `/opt/hundred-stories/html.prev` on pi3 before
overwriting it, syncs the new build, re-syncs `compose.yml`/`nginx.conf`, and
runs `docker compose up -d` again (picks up any compose/nginx changes).

## Rollback

`deploy.sh` keeps exactly one previous release: `/opt/hundred-stories/html.prev`
(saved right before each new sync). To roll back to it:

```sh
ssh pi3 '
  set -e
  rm -rf /opt/hundred-stories/html.rollback-tmp
  cp -a /opt/hundred-stories/html /opt/hundred-stories/html.rollback-tmp
  rsync -a --delete /opt/hundred-stories/html.prev/ /opt/hundred-stories/html/
  rm -rf /opt/hundred-stories/html.prev
  mv /opt/hundred-stories/html.rollback-tmp /opt/hundred-stories/html.prev
'
```

This swaps `html` and `html.prev` (via a temp dir, since `mv` can't safely
swap two directories in place). No container restart is needed — nginx serves
straight off the bind mount. Verify both pages with
`curl -sI https://$SITE_HOST/ | head -1` and
`curl -sI https://$SITE_HOST/play/ | head -1`.

App-level rollback beyond one release: redeploy from the previous git tag
(`git checkout <tag> && deploy/deploy.sh`).
