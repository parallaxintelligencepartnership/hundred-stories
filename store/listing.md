# Store listing: the shared copy

The copy every store listing starts from. Per store fields, limits and screenshot sizes are in
[ios.md](ios.md), [android.md](android.md) and [steam.md](steam.md); the step by step is in
[SUBMISSION.md](SUBMISSION.md).

Voice rules (docs/VISUAL.md principles 3 and 4): the interface's voice, sentence case, US
spelling, no em dashes and no spaced hyphens used as dashes. Plain claims only, each one true of
the store build as it is in this repo.

Things the copy must not say:

- "Free", a price, or "no in-app purchases" as a selling line. Pricing is Matt's call and is not
  set anywhere in this folder.
- "Open source". The licence is PolyForm Strict 1.0.0: the source is public to read, and nobody
  may redistribute it, change it or ship it. A store build is distributed by the licensor, which
  the licence does not restrict. The listing grants nothing and names no licence terms.
- Another game's name, in the copy or the keywords. The landing page carries the homage and the
  not affiliated line; store metadata that names another app or trademark is a common rejection
  reason (App Store guideline 2.3.7), so the listings leave it out. Check at submission whether
  Matt wants the not affiliated line in the long description anyway.
- "Plays offline" without the font caveat below.

## Name

Hundred Stories

## Subtitle (30 characters at most)

Build a tower. Run it well.

