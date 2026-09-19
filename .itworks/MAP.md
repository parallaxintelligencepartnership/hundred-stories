# Map

## Run
npm run dev (Vite dev server); no env vars needed

## Test
npm test (vitest run); one file: npx vitest run <path>

## Layout
| Path | What lives there |
|---|---|
| (filled at first checkpoint) | |

## Environment
- Dev machine: Matt's Mac, arm64 macOS 27, Node 26, npm 11
- Hosting target pi3: x86_64 Ubuntu 24.04 (not a Raspberry Pi), standalone docker compose, Traefik with letsencrypt, public sites are nginx static containers
- No backend, no database, no secrets

## Gotchas
- 2026-09-18 | pi1/pi2/pi3 are x86_64 servers named for Parallax Intelligence, not Raspberry Pis | run uname -m before any architecture decision
