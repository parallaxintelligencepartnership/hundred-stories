# Hundred Stories

Hundred Stories is a browser game and installable PWA that recreates the ruleset of the 1994 tower simulation, with all new art. You run a skyscraper: build a lobby, offices, homes, shops, and elevators, and watch it fill with people over the years.

This is original work. It is not affiliated with, endorsed by, or connected to Electronic Arts, Maxis, or OPeNBooK.

## Play

Open the site in a browser. To start:

1. Build a lobby by dragging along the ground floor.
2. Drag an elevator shaft upward through the lobby to reach the floors above.
3. Place offices, homes, and other rooms off the shaft.
4. Press 1, 2, or 3 to set the simulation speed, or space to pause.
5. Click any room, car, or person to inspect it in the query panel.

### The star ladder

Your tower's star rating gates which rooms you can build. Each star needs a population and sometimes an extra condition:

| Star | Population needed | Extra requirement |
|---|---|---|
| 1 star | 0 | none |
| 2 stars | 300 | none |
| 3 stars | 1,000 | a security office |
| 4 stars | 5,000 | a hotel suite, a fair or better VIP rating, a recycling center, a medical center |
| 5 stars | 10,000 | a metro station |
| Tower | 15,000 | a cathedral and a wedding held there |

Reaching a star unlocks:

- **1 star**: lobby, stairs, office, condo, fast food
- **2 stars**: single room, twin room, suite, security office, housekeeping
- **3 stars**: sky lobby, escalator, restaurant, shop, cinema, party hall, medical center, parking ramp, parking space, recycling center
- **4 stars**: metro station
- **5 stars**: cathedral

## Rooms

Width is in tiles. Cost and upkeep are one time and per quarter dollars. Income is per quarter at full occupancy for rented rooms (shops, restaurants, and other commerce earn per visitor instead, so their income column is their typical quarterly take at full use). Capacity is tenants, guests, or seats.

| Room | Width | Cost | Income/quarter | Upkeep/quarter | Capacity | Placement |
|---|---|---|---|---|---|---|
| Lobby | 1 | $5,000 | $0 | $0 | 0 | Above ground |
| Sky lobby | 1 | $5,000 | $0 | $0 | 0 | Above ground |
| Stairs | 8 | $5,000 | $0 | $0 | 0 | Above or below ground |
| Escalator | 8 | $20,000 | $0 | $5,000 | 0 | Above or below ground |
| Office | 9 | $40,000 | $10,000 | $0 | 6 | Above ground |
| Condo | 16 | $80,000 | $0 | $0 | 3 | Above ground |
| Single room | 4 | $20,000 | $6,000 | $0 | 1 | Above ground |
| Twin room | 6 | $50,000 | $9,000 | $0 | 2 | Above ground |
| Suite | 10 | $100,000 | $18,000 | $0 | 2 | Above ground |
| Fast food | 16 | $100,000 | $9,000 | $0 | 35 | Above or below ground |
| Restaurant | 24 | $200,000 | $18,000 | $0 | 35 | Above or below ground |
| Shop | 12 | $100,000 | $15,000 | $0 | 25 | Above or below ground |
| Cinema | 31 | $500,000 | $30,000 | $0 | 120 | Above or below ground |
| Party hall | 24 | $100,000 | $60,000 | $0 | 50 | Above ground |
| Medical center | 26 | $500,000 | $0 | $0 | 0 | Above or below ground |
| Security office | 16 | $100,000 | $0 | $20,000 | 6 | Above or below ground |
| Housekeeping | 15 | $50,000 | $0 | $10,000 | 6 | Above or below ground |
| Parking ramp | 16 | $50,000 | $0 | $10,000 | 0 | Underground |
| Parking space | 4 | $3,000 | $0 | $0 | 1 | Underground |
| Recycling center | 25 | $500,000 | $0 | $50,000 | 0 | Underground |
| Metro station | 30 | $1,000,000 | $0 | $100,000 | 0 | Underground |
| Cathedral | 28 | $3,000,000 | $0 | $0 | 0 | Above ground |

Condos do not earn quarterly income; they are sold once for $150,000 when their eval is high enough, and go back on sale if a tenant leaves.

### Elevators

Shaft cost and car cost are one time. Upkeep is per quarter, per car. Speed is floors per minute.

| Elevator | Width | Shaft cost | Car cost | Upkeep/quarter/car | Capacity/car | Speed | Notes |
|---|---|---|---|---|---|---|---|
| Elevator | 4 | $200,000 | $80,000 | $10,000 | 21 | 4 | Max span 30 floors, up to 8 cars |
| Service elevator | 4 | $100,000 | $50,000 | $10,000 | 21 | 4 | Max span 30 floors, up to 8 cars |
| Express elevator | 6 | $400,000 | $150,000 | $20,000 | 42 | 8 | No span limit, up to 8 cars, only stops at lobby and underground floors |

## Saving

The game autosaves to a slot in your browser. You can also export your tower to a file and import it back later, on this device or another one. Once you install the app, it keeps working offline from the browser's cache.

## Develop

Requirements: Node 26.

```bash
npm ci
npm run dev       # start the dev server
npm test          # run the test suite
npm run build      # type check and build for production
npm run preview    # preview the production build locally
```

The code is laid out in five parts:

- `src/sim` is the simulation. It is pure and deterministic: no rendering, DOM, or randomness outside its own seeded generator.
- `src/render` draws the tower with PixiJS, reading the simulation state each frame.
- `src/ui` is the DOM layer: the top bar, palette, panels, and keyboard shortcuts.
- `src/game` is the shell that wires the simulation, renderer, and UI together and runs the game loop.
- `deploy` holds the scripts and compose files that ship the built site to pi3.

See `docs/DESIGN.md` for the architecture contract and `docs/VISUAL.md` for the visual direction.

The simulation is deterministic: the same seed plus the same list of commands always produces the same world hash. You can set the starting seed with a `?seed=` query parameter on the page URL, for example `?seed=42`.

## Deploy

See `deploy/README.md` for how the site is built and deployed to pi3.

## License

MIT. See `LICENSE`.