(27 characters. It is the landing page's headline.)

## Short description (80 characters at most)

Build a skyscraper, keep your tenants happy, and climb from one star to TOWER.

(78 characters.)

## Promotional line (170 characters at most, App Store promotional text)

Every room, price, elevator limit and stress rule is tuned so a tower can fail. Tenants notice slow elevators, noisy neighbors and dirty rooms, and they leave.

## Long description

Build a tower. Run it well.

Hundred Stories is a tower-building simulation with pixel art drawn in code. Start with a lobby and a little cash. Place offices, condos, hotel rooms, shops and restaurants, run elevators up through the floors, and keep the people inside happy enough to stay.

A hundred stories is the height of a tower worth building. It is also what goes on inside one: the tenant on 40 who wants a quieter floor, the shop on 2 that lives on the lunch crowd, the hotel guest who missed the last express elevator and is not coming back. Every floor is a story. Everyone's got one.

Your tower can fail
Every room, price, elevator limit and stress rule is tuned so a tower can fail. Tenants notice slow elevators, noisy neighbors and dirty rooms, and they leave. Set the rent per room, give each elevator car its own floors and riders, and answer the events that arrive: a fire, a bomb threat, a VIP guest who rates your suite, cockroaches in a dirty hotel room.

Climb the star ladder
Earn stars as the tower grows. Each star opens new rooms: security, housekeeping, sky lobbies and escalators, a cinema, a metro station, and at the top a cathedral. One hundred stories is the ceiling.

Yours, and private
There is no account and nothing is tracked. Your tower is saved on your device as you play, and you can export it as a file whenever you like and import it on another device.

Touch, mouse or keyboard
On a phone or tablet: one finger moves, pinch zooms, tap to place. On a desktop: drag, scroll, or W A S D to move, and 1, 2, 3 or space to set the speed.

## Keywords

For stores that take a keyword list (the App Store field is 100 characters, comma separated, no
spaces needed):

    tower,skyscraper,building,simulation,elevator,tycoon,management,city,hotel,office,pixel,sim

(91 characters.) Steam uses tags instead, listed in steam.md.

## Category

- App Store: Games, primary subcategory Simulation, secondary Strategy.
- Google Play: Game, category Simulation.
- Steam: genres Simulation and Strategy (tags in steam.md).

## Age rating answers

What the game contains, as the questionnaires ask it. The build has no people harmed on screen,
no blood, no weapons shown, no language, no sexual content, no drugs, alcohol or tobacco, no
gambling, no user generated content, no chat, no web browsing, no purchases.

The events are the only content a rating board asks about. They are text alerts plus a room tint;
nothing is animated beyond a flicker:

- Fire: "Fire broke out in the office on floor 12." The room is tinted and flickers; security or a
  paid helicopter puts it out, or rooms burn down and are removed. Tenants move out. No one is
  shown hurt and no death is described.
- Bomb threat: "A caller planted a bomb in the office on floor 12. Pay the ransom or let security
  search the tower." If security finds it, it is taken away; if not, it goes off and nearby rooms
  are removed with a repair bill. No explosion is drawn, no one is shown hurt, and no death is
  described. This is a threat and property damage in text.
- VIP visit, cockroaches in a dirty hotel room, Santa flying past, a wedding in the cathedral:
  nothing a rating board asks about.

Answer the questionnaires from these facts:

| Question (as the stores word it, roughly) | Answer |
|---|---|
| Cartoon or fantasy violence | None |
| Realistic violence | None depicted. The bomb threat and fire are text alerts with property damage only; answer "infrequent or mild" only if the questionnaire counts a text reference to a bomb threat as violence (check at submission) |
| Prolonged graphic or sadistic violence, blood, gore | None |
| Horror or fear themes | None |
| Mature or suggestive themes | None |
| Sexual content or nudity | None |
| Profanity or crude humor | None |
| Alcohol, tobacco, drugs | None |
| Simulated gambling, real money gambling, contests | None |
| Medical or treatment information | None (the medical center is a room type with no medical content) |
| Unrestricted web access | No |
| User generated content, chat, sharing with other users | No. Share makes a picture of the tower and a link, and hands them to the system share sheet or the clipboard; the app posts nothing itself |
| Location | Not used |
| In-app purchases or ads | None |

The resulting rating is set by each store's questionnaire and is not asserted here: the fire
alone would be the lowest rating, and whether the bomb threat text lifts it (for example to 9+
on the App Store or Everyone 10+ under IARC) is check at submission.

## Privacy answers

What the app does with data, from the code in this repo:

- No accounts, no sign in, no server of ours.
- No analytics, no crash reporting, no advertising, no tracking, no third party SDKs in the app.
- The save is written on the device: the app data directory on iOS and Android (Capacitor
  Filesystem, one file), the app data directory on desktop (Tauri), IndexedDB in a browser.
- Export writes the tower as a file the player saves or shares through the system share sheet or
  file dialog. It is the player's own file and never reaches us.
- Steam (desktop, only in the build with the steam feature): achievements are reported to the
  Steam client on the player's machine. Steam's own data practice is Valve's.
- Network: the game requests its two typefaces from Google Fonts (fonts.googleapis.com and
  fonts.gstatic.com) when it opens. That request carries the device's IP address to Google like
  any web font request, and without a connection the game falls back to system fonts and still
  plays. This is the one network call the app makes. Check at submission whether the privacy
  forms need it declared; bundling the two fonts in the app removes the question (that is a code
  change, not made in this round).

Form answers that follow:

- App Store privacy label: Data Not Collected (see the font note above: check at submission).
- App Tracking Transparency: not needed, the app does not track.
- Google Play data safety: no data collected, no data shared; data is not encrypted in transit
  because none is sent (the font request is HTTPS); no account, so no deletion request path is
  needed. Check at submission.
- Steam: no privacy form in the store page; the privacy policy URL below covers it.

A privacy policy URL is required by Apple and Google even for an app that collects nothing.
There is no privacy page on the site today. Matt's call where it lives; the text can be the
"Yours, and private" paragraph above plus the font note.

## Support and contact

- Support email: hello@parallaxintelligence.ai (the address on the landing page).
- Developer name: Parallax Intelligence Partnership (the copyright line in LICENSE and in
  src-tauri/tauri.conf.json). The seller name on each store is the account holder's legal name
  and is set when the account is opened.
- Copyright line: Copyright 2026 Parallax Intelligence Partnership.
