#!/bin/sh
# Ship a release: bump every version file, commit, deploy to Cloudflare, then (only when the
# deploy succeeded) tag and push origin and the GitHub mirror. Run from the repo root, on main:
#   sh scripts/ship.sh 0.6.0
# The tag is ship-<today>; pass a second argument to name it yourself.
set -eu

BRANCH=$(git rev-parse --abbrev-ref HEAD)
if [ "$BRANCH" != main ]; then
  echo "ship from main, not $BRANCH" >&2
  exit 1
fi

NEW="${1:?usage: sh scripts/ship.sh <new version> [tag]}"
TAG="${2:-}"
if [ -z "$TAG" ]; then
  # Today's tag, with a letter suffix when today already shipped (ship-2026-09-26-b and so on).
  BASE="ship-$(date +%Y-%m-%d)"
  TAG="$BASE"
  for s in b c d e f g h; do
    git rev-parse -q --verify "refs/tags/$TAG" >/dev/null || break
    TAG="$BASE-$s"
  done
fi
if git rev-parse -q --verify "refs/tags/$TAG" >/dev/null; then
  echo "tag $TAG already exists" >&2
  exit 1
fi
OLD=$(node -p "require('./package.json').version")

if [ "$OLD" = "$NEW" ]; then
  echo "package.json is already $NEW" >&2
  exit 1
fi
if [ -n "$(git status --porcelain)" ]; then
  echo "working tree is not clean; commit or stash first" >&2
  exit 1
fi
# Proof the tests passed on this exact tree: scripts/verify.sh writes the stamp only when the
# typecheck and the whole suite pass. Checked before anything is bumped.
STAMP="$(git rev-parse --git-dir)/hs-verified"
TREE=$(git rev-parse 'HEAD^{tree}')
if [ ! -f "$STAMP" ] || [ "$(cat "$STAMP")" != "$TREE" ]; then
  echo "the tests have not passed on this commit; run sh scripts/verify.sh first, then ship again" >&2
  exit 1
fi

OLD_RE=$(printf '%s' "$OLD" | sed 's/\./\\./g')

echo "bumping $OLD -> $NEW"
sed -i '' "s/\"version\": \"$OLD_RE\"/\"version\": \"$NEW\"/" package.json src-tauri/tauri.conf.json
# Cargo: only the app's own version line. A dependency crate can share the old number (zlib-rs
# 0.6.8 did), so never replace globally: in Cargo.toml the [package] table, in Cargo.lock the
# [[package]] block named after the app. The app name is read from Cargo.toml.
APP=$(awk '/^\[/ { t = $0 } t == "[package]" && /^name = "/ { sub(/^name = "/, ""); sub(/".*/, ""); print; exit }' src-tauri/Cargo.toml)
if [ -z "$APP" ]; then
  echo "no [package] name in src-tauri/Cargo.toml" >&2
  exit 1
