# Submission runbook

From opening a developer account to pressing submit, for the App Store, Google Play and Steam.
Written from the repo as it stands after the store round's S2 and S3 ships. Nothing here has
been submitted and no store account exists yet (decision 2026-09-22). Store rules, fees and form
wording change; every step that could not be checked from this repo or the tools on this Mac is
marked check at submission.

The per store fields are in [ios.md](ios.md), [android.md](android.md) and [steam.md](steam.md);
the shared copy is in [listing.md](listing.md).

## Contents

1. What only Matt can do
2. Before any store: the shared build steps
3. App Store: account, signing, TestFlight, submit
4. Google Play: account, signing, internal testing, submit
5. Steam: Steamworks, the desktop build, notarization, depots, submit
6. After a store goes live
7. Facts to check at submission

## 1. What only Matt can do

These need Matt's identity, money or signature. Nothing in this repo does them, and no agent
should.

| Item | App Store | Google Play | Steam |
|---|---|---|---|
| Open the developer account | Apple Developer Program, as an individual or as an organization (an organization needs a D-U-N-S number) | Play Console developer account; personal accounts must pass identity verification, and new personal accounts must run a closed test before production (check at submission) | Steamworks partner account |
| Pay the fee | yearly membership (check at submission) | one time registration fee (check at submission) | Steam Direct fee per app (check at submission) |
| Sign the agreements | Apple Developer Program License Agreement; the Paid Apps agreement if the app is paid | Developer Distribution Agreement | Steam Distribution Agreement |
| Bank account | in App Store Connect, Business | payments profile (paid app) | Steamworks, payment info |
| Tax forms | tax forms in App Store Connect (W-9 for a US person or entity) | tax info in the payments profile | tax interview in Steamworks |
| Identity checks | two factor Apple ID | government ID and, for organizations, D-U-N-S | identity and bank verification |
| Signing identity | Apple Distribution certificate and the Developer ID Application certificate (for the Mac build), both tied to his account | the upload keystore (create it, keep it, back it up) | none of Steam's own; the Mac build uses the Apple Developer ID above |
| Pricing | | | |
| Territories and release date | | | |
| Privacy policy URL | a page he chooses to publish | same | optional |
| Support contact | | | |
| Final submit button | | | |

Pricing is Matt's and stays blank in every file here.

## 2. Before any store: the shared build steps

On this Mac (Xcode 27.0 is installed; there is no JDK or Android SDK; Rust is under ~/.cargo):

```bash
npm ci
npm test
npm run typecheck
npm run build:app        # the full edition game bundle into dist-app/, no service worker
npm run store:shots      # store screenshots and graphics into store/shots/ (gitignored)
```

Version numbers to set before the first upload of each store build (they are independent):

- iOS: MARKETING_VERSION and CURRENT_PROJECT_VERSION in ios/App/App.xcodeproj (Xcode, target
  App, General, Identity). The build number must rise with every upload.
- Android: versionName and versionCode in android/app/build.gradle. versionCode must rise with
  every upload.
- Steam: version in src-tauri/tauri.conf.json and src-tauri/Cargo.toml (both 0.4.4 today).

The store builds carry the full game: `build:app` sets `VITE_EDITION=full`.

The screenshot script, scripts/make-store-shots.mjs:

- `npm run store:shots` builds dist-app/, serves it with `vite preview --mode app`, opens one
  headless Chrome (Metal, falling back to SwiftShader if WebGL fails), seeds
  store/fixtures/demo-tower.json into the save slot, and writes 5 views per screenshot size plus
  the Steam and Play graphics into store/shots/<store>/, with store/shots/manifest.json. About
  three minutes on this Mac.
- `node scripts/make-store-shots.mjs --no-build` reuses dist-app/; `BASE=<url>` shoots a preview
  already running; `CHROME=<path>` points at another Chrome.
