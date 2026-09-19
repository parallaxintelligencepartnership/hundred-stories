# Decisions

- 2026-09-18 | kickoff confirmed: a browser and PWA recreation of the 1994 SimTower ruleset with original art, named Hundred Stories | why: user approved the played-back summary in his own words ("We are Building a downtown skyscrapper of sorts, simulated internally the comings and goings of running and operating a tower") | instead of: n/a
- 2026-09-18 | versioning: builds and patches move as work ships, minor and major bumps only when Matt says so | why: kickoff default accepted | instead of: ad-hoc bumps
- 2026-09-18 | no accounts, no auth; saves in browser storage plus JSON export/import; leaderboard deferred as anonymous score post | why: Matt asked for a verdict; nothing in v1 needs a login and a login wall hurts a game | instead of: accounts for cloud saves and leaderboards
- 2026-09-18 | PWA with service worker so it installs and plays offline | why: Matt asked for downloadable offline play | instead of: plain static site
- 2026-09-18 | name Hundred Stories (slug hundred-stories) | why: Matt rejected Skylobby and asked for more creative; EA owns "Sim", Saito owns the Tower lineage | instead of: Skylobby
- 2026-09-18 | stack: TypeScript, Vite, PixiJS 8 WebGL renderer, DOM HUD, Vitest, pure deterministic sim core | why: Matt left the stack to me and asked for a showcase build; GPU sprites and filters give depth and lighting, pure sim core keeps it testable | instead of: Canvas 2D, React, a full game engine
