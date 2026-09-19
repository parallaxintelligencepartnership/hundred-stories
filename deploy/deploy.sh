#!/usr/bin/env bash
# Deploy Hundred Stories (Vite static build) to pi3 behind Traefik.
#
# Usage: deploy/deploy.sh [--no-up]
#   --no-up   Stage files on pi3 but stop before `docker compose up -d`.
#             Use this to stage before DNS/TLS exist for SITE_HOST.
#
# Reads SITE_HOST from deploy/.env (see deploy/.env.example) only for the
# final curl checks; the compose stack itself reads deploy/.env via
# `docker compose --env-file` on pi3.
set -euo pipefail

NO_UP=0
if [[ "${1:-}" == "--no-up" ]]; then
  NO_UP=1
fi

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

echo "==> npm ci"
npm ci

echo "==> npm run build"
npm run build

echo "==> snapshot previous release on pi3 (html -> html.prev)"
ssh pi3 '
  set -e
  if [ -d /opt/hundred-stories/html ]; then
    rm -rf /opt/hundred-stories/html.prev
    cp -a /opt/hundred-stories/html /opt/hundred-stories/html.prev
  fi
'

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

echo "==> docker compose up -d on pi3"
ssh pi3 "cd /opt/hundred-stories && docker compose up -d"

SITE_HOST=""
if [[ -f "$REPO_ROOT/deploy/.env" ]]; then
  SITE_HOST="$(grep -E '^SITE_HOST=' "$REPO_ROOT/deploy/.env" | tail -1 | cut -d= -f2-)"
fi
if [[ -z "$SITE_HOST" ]]; then
  SITE_HOST="$(grep -E '^SITE_HOST=' "$REPO_ROOT/deploy/.env.example" | tail -1 | cut -d= -f2-)"
fi

echo "==> verifying https://$SITE_HOST/"
curl -s -o /dev/null -w 'GET / -> %{http_code}\n' "https://$SITE_HOST/" || true
curl -s -o /dev/null -w 'GET /manifest.webmanifest -> %{http_code}\n' "https://$SITE_HOST/manifest.webmanifest" || true
