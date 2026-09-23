# App Store (iOS and iPadOS)

The App Store Connect fields for Hundred Stories. Copy comes from [listing.md](listing.md); the
steps are in [SUBMISSION.md](SUBMISSION.md). Limits and requirements written here are the ones
known when this was written; anything marked check at submission is to be confirmed in App Store
Connect on the day.

## The build, from the repo

| Field | Value | Where it lives |
|---|---|---|
| Bundle ID | `xyz.hundredstories.app` | capacitor.config.ts, ios/App/App.xcodeproj (PRODUCT_BUNDLE_IDENTIFIER) |
| Display name | Hundred Stories | ios/App/App/Info.plist (CFBundleDisplayName) |
| Version | 1.0 | MARKETING_VERSION in the Xcode project |
| Build number | 1 | CURRENT_PROJECT_VERSION; raise it for every upload |
| Minimum iOS | 15.0 | IPHONEOS_DEPLOYMENT_TARGET |
| Devices | iPhone and iPad | TARGETED_DEVICE_FAMILY 1,2, so iPad screenshots are required |
| Orientations | iPhone: portrait and both landscapes. iPad: all four | Info.plist |
| Signing | Automatic, no team set | CODE_SIGN_STYLE Automatic; the team is chosen in Xcode once the account exists |
| App icon | 1024 by 1024, opaque | ios/App/App/Assets.xcassets/AppIcon.appiconset, written by `npm run icons` |
| Web bundle | dist-app/ from `npm run build:app` (full edition) | copied in by `npx cap sync ios` |

Export compliance: the Info.plist has no `ITSAppUsesNonExemptEncryption` key, so App Store Connect
asks about encryption on each build. The app has no encryption of its own; its only network use
is HTTPS through the system (the font request). The usual answer for that is that the app uses
only exempt encryption; check at submission, and consider adding the key set to false so the
question stops coming back (a one line Info.plist change, not made here).

## App information

| Field | Limit | Value |
|---|---|---|
| Name | 30 characters | Hundred Stories |
| Subtitle | 30 characters | Build a tower. Run it well. |
| Primary category | | Games, subcategory Simulation |
| Secondary category | | Games, subcategory Strategy |
| Content rights | | The app contains no third party content beyond two bundled typefaces under the SIL Open Font License (public/fonts/, licence texts alongside) |
| Age rating | questionnaire | From listing.md, "Age rating answers" |
| Copyright | | 2026 Parallax Intelligence Partnership |
| Price | | (blank: Matt's call) |
| Availability | | (blank: Matt's call) |

## Version page

| Field | Limit | Value |
|---|---|---|
| Promotional text | 170 characters | listing.md, promotional line |
| Description | 4,000 characters | listing.md, long description |
| Keywords | 100 characters | listing.md, keywords |
| Support URL | required | (blank until Matt picks the page; the landing page contact is hello@parallaxintelligence.ai) |
| Marketing URL | optional | (blank: Matt's call) |
| Privacy policy URL | required | (blank: no privacy page exists yet, see listing.md) |
| What's new | per version, not on 1.0 | |
| Screenshots | see below | store/shots/ios/ |
| App previews (video) | optional | none |

App privacy (the nutrition label): Data Not Collected, from listing.md "Privacy answers". The app
makes no network requests.

App review information: no sign in is needed, so no demo account. Notes for the reviewer, as a
suggestion: "Hundred Stories is a single player tower simulation. No account, no network features.
Drag along the ground floor to build a lobby, then add an elevator and rooms. The save is local."
Contact name, phone and email are the account holder's (Matt's).

Game Center: not integrated. The six stars are Steam achievements only (src-tauri). Adding Game
Center is a later item.

## Screenshot sizes

Apple takes the largest iPhone size and scales it down for the smaller phones, and the largest
iPad size for the other iPads. The script makes portrait shots, because a tower is tall. Up to 10
per size; the script makes 5 (`tower`, `wide`, `close`, `closer`, `far`). PNG, RGB, no alpha
(the script strips the alpha channel Chrome writes).

| Id | Size | Device class | Status |
|---|---|---|---|
| `ios-iphone-6.9` | `1320x2868` | iPhone 6.9 inch display | required (Apple also accepts 1290 by 2796 and 1260 by 2736) |
| `ios-iphone-6.5` | `1284x2778` | iPhone 6.5 inch display | used only if the 6.9 inch set is missing; made anyway (Apple also accepts 1242 by 2688) |
| `ios-ipad-13` | `2064x2752` | iPad 13 inch display | required, the app runs on iPad (Apple also accepts 2048 by 2732) |

Which sizes are mandatory on the day is check at submission: Apple has changed the required set
twice since 2023.