- The sizes live in the script's SCREENSHOTS and GRAPHICS tables and in the size tables of
  ios.md, android.md and steam.md; tests/store/shots.test.ts fails if the two disagree.
  `STORE_SHOTS_E2E=1 npx vitest run tests/store` also runs the script end to end.
- The demo tower is eight floors. A taller fixture would make stronger store shots; replace
  store/fixtures/demo-tower.json with any exported save.

Fonts: the two typefaces are bundled (public/fonts/, SIL Open Font License texts alongside). The
game makes no network requests, which is what the privacy forms on all three stores state.

## 3. App Store

### 3.1 Account and App Store Connect record

1. Matt enrolls in the Apple Developer Program at developer.apple.com and signs the agreements.
2. In Certificates, Identifiers and Profiles, register the App ID `xyz.hundredstories.app`
   (explicit, no capabilities needed: no Game Center, no push, no iCloud today).
3. In App Store Connect, My Apps, add a new app: platform iOS, name Hundred Stories, primary
   language English (U.S.), bundle ID `xyz.hundredstories.app`, SKU any unique string (for
   example `hundred-stories-ios`), full access.
4. For a paid app: Business, sign the Paid Apps agreement, add the bank account and tax forms.

### 3.2 Signing through Xcode

The project uses automatic signing with no team set (S2 left signing to the account).

1. `npx cap sync ios` (copies dist-app/ into the Xcode project and updates the native plugins).
2. `npx cap open ios`, or open ios/App/App.xcodeproj in Xcode (Capacitor 8 uses Swift Package
   Manager here, so there is no .xcworkspace).
3. Xcode, Settings, Accounts: add Matt's Apple ID.
4. Target App, Signing and Capabilities: tick Automatically manage signing, choose Matt's team.
   Xcode creates the Apple Development and Apple Distribution certificates and the provisioning
   profiles.
5. Optional, recommended: add `ITSAppUsesNonExemptEncryption` = NO to Info.plist so the export
   compliance question is answered once (ios.md; check at submission).

### 3.3 Build and upload

In Xcode: choose Any iOS Device (arm64), Product, Archive, then in the Organizer, Distribute App,
App Store Connect, Upload.

Or from the command line, once the team is set in the project (the S2 simulator build shows the
project builds here; the archive has not been run because there is no team):

```bash
npm run build:app && npx cap sync ios
xcodebuild -project ios/App/App.xcodeproj -scheme App -configuration Release \
  -destination 'generic/platform=iOS' -archivePath build/HundredStories.xcarchive \
  -allowProvisioningUpdates archive
xcodebuild -exportArchive -archivePath build/HundredStories.xcarchive \
  -exportOptionsPlist ExportOptions.plist -exportPath build/ipa -allowProvisioningUpdates
```

ExportOptions.plist is not in the repo; the simplest one sets `method` to `app-store-connect`,
`destination` to `upload` and `teamID` to Matt's team ID, which uploads straight to App Store
Connect (check at submission: the method name has changed across Xcode versions). The simulator
check from S2:

```bash
xcodebuild -project ios/App/App.xcodeproj -scheme App -configuration Debug \
  -destination 'generic/platform=iOS Simulator' build
```

### 3.4 TestFlight

1. The upload appears in App Store Connect, TestFlight, after processing. Answer the export
   compliance question if the Info.plist key is not set.
2. Internal testing: add Matt (and anyone on the team) to an internal group; builds are available
   at once, no review.
3. External testing (optional): a group of up to 10,000 testers by email or public link; the
   first build of each version goes through Beta App Review. Test notes suggestion: "Build a
   lobby, an elevator and a few offices, run at 4x for a day, export the save and import it."
4. Check on a real iPhone and iPad: the save survives a force quit (Filesystem slot), export
   opens the share sheet, import opens the file picker, the status bar and the notch are clear,
   rotation behaves.

### 3.5 The version page and submit

1. App Store Connect, the app, the 1.0 version: fill every field from ios.md (screenshots from
   store/shots/ios/, description, keywords, support URL, privacy policy URL).
