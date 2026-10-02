#!/bin/sh
# Prove the tests pass on exactly what will ship. Runs the typecheck and the whole test suite on a
# clean working tree, and only when both pass writes the tree id (git rev-parse HEAD^{tree}) to
# hs-verified inside the git folder, where it is never committed. scripts/ship.sh refuses to ship
# a tree that has no matching stamp. Run from the repo root:
#   sh scripts/verify.sh
set -eu

if [ -n "$(git status --porcelain)" ]; then
  echo "working tree is not clean; commit or stash first, so the tests run on what ships" >&2
  exit 1
fi

TREE=$(git rev-parse 'HEAD^{tree}')
STAMP="$(git rev-parse --git-dir)/hs-verified"
rm -f "$STAMP"

npm run typecheck
npx vitest run

# Nothing may have changed while the tests ran, or the stamp would vouch for a tree they never saw.
if [ -n "$(git status --porcelain)" ] || [ "$(git rev-parse 'HEAD^{tree}')" != "$TREE" ]; then
  echo "the tree changed while the tests ran; nothing verified, run sh scripts/verify.sh again" >&2
  exit 1
fi

printf '%s\n' "$TREE" > "$STAMP"
echo "verified $TREE"