fi
awk -v old="$OLD" -v new="$NEW" '
  /^\[/ { t = $0 }
  t == "[package]" && !done && $0 == "version = \"" old "\"" { $0 = "version = \"" new "\""; done = 1 }
  { print }' src-tauri/Cargo.toml > src-tauri/Cargo.toml.ship && mv src-tauri/Cargo.toml.ship src-tauri/Cargo.toml
awk -v app="$APP" -v old="$OLD" -v new="$NEW" '
  /^\[\[package\]\]$/ { mine = 0 }
  $0 == "name = \"" app "\"" { mine = 1 }
  mine && $0 == "version = \"" old "\"" { $0 = "version = \"" new "\""; mine = 0 }
  { print }' src-tauri/Cargo.lock > src-tauri/Cargo.lock.ship && mv src-tauri/Cargo.lock.ship src-tauri/Cargo.lock
for f in src-tauri/Cargo.toml src-tauri/Cargo.lock; do
  if [ "$(git diff --numstat -- "$f" | cut -f1,2)" != "$(printf '1\t1')" ]; then
    echo "the Cargo bump in $f did not change exactly the app's version line:" >&2
    git diff -- "$f" >&2
    exit 1
  fi
done
sed -i '' "s/MARKETING_VERSION = $OLD_RE;/MARKETING_VERSION = $NEW;/" ios/App/App.xcodeproj/project.pbxproj
sed -i '' "s/versionName \"$OLD_RE\"/versionName \"$NEW\"/" android/app/build.gradle
# Android versionCode is the dotted version as one number (0.6.1 -> 601), see tests/site/versions.test.ts.
CODE=$(printf '%s' "$NEW" | awk -F. '{ print $1 * 10000 + $2 * 100 + $3 }')
sed -i '' "s/versionCode [0-9]*/versionCode $CODE/" android/app/build.gradle
npm install --package-lock-only --ignore-scripts >/dev/null

# Check the project's own version fields only: a dependency in the lockfile can share the old number.
PKG=$(node -p "require('./package.json').version")
LOCK=$(node -p "const l = require('./package-lock.json'); [l.version, l.packages[''].version].join(' ')")
if [ "$PKG" != "$NEW" ] || [ "$LOCK" != "$NEW $NEW" ]; then
  echo "the bump did not land: package.json is $PKG, the lockfile says $LOCK" >&2
  exit 1
fi

# Same rule as scripts/predeploy-check.mjs's findCargo/cargoMetadataCheck: run before the
# release commit, so a lock that does not resolve stops the ship before anything is committed.
CARGO=$(command -v cargo || true)
if [ -z "$CARGO" ]; then
  FALLBACK="${CARGO_HOME:-$HOME/.cargo}/bin/cargo"
  [ -x "$FALLBACK" ] && CARGO="$FALLBACK"
fi
if [ -n "$CARGO" ]; then
  if ! CARGO_METADATA_ERR=$("$CARGO" metadata --locked --offline --format-version 1 --manifest-path src-tauri/Cargo.toml 2>&1 >/dev/null); then
    echo "cargo metadata --locked --offline failed on src-tauri/Cargo.lock; nothing committed:" >&2
    printf '%s\n' "$CARGO_METADATA_ERR" | tail -n 3 >&2
    exit 1
  fi
else
  echo "cargo not found, skipping cargo metadata --locked --offline" >&2
fi

git add package.json package-lock.json src-tauri/tauri.conf.json src-tauri/Cargo.toml \
  src-tauri/Cargo.lock ios/App/App.xcodeproj/project.pbxproj android/app/build.gradle
git commit -q -m "$NEW"
COMMIT=$(git rev-parse --short HEAD)
echo "committed $COMMIT"

echo "deploying"
# A pipeline's status is its last command's (tee), and plain sh has no portable pipefail, so the
# deploy's own exit status goes through a temp file. Nothing below runs unless it is 0.
STATUS_FILE=$(mktemp)
{ rc=0; npm run deploy 2>&1 || rc=$?; echo "$rc" > "$STATUS_FILE"; } | tee /tmp/hundred-stories-deploy.log
DEPLOY_STATUS=$(cat "$STATUS_FILE")
rm -f "$STATUS_FILE"
if [ "$DEPLOY_STATUS" != 0 ]; then
  echo >&2
  echo "deploy failed (exit $DEPLOY_STATUS); nothing tagged or pushed, the live site is unchanged." >&2
  echo "The release commit $COMMIT is local only. Fix the failure, then either drop the commit and" >&2
  echo "ship again, or deploy, tag and push by hand with exactly these commands:" >&2
  echo "  npm run deploy" >&2
  echo "  git tag $TAG" >&2
  echo "  git push origin main --tags" >&2
  echo "  git push github main --tags" >&2
  exit 1
fi
VERSION_ID=$(grep -oE '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}' /tmp/hundred-stories-deploy.log | tail -1 || true)

git tag "$TAG"
echo "tagged $TAG"

echo "pushing"
git push origin main --tags
git push github main --tags

echo
echo "shipped $NEW as $TAG"
echo "Cloudflare version id: ${VERSION_ID:-not found in the deploy output, see /tmp/hundred-stories-deploy.log}"
