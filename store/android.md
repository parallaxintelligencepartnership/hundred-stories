# Google Play (Android)

The Play Console fields for Hundred Stories. Copy comes from [listing.md](listing.md); the steps
are in [SUBMISSION.md](SUBMISSION.md). Anything marked check at submission is to be confirmed in
the Play Console on the day.

## The build, from the repo

| Field | Value | Where it lives |
|---|---|---|
| Package name (application ID) | `xyz.hundredstories.app` | android/app/build.gradle; permanent once the first upload is made |
| Version name | 1.0 | versionName in android/app/build.gradle |
| Version code | 1 | versionCode; raise it for every upload |
| Min SDK | 24 (Android 7.0) | android/variables.gradle |
| Target and compile SDK | 36 | android/variables.gradle; Play's minimum target level moves every year, check at submission |
| Upload format | Android App Bundle (.aab) | `./gradlew bundleRelease` |
| Signing | none configured in the repo | an upload key made by Matt, Play App Signing holds the app key (SUBMISSION.md) |
| Launcher icon | adaptive, foreground and background | android/app/src/main/res, written by `npm run icons` |
| Web bundle | dist-app/ from `npm run build:app` (full edition) | copied in by `npx cap sync android` |
| Permissions | INTERNET (Capacitor's default, used for the font request) | android/app/src/main/AndroidManifest.xml |

Not verified on this Mac: there is no JDK or Android SDK here (S2 recorded the same), so no
Android build has run. The first `./gradlew assembleDebug` on a machine with Android Studio is the
check.

## Main store listing

| Field | Limit | Value |
|---|---|---|
| App name | 30 characters | Hundred Stories |
| Short description | 80 characters | listing.md, short description |
| Full description | 4,000 characters | listing.md, long description |
| App icon | 512 by 512 PNG, 32 bit | store/shots/android/play-icon.png (from public/icons/icon-512.png) |
| Feature graphic | 1024 by 500, JPEG or 24 bit PNG, no alpha | store/shots/android/play-feature-graphic.png (from public/og.png) |
| Phone screenshots | 2 to 8 | store/shots/android/android-phone-*.png |
| Tablet screenshots | up to 8 per class | store/shots/android/android-tablet-*.png |
| Video | optional YouTube URL | none |
| App or game | | Game |
| Category | | Simulation |
| Tags | up to 5, picked from Play's list | Simulation, Tycoon, Building, Management, Offline (check at submission: the tag list is Play's own) |
| Contact email | required | hello@parallaxintelligence.ai (the landing page address; Matt's call) |
| Website | optional | (blank: Matt's call) |
| Privacy policy URL | required | (blank: no privacy page exists yet, see listing.md) |
| Price | | (blank: Matt's call; a paid app needs a payments profile, and an app published free can never become paid) |
| Countries | | (blank: Matt's call) |

## App content (the policy declarations)

| Declaration | Answer |
|---|---|
| Privacy policy | the URL above |
| Ads | the app contains no ads |
| App access | all functionality is available without special access (no sign in) |
| Content rating | the IARC questionnaire, answered from listing.md "Age rating answers"; the email for the certificate is the account's |
| Target audience | Matt's call. The game is not made for children; choosing an under 13 age group puts it under the Families policy (check at submission). A suggestion: 13 and over |
| News app | no |
| Data safety | no data collected, no data shared (listing.md "Privacy answers", the font note as check at submission) |
| Government app | no |
| Financial features | none |
| Health | none |

## Screenshot sizes

Play takes PNG or JPEG, 24 bit with no alpha, each side between 320 and 3,840 px, the long side no
more than twice the short side. To be eligible for the promoted game surfaces, phone shots should
be at least 1080 px on the short side and tablet shots 16 by 9 or 9 by 16 with sides from 1,080
to 7,680 px (check at submission). The script makes 5 per size.

| Id | Size | Device class | Status |
|---|---|---|---|
| `android-phone` | `1080x1920` | Phone, portrait | required, at least 2 |
| `android-tablet` | `2560x1440` | 7 inch and 10 inch tablet, landscape | optional; one set serves both tablet classes |
| `play-feature-graphic` | `1024x500` | Feature graphic | required |
| `play-icon` | `512x512` | Hi-res app icon | required |
