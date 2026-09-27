#!/bin/sh
# Ship a release: bump every version file, commit, tag, deploy to Cloudflare, push origin and
# the GitHub mirror. Run from the repo root:  sh scripts/ship.sh 0.6.0
# The tag is ship-<today>; pass a second argument to name it yourself.
set -eu

NEW="${1:?usage: sh scripts/ship.sh <new version> [tag]}"
TAG="${2:-ship-$(date +%Y-%m-%d)}"
OLD=$(node -p "require('./package.json').version")

if [ "$OLD" = "$NEW" ]; then
  echo "package.json is already $NEW" >&2
  exit 1
fi
if [ -n "$(git status --porcelain)" ]; then
  echo "working tree is not clean; commit or stash first" >&2
  exit 1
fi

OLD_RE=$(printf '%s' "$OLD" | sed 's/\./\\./g')

echo "bumping $OLD -> $NEW"
sed -i '' "s/\"version\": \"$OLD_RE\"/\"version\": \"$NEW\"/" package.json src-tauri/tauri.conf.json
sed -i '' "s/^version = \"$OLD_RE\"/version = \"$NEW\"/" src-tauri/Cargo.toml src-tauri/Cargo.lock
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

git add package.json package-lock.json src-tauri/tauri.conf.json src-tauri/Cargo.toml \
  src-tauri/Cargo.lock ios/App/App.xcodeproj/project.pbxproj android/app/build.gradle
git commit -q -m "$NEW"
git tag "$TAG"
echo "committed $(git rev-parse --short HEAD), tagged $TAG"

echo "deploying"
npm run deploy 2>&1 | tee /tmp/hundred-stories-deploy.log
VERSION_ID=$(grep -oE '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}' /tmp/hundred-stories-deploy.log | tail -1 || true)

echo "pushing"
git push origin main --tags
git push github main --tags

echo
echo "shipped $NEW as $TAG"
echo "Cloudflare version id: ${VERSION_ID:-not found in the deploy output, see /tmp/hundred-stories-deploy.log}"
