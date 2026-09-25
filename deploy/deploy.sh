#!/usr/bin/env bash
# Deploy Hundred Stories (Vite static build) to pi3 behind Traefik.
#
# Usage: deploy/deploy.sh [--no-up]
#   --no-up   Stage files on pi3 but stop before `docker compose up -d`.
#             Use this to stage before DNS/TLS exist for SITE_HOST.
#
# Reads SITE_HOST from deploy/.env (see deploy/.env.example) for the final
# curl checks. The compose stack itself also reads SITE_HOST from .env: this
# script copies deploy/.env to the project directory's .env on pi3, which
# `docker compose` reads by default (no `--env-file` flag is passed).
set -euo pipefail

NO_UP=0
if [[ "${1:-}" == "--no-up" ]]; then
  NO_UP=1
fi

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

if [[ ! -f "$REPO_ROOT/deploy/.env" ]]; then
  if [[ "$NO_UP" -eq 1 ]]; then
    echo "==> no deploy/.env yet; staging only (--no-up)" >&2
  else
    echo "error: deploy/.env is missing (copy deploy/.env.example and set SITE_HOST), or pass --no-up to stage only" >&2
    exit 1
  fi
fi

echo "==> npm ci"
npm ci

echo "==> npm run build"
npm run build

echo "==> checking whether dist/ differs from the live release on pi3"
HTML_EXISTS="$(ssh pi3 '[ -d /opt/hundred-stories/html ] && echo yes || echo no')"

if [[ "$HTML_EXISTS" == "no" ]]; then
  echo "==> first deploy: no previous release to snapshot"
else
  # -i (itemize-changes) prints one line per changed entry, portable across
  # the BSD/openrsync client on this Mac and the GNU rsync on pi3. -c
  # (checksum) compares file contents instead of size+mtime, so a re-deploy
  # of changed content is never mistaken for a no-op. Lines starting with
  # '.' are attribute-only (e.g. a timestamp refresh with identical
  # content); only real transfers/creates/deletes count as a change.
  CHANGED_LINES="$(rsync -ainc --delete dist/ pi3:/opt/hundred-stories/html/ | grep -v '^\.' || true)"
  if [[ -z "$CHANGED_LINES" ]]; then
    echo "==> dist/ matches the live release; leaving html.prev untouched"
  else
    DATE_TAG="$(date -u +%Y%m%d%H%M%S)"
    echo "==> snapshotting current release as html.snapshots/$DATE_TAG (keeping the last 3)"
    ssh pi3 "
      set -e
      mkdir -p /opt/hundred-stories/html.snapshots
      cp -a /opt/hundred-stories/html /opt/hundred-stories/html.snapshots/$DATE_TAG
      ls -1dt /opt/hundred-stories/html.snapshots/*/ | tail -n +4 | xargs -r rm -rf
      rm -rf /opt/hundred-stories/html.prev
      cp -a /opt/hundred-stories/html.snapshots/$DATE_TAG /opt/hundred-stories/html.prev
    "
  fi
fi

echo "==> rsync dist/ -> pi3:/opt/hundred-stories/html/"
rsync -avz --delete dist/ pi3:/opt/hundred-stories/html/

echo "==> rsync compose.yml and nginx.conf -> pi3:/opt/hundred-stories/"
rsync -avz "$REPO_ROOT/deploy/compose.yml" "$REPO_ROOT/deploy/nginx.conf" pi3:/opt/hundred-stories/

if [[ -f "$REPO_ROOT/deploy/.env" ]]; then
  echo "==> rsync deploy/.env -> pi3:/opt/hundred-stories/.env"
  rsync -avz "$REPO_ROOT/deploy/.env" pi3:/opt/hundred-stories/.env
fi

if [[ "$NO_UP" -eq 1 ]]; then
  echo "==> --no-up given: files staged on pi3, skipping docker compose up"
  exit 0
fi

echo "==> docker compose up -d --force-recreate on pi3"
ssh pi3 "cd /opt/hundred-stories && docker compose up -d --force-recreate"

SITE_HOST=""
if [[ -f "$REPO_ROOT/deploy/.env" ]]; then
  SITE_HOST="$(grep -E '^SITE_HOST=' "$REPO_ROOT/deploy/.env" | tail -1 | cut -d= -f2-)"
fi
if [[ -z "$SITE_HOST" ]]; then
  SITE_HOST="$(grep -E '^SITE_HOST=' "$REPO_ROOT/deploy/.env.example" | tail -1 | cut -d= -f2-)"
fi

# Pin the checks to pi3 itself (resolved through the ssh alias, never a
# hardcoded IP) so they verify the deployed origin even while SITE_HOST's
# DNS still points elsewhere, e.g. mid-cutover from Cloudflare.
PI3_ADDR="$(ssh -G pi3 | awk '$1 == "hostname" { print $2; exit }')"

echo "==> verifying https://$SITE_HOST/ against pi3 ($PI3_ADDR)"
curl -fsS -o /dev/null -w 'GET / -> %{http_code}\n' --resolve "$SITE_HOST:443:$PI3_ADDR" "https://$SITE_HOST/"
curl -fsS -o /dev/null -w 'GET /manifest.webmanifest -> %{http_code}\n' --resolve "$SITE_HOST:443:$PI3_ADDR" "https://$SITE_HOST/manifest.webmanifest"
