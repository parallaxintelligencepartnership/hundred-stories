# Steam (Windows, macOS, Linux)

The Steamworks store page fields for Hundred Stories. Copy comes from [listing.md](listing.md);
the steps are in [SUBMISSION.md](SUBMISSION.md). Anything marked check at submission is to be
confirmed in the Steamworks partner site on the day.

## The build, from the repo

| Field | Value | Where it lives |
|---|---|---|
| Shell | Tauri 2 (2.11.6), the platform WebView | src-tauri/ |
| Identifier | `xyz.hundredstories.desktop` | src-tauri/tauri.conf.json |
| Product name | Hundred Stories | tauri.conf.json productName |
| Version | 0.4.4 in tauri.conf.json and Cargo.toml | set it to the release version before the first depot upload |
| Window | 1440 by 900, minimum 960 by 640, resizable | tauri.conf.json |
| Web bundle | dist-app/ from `npm run build:app` (full edition), run by tauri's beforeBuildCommand | tauri.conf.json build |
| Steam achievements | cargo feature `steam`, off by default | src-tauri/Cargo.toml, src-tauri/src/achievements.rs |
| Steamworks SDK | not vendored (licence); `STEAM_SDK_LOCATION` points at it | src-tauri/README.md |
| Steam App ID | none yet; issued when the app is created in Steamworks | goes in steam_appid.txt for local runs only, never in the depot |

Built on this Mac in S3: an unsigned macOS bundle, about 3.5 MB (.app) and 1.7 MB (.dmg), without
the steam feature. Windows and Linux were not built here.

## Achievements

Six, one per star, mapped in src-tauri/src/achievements.rs. The API names in Steamworks must match
exactly:

| API name | Earned at | Display name (suggested) | Description (suggested) |
|---|---|---|---|
| `FIRST_TOWER` | 1 star (the first star is held from the start, so it unlocks on the first report) | First tower | Open a tower. |
| `STAR_2` | 2 stars | Two stars | Reach 300 people. |
| `STAR_3` | 3 stars | Three stars | Reach 1,000 people with a security office. |
| `STAR_4` | 4 stars | Four stars | Reach 5,000 people with a suite, a medical center and a recycling center, and a fair VIP rating. |
| `STAR_5` | 5 stars | Five stars | Reach 10,000 people with a metro station. |
| `STAR_6` | Tower | Tower | Reach 15,000 people and hold a wedding in the cathedral. |

Each needs an achieved and an unachieved icon, 256 by 256 JPG or PNG (check at submission). Not
made by the script: they want drawn star art.

## Store page

| Field | Limit | Value |
|---|---|---|
| Name | | Hundred Stories |
| Short description | about 300 characters | listing.md, short description plus the promotional line |
| About this game | long, rich text | listing.md, long description |
| Genres | | Simulation, Strategy |
| Tags (user facing, up to 20) | | Simulation, City Builder, Building, Management, Pixel Graphics, Singleplayer, Casual, Economy, Strategy, 2D, Relaxing, Sandbox, Offline (check at submission: Steam's tag list is its own) |
| Supported languages | | English (interface, no audio voice, no subtitles needed) |
| Controller support | | none (mouse and keyboard) |
| Mature content survey | | none of the categories apply; the fire and bomb threat events as in listing.md, text alerts with property damage only |
| Developer and publisher | | Parallax Intelligence Partnership (check at submission against the name on the Steamworks account) |
| Release date | | (blank: Matt's call) |
| Price | | (blank: Matt's call) |
| Legal line | optional | Copyright 2026 Parallax Intelligence Partnership |
| Privacy policy URL | optional | (blank until the page exists) |
| Support email or URL | | hello@parallaxintelligence.ai (Matt's call) |

System requirements (suggested; check at submission against a real Windows and Linux build):

| | Windows | macOS | Linux |
|---|---|---|---|
| OS | Windows 10 or 11, 64 bit, with the WebView2 runtime (installed on Windows 11; the Tauri installer fetches it) | macOS 11 or later (check at submission: Tauri 2's minimum system version default) | Ubuntu 22.04 or later, 64 bit, with WebKitGTK 4.1 |
| Memory | 4 GB | 4 GB | 4 GB |
| Graphics | WebGL 2 capable | WebGL 2 capable | WebGL 2 capable |
| Storage | 100 MB | 100 MB | 100 MB |

## Graphic assets and screenshot sizes

Steam doubled its capsule sizes in 2024; the table uses the current sizes, and keeps the older 616
by 353 main capsule the store round spec names. The capsules are made from public/og.png (1200 by
630, the wordmark on the dark page colour), fitted whole on that background colour. Steam's rules
want the game's logo legible on every capsule and no review quotes or discount text on them.
Screenshots: at least 5, 16 by 9, 1920 by 1080 recommended; the script makes 5.

| Id | Size | Asset | Status |
|---|---|---|---|
| `steam-screenshot` | `1920x1080` | Screenshots | required, at least 5 |
| `steam-header-capsule` | `920x430` | Header capsule (also the library header) | required |
| `steam-small-capsule` | `462x174` | Small capsule | required |
| `steam-main-capsule` | `1232x706` | Main capsule | required |
| `steam-main-capsule-616` | `616x353` | Main capsule at the pre 2024 size | made because the spec names it; upload the 1232 by 706 one |
| `steam-vertical-capsule` | `748x896` | Vertical capsule | required; placeholder, a landscape card fitted into a portrait frame, replace with drawn art |
| `steam-library-capsule` | `600x900` | Library capsule | required; placeholder, same reason |
| `steam-library-logo` | `1280x720` | Library logo, transparent PNG | required; made from public/wordmark-dark.png |
| `steam-library-hero` | `3840x1240` | Library hero, key art with no logo | required; not made (see below) |
| `steam-page-background` | `1438x810` | Page background | optional; not made |

Not made by the script: the library hero (needs wide key art without the wordmark; there is none
in the repo), the page background (optional), the achievement icons, and the client and
community icons (the client icon is the .ico in src-tauri/icons; the community icon is 184 by 184,
check at submission).