2. App information: category, content rights, age rating questionnaire (listing.md).
3. App privacy: the privacy label (listing.md).
4. Pricing and availability: Matt.
5. Build: select the TestFlight build.
6. App review information: contact details (Matt), no demo account, the notes from ios.md.
7. Version release: manual or automatic after approval (Matt's call).
8. Add for Review, then Submit for Review.

## 4. Google Play

### 4.1 Account and app record

1. Matt creates the Play Console developer account at play.google.com/console, pays the fee and
   completes identity verification.
2. Create app: name Hundred Stories, default language English (United States), Game, paid or free
   (Matt's call, and a free app cannot later be made paid), accept the declarations.
3. New personal accounts must run a closed test with a minimum number of testers for a minimum
   period before production access is granted (at the time of writing 12 testers for 14 days;
   check at submission). Plan for it: it is the longest wait of the three stores.

### 4.2 The Android toolchain

Not on this Mac today. Install Android Studio (it bundles a JDK and the SDK manager), then
install the SDK platform for API 36 and the build tools. Set `ANDROID_HOME` (usually
~/Library/Android/sdk). First check that the project builds:

```bash
npm run build:app && npx cap sync android
cd android && ./gradlew assembleDebug
```

### 4.3 Signing: the upload key and Play App Signing

Play App Signing is mandatory for new apps: Google holds the app signing key, and Matt signs
uploads with an upload key he keeps.

1. Create the upload keystore, outside the repo, and back it up with its passwords somewhere
   safe (losing it means asking Google to reset the upload key):

   ```bash
   keytool -genkeypair -v -keystore ~/keys/hundred-stories-upload.jks -alias upload \
     -keyalg RSA -keysize 2048 -validity 10000
   ```

2. Build a signed release bundle. Either Android Studio, Build, Generate Signed App Bundle, or
   gradle with the signing values passed in from the environment so nothing is committed:

   ```bash
   cd android && ./gradlew bundleRelease \
     -Pandroid.injected.signing.store.file=$HOME/keys/hundred-stories-upload.jks \
     -Pandroid.injected.signing.store.password="$UPLOAD_STORE_PASSWORD" \
     -Pandroid.injected.signing.key.alias=upload \
     -Pandroid.injected.signing.key.password="$UPLOAD_KEY_PASSWORD"
   ```

   Output: android/app/build/outputs/bundle/release/app-release.aab. (The injected signing
   properties are what Android Studio itself passes; check at submission that the Android
   Gradle Plugin version in android/build.gradle still honors them, or add a signingConfigs
   block that reads the same values from ~/.gradle/gradle.properties.)

3. The first upload of the .aab enrolls the app in Play App Signing; accept Google generating
   the app signing key.

### 4.4 Internal testing, then closed testing

1. Testing, Internal testing: create a release, upload the .aab, add release notes, add testers
   by email list (up to 100). Available in minutes, no review.
2. Install from the opt-in link on a real phone and a tablet. Check the same list as TestFlight:
   save survives a force stop, export goes through the share sheet, import through the file
   picker, back button behavior, status bar color.
3. Closed testing: the track that satisfies the new account testing requirement (4.1 step 3).

### 4.5 Store listing and submit

1. Grow, Store presence, Main store listing: fields and graphics from android.md
   (store/shots/android/).
2. Policy, App content: every declaration from android.md (privacy policy, ads, app access,
   content rating questionnaire, target audience, data safety).
3. Monetize: price (Matt) and countries (Matt).
4. Production: create a release, promote the tested bundle, roll out. Send for review from the
   Publishing overview.

## 5. Steam

### 5.1 Steamworks

1. Matt joins Steamworks at partner.steamgames.com, completes the tax interview, bank details and
   identity verification, and signs the Steam Distribution Agreement.
2. Pay the Steam Direct fee for one app. Steamworks issues an App ID and a first depot ID per
   platform (check at submission: Steam creates one depot by default; add one per OS).
3. Download the Steamworks SDK from the partner site and unzip it outside the repo.

### 5.2 App admin

In Steamworks, the app's admin pages:

1. Installation, General: launch options, one per OS, pointing at the executable in each depot
   (macOS: `Hundred Stories.app`; Windows: `hundred-stories.exe`; Linux: the AppImage or the
   binary; exact names to be read off the first Windows and Linux builds, check at submission).
2. Depots: one per OS, each restricted to its OS.
3. Stats and Achievements: add the six achievements with the API names in steam.md, the display
   names, descriptions and icons. Publish the stats changes.
4. Publish the app admin changes (Publish tab) after each change.

### 5.3 The desktop build with Steam on

The Steam feature needs the SDK at build time and the redistributable next to the app at run
time (src-tauri/README.md):

```bash
export STEAM_SDK_LOCATION=/path/to/steamworks_sdk/sdk
npx tauri build --features steam
```

`beforeBuildCommand` runs `npm run build:app` first. On macOS the output is under
src-tauri/target/release/bundle/ (macos/Hundred Stories.app and dmg/). Then:

- Put the SDK's `redistributable_bin/osx/libsteam_api.dylib` inside the app bundle where the
  executable finds it. Tauri can copy it at build time through `bundle.macOS.frameworks` or
  `bundle.resources` in tauri.conf.json; that config is not in the repo yet, and the exact
  location the steamworks crate loads from is check at submission (a first run inside Steam will
  show "steam: not available" on stderr if the library or the app id is missing).
- Do not ship steam_appid.txt in a depot; it is for running outside Steam during development
  only (a file containing the App ID next to the executable).

Windows and Linux were not built on this Mac. Build them on their own OS (or in CI runners):

- Windows: Rust with the MSVC toolchain, the Visual Studio C++ build tools, WebView2 (on Windows
  11 already). `npx tauri build --features steam` gives an .exe and the NSIS or MSI installer
  under src-tauri/target/release/bundle/. For Steam, upload the unpacked release folder (the .exe
  plus `steam_api64.dll` from `redistributable_bin/win64/`), not the installer. WebView2 must be
  present: Steam can install it as a redistributable, or the app can ship the WebView2 bootstrapper
  (check at submission).
- Linux: Ubuntu 22.04 with the Tauri Linux prerequisites (webkit2gtk 4.1 and friends), then the
  same build; ship the binary with `libsteam_api.so` from `redistributable_bin/linux64/`. Steam
  runs Linux games in the Steam Linux Runtime; test in it (check at submission).
- A GitHub Actions matrix (macos-latest, windows-latest, ubuntu-22.04) with the SDK downloaded
  from a private location is the usual route; the SDK must not be committed (licence).

### 5.4 macOS signing and notarization

Steam does not require notarization, but a Mac app that is not signed and notarized is blocked
by Gatekeeper on first launch. Do both.

1. Matt creates a Developer ID Application certificate (Xcode, Settings, Accounts, Manage
   Certificates, or the developer site) and keeps it in the login keychain.
2. An app specific password for notarization (appleid.apple.com), stored in the keychain:

   ```bash
   xcrun notarytool store-credentials hundred-stories-notary \
     --apple-id "<Matt's Apple ID>" --team-id "<team ID>"
   ```

   (it prompts for the app specific password, so nothing is written to a file or the shell
   history).
3. Build signed; Tauri signs and notarizes when these are set:

   ```bash
   export APPLE_SIGNING_IDENTITY="Developer ID Application: <name> (<team ID>)"
   export APPLE_ID="<Matt's Apple ID>" APPLE_TEAM_ID="<team ID>"
   export APPLE_PASSWORD="<app specific password>"   # or use the keychain profile below by hand
   npx tauri build --features steam
   ```

   Or sign and notarize by hand after the build:

   ```bash
   codesign --deep --force --options runtime --timestamp \
     --sign "Developer ID Application: <name> (<team ID>)" "Hundred Stories.app"
   ditto -c -k --keepParent "Hundred Stories.app" HundredStories.zip
   xcrun notarytool submit HundredStories.zip --keychain-profile hundred-stories-notary --wait
   xcrun stapler staple "Hundred Stories.app"
   ```

   Sign the bundled libsteam_api.dylib too (codesign --deep covers it once it is inside the
   bundle). notarytool and stapler are present with Xcode on this Mac; neither has been run.

### 5.5 Upload depots with steamcmd

steamcmd is not installed here. Install it (from the SDK's `tools/ContentBuilder/builder_osx`, or
Valve's download), then write one app build script and one depot script per OS. Minimal shape,
with the IDs from Steamworks:

```
"AppBuild"
{
  "AppID" "<app id>"
  "Desc" "Hundred Stories 1.0"
  "BuildOutput" "../output/"
  "ContentRoot" "../content/"
  "SetLive" ""
  "Depots"
  {
    "<mac depot id>" { "FileMapping" { "LocalPath" "mac/*" "DepotPath" "." "recursive" "1" } }
    "<windows depot id>" { "FileMapping" { "LocalPath" "win/*" "DepotPath" "." "recursive" "1" } }
    "<linux depot id>" { "FileMapping" { "LocalPath" "linux/*" "DepotPath" "." "recursive" "1" } }
  }
}
```

Copy each OS build into content/mac, content/win and content/linux, then:

```bash
steamcmd +login <Matt's Steam partner login> +run_app_build /abs/path/scripts/app_build.vdf +quit
```

steamcmd asks for the password and Steam Guard code interactively; never put them in a script.
Leave SetLive empty and set the build live on a branch by hand in Steamworks, SteamPipe, Builds.

### 5.6 Testing on Steam

1. SteamPipe, Builds: set the uploaded build live on a private beta branch with a password.
2. Matt's own account owns the app through the developer package; install through the Steam
   client with the beta branch selected.
3. Check: launches from Steam on each OS, the overlay opens (Shift Tab), achievements unlock on
   a star (the first on the first report), the save lands in the app data directory and
   survives a restart, export and import open the system dialogs, the window minimum size holds.
4. Steam keys for other testers: Steamworks, Request Steam product keys (check at submission).

### 5.7 Store page and release

1. Store page: every field and asset from steam.md (store/shots/steam/), then submit the store
   page for review.
2. Coming soon: Steam requires the page to be public as Coming soon for a minimum period before
   release (at the time of writing two weeks; check at submission).
3. Release checklist in Steamworks: the build review (Valve launches the build) and the store
   page review must both pass. Build review turnaround is a few business days (check at
   submission).
4. Pricing: Matt, in Steamworks, Pricing.
5. Release: set the build live on the default branch, then press Release on the release
   checklist.

## 6. After a store goes live

- Put the store link in src/site/stores.ts (store round S1 item 2). The landing page and the
  in-game cap card read store links from there; README.md stays silent about stores.
- The web build's demo cap (VITE_EDITION=demo) stays off until a store listing is live to link
  to (decision 2026-09-22). Turning it on is Matt's call.
- Record the release in .itworks/DECISIONS.md.

## 7. Facts to check at submission

Collected from above, none verifiable from the repo or this Mac:

- Apple: required screenshot sizes, the export compliance answer, the TestFlight export method
  name, the new age rating tiers.
- Google: the fee, the closed testing rule for new personal accounts, the minimum target SDK, the
  injected signing properties with the project's Android Gradle Plugin, tablet screenshot rules,
  store tags, data safety wording.
- Steam: the Steam Direct fee, capsule sizes, the Coming soon period, depot and launch option
  names for Windows and Linux, where libsteam_api must sit inside the Mac bundle, the WebView2
  route on Windows, the Linux runtime.
- All three: the resulting age rating (the bomb threat text), the privacy policy URL, support
  URL, developer name as registered.
