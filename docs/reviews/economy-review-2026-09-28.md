# Hundred Stories money system review (adversarial, read-only)

Scope: repo at 390c3b7 (0.6.7), host arm64 (uname -m). Read in full: src/sim/economy.ts, rules.ts, build.ts, events.ts, people.ts, evaluation.ts, tick.ts, replay.ts, save.ts, stars.ts (money parts), world.ts (createWorld and helpers), src/game/game.ts, src/ui/status.ts. Read in part (money sections only, found by grep for cash, quarter, upkeep, income, rent, fire, bomb, gameOver): src/ui/ui.ts (lines 130-160, 250-340, 920-960, 1040-1075, 1480-1570), src/ui/panels.ts (880-1010), src/ui/alerts.ts (1-60, 150-455), src/ui/onboarding.ts (TIP_TEXT), how-to-play/index.html section B6. The rest of ui.ts and panels.ts was not read: layout, palette and non-money panels. .itworks/DECISIONS.md has no ruling on upkeep, fire damage, bomb damage, hotel income or bankruptcy, so none of the findings below cover a settled decision. Probes were scratch scripts run with `npx vite-node@6.0.0`: traj.ts, trajC.ts, fire.ts, fire2.ts and boundary.ts, all in this scratchpad. No repo tests were run.

## CRITICAL

**C1. With a security office, a fire burns the whole row it started in and then bills $20,000 for every room, so one lobby fire can bankrupt a profitable tower.**
- Where: src/sim/events.ts:206 (`outAt = startedAt + 45 * event.roomIds.length`), events.ts:166-183 (spread to every room with gap <= 1, every 30 min), events.ts:189-196 (destroy every burning room and charge `damagePerRoom` 20,000 each), rules.ts:26 (a lobby is a 1-tile room).
- Why: each 1-tile lobby segment on fire lights 4 more segments every 30 minutes (x±1 and x±2). Each new room pushes security's put-out time back by 45 minutes. So the put-out time runs away faster than the clock catches it, and security only puts the fire out once nothing in the row is left to catch. Then every segment is destroyed and billed. The fire picks its first room uniformly across all rooms (events.ts:100-106). Lobby segments are most of the rooms in a small tower (120 of 131 in F6), so most fires start in the lobby.
- Evidence from fire.ts and fire2.ts: tower A (10 offices, 1 shaft), with a security office, fire lit at day 1 10:00 in a lobby segment:
  - 45-tile lobby: out 2,026 min later, all 45 segments gone, cash -900,000, ground lobby gone.
  - 60 tiles: -1,200,000, cash -160,000.
  - 120 tiles: out after 5,401 min (3.75 days, and no arrivals the whole time), -2,400,000, cash 680,000 to -1,660,000. Game over on day 9, while every quarter line still read "profit $60,000".
- Failure: this is a player at 2 or 3 stars who did the "right" thing and built security (it is required for 3 stars). One routine fire costs millions, erases the lobby, and they cannot rebuild because cash is negative.
- One-line fix: stop tying security's put-out time to the room count, or stop the spread once security is on the floor, and reconsider billing $20,000 for a $5,000 lobby tile.

## IMPORTANT

**I1. Upkeep is never shown per room or per shaft anywhere, and the how-to-play page describes a daily charge that does not exist.**
- Where: economy.ts:47-60 fills `upkeepByKind`, and economy.ts:66-67 empties it in the same call. The Finances panel list "Costs this quarter so far" (panels.ts:938-967) therefore always reads "Nothing yet". The same goes for office rent under "Income this quarter so far".
- Evidence: traj.ts printed `upkeep {}` just before every settle in all runs. `lastQuarter` keeps totals only (economy.ts:65).
- Nothing in src/ui mentions upkeep (grep "upkeep" in src/ui: only the panel's own table). The build label shows the price only (ui.ts:137).
- how-to-play/index.html:204-206: "On the other days there is a smaller daily charge at the same hour." No such charge exists: onDayStart (economy.ts:90-92) only resets the population baseline. The line was copied from docs/DESIGN.md:49,66 (`chargeDaily`), which was never built.
- Failure: a player with 3 shafts of 8 cars sees "Costs last quarter $340,000" as one number and cannot find its source. The guide tells them a hidden daily charge exists, which is exactly the "hidden maintenance costs" report.
- One-line fix: keep last quarter's per-kind tables, show upkeep per car and per room at build time, and delete the daily-charge sentence.

**I2. Money lost to events is left out of the quarter accounting, and the fire card understates the cost.**
- Where: events.ts:196 (fire clearing), 247 (bomb), 687 (theft), 912 (ransom), 924 (helicopter) all write `world.cash -=` without touching `upkeepByKind`. The 05:00 line (economy.ts:69-72) and the Finances tiles report only rent and upkeep.
- Evidence: traj.ts "A + bomb" printed `last={"income":100000,"upkeep":20000,"net":80000}` at the same settle where cash went from 1,175,000 to -745,000. The player reads "profit $80,000. Cash: -$745,000."
- The helicopter button reads "Call a helicopter ($250,000)" (alerts.ts:266). The real charge is $250,000 plus $20,000 per burning room (events.ts:922-926). The affordability check only tests the $250,000, so the clearing fee can push cash negative. F2b: 45 rooms burning, cash 1,095,000 to -55,000, a charge of $1,150,000.
- The fire card closes with "Fire out, N rooms damaged" and no dollar amount (alerts.ts:152-154). The amount appears only in a News line.
- Failure: this is what "losing money and not sure why" looks like in the code.
- One-line fix: book event costs under their own quarter line, and show the dollar amount on the fire and bomb cards.

**I3. Hotel income is 1/15 of what its table says, because the nightly fraction assumes 45 nights in a quarter and the game's quarter has 3.**
- Where: rules.ts:219 `hotelNightlyIncomeFraction: 1 / 45, // 45 nights a quarter at good occupancy`, against events.ts:19 and types.ts:433-436 (a 3-day quarter).
- Evidence: a twin room tops out at 9,000/45 × 3 nights = $600 a quarter, against `incomePerQuarter` 9,000. In trajC.ts, 6 twins earned $1,600 to $3,200 a quarter, while the housekeeping they need costs $10,000 a quarter. The hotel wing cost $350,000 and loses about $7,000 every quarter.
- Failure: players who build hotels lose money every quarter with no visible reason. The room panel says "$200 per night", which sounds fine.
- One-line fix: derive the fraction from the real nights per quarter, or rescale hotel income against upkeep.

**I4. A fire with no security office and no helicopter never ends. Commerce and hotel income stop for good, and below $100,000 the player cannot escape.**
- Where: events.ts:203-216 has no end path without security. people.ts:132-138 and 299-306 hold every arrival outside while any fire burns.
- Evidence: F1 and F5 were still burning at day 25.
- Offices kept paying because rent ignores fire. A shop, food or hotel tower earns nothing from commerce or hotels while upkeep continues.
- With cash under $250,000 the helicopter is refused (events.ts:923). With cash under $100,000 a security office cannot be built. Demolishing a burning room is refused (build.ts:520).
- Failure: a 2-star tower that got low on cash freezes and bleeds until the bank takes it.
- One-line fix: give an unattended fire an end, for example it burns out after N hours.

**I5. The bankruptcy rule is never shown, and the recovery window is one quarter.**
- Where: economy.ts:74-83 with rules.ts:221-222. No UI surface mentions -$500,000, the streak, or a warning (grep badQuarterStreak and bankruptAtCash in src/ui and src/game: none). how-to-play only says "you run out of money and the bank takes the tower".
- Game over lands at 05:00 inside the 8x night.
- Arithmetic: a tower at cash C < -500,000 must climb back above -500,000 at the very next settle. With the +$80,000 a quarter of tower A, that is only possible from above -580,000. Every hole from C1 or a bomb is unrecoverable.
- Failure: "got in the hole 500k and never could get out". The player has one quarter and does not know it.
- One-line fix: warn at the first bad quarter with the rule and the deadline.

## ADVISORY

- **A1. The office rent scale barely reacts to elevator service.** It samples `room.eval` from the 04:30 evaluation (tick.ts:17-18). By then workers have been home for hours and their stress has decayed to 0 (people.ts:663-667). Every office in every run was 1.00 at settle. Only noise and the rent setting move rent.
- **A2. Upkeep is not prorated.** A car added at 05:00 on day 0, just before the settle tick, pays its full $10,000 at once (boundary.ts: 1,265,000 - 80,000 - 10,000 = 1,175,000).
- **A3. A new office can wait almost two quarters for its first rent.** Offices lease only on a weekday between 08:00 and 09:15 (people.ts:142-156). The settle runs at 05:00 on day 0, before that window. So an office built after 09:15 on weekday 2, or on the weekend, gets its first rent at the second settle: up to about 5.9 game days, about 10.7 real minutes at 1x.
- **A4. The quarter line is quiet.** It is an info line, so it goes to News only and never toasts (ui.ts:1503-1508). The firstRent tip fires once, and only if income was above 0 (ui.ts:1066-1070).
- **A5. The status bar's quarter delta counts construction.** It is `cash - quarterStartCash` (status.ts:25-34), and createWorld starts it at the starting cash (world.ts:26). After the opening build it reads "-$905,000 this quarter" in red.
- **A6. The bomb card invites a needless $500,000 ransom.** It offers the ransom (alerts.ts:370-384, 410) without saying that a working security office always finds the bomb. The search ends at 06:00 plus 3 min per built floor, which is before the 13:00 detonation at any height the lot allows (events.ts:259-273).
- **A7. No path to a NaN cash was found.** eval is clamped and a NaN becomes 0 (evaluation.ts:20-23). rent is validated (build.ts:832, save.ts:317-322), and so are the stats tables (save.ts:549-552). If cash ever did become NaN:
  - it would show as "$NaN";
  - spend() would never refuse, since `NaN < x` is false;
  - bankruptcy would never fire;
  - serialize writes `"cash":null`, and the loader rejects that as "This file is not a Hundred Stories save." (boundary.ts). The autosave would overwrite a good save with an unloadable one.
- **A8. Offices keep paying rent they should not.** It continues with the ground lobby destroyed (F2b), and while a fire keeps the workers outside for good (F1). This is in the player's favour, but inconsistent.
- **A9. Nothing is refunded.** doDemolish (build.ts:515-552), doDemolishShaft (602-614) and doRemoveCar (708-723) return no cash, and shaft extension is free (619-622). This is presumably by design. It is listed so the owner knows there is no cash lever.

## Answers to the seven questions

**1. The quarter settle cannot fire twice or be skipped.**
- tick.ts:18 runs it on the exact minute (day 0, 05:00) and tick.ts:21 advances one minute per tick, so no speed skips a minute.
- The loop drops whole ticks rather than minutes: drainTicks (game.ts:176-201), with dt capped at 1 s (game.ts:352). A hidden tab loses time; it never skips the settle.
- boundary.ts saved and reloaded at settle-1, settle and settle+1. All three had the same cash, one settle line each, and the same hash as the uninterrupted run.
- A replay with a command logged on the settle minute verified as `match`.
- Only game over stops settles (tick.ts:12).

**2. NaN:** not reachable. See A7.

**3. Offices.**
- An office leases on a reachable weekday morning between 08:00 and 09:15 (people.ts:142-156). It never leases on the weekend. It is vacant from build (build.ts:347-368).
- eval at settle was 1.00 in every run, so rent is exactly $10,000 a quarter (economy.ts:33-36). That equals one standard car ($10,000) and half an express car ($20,000).
- An office costs $40,000, so it pays back in 4 quarters, about 21 real minutes at 1x (a quarter is about 5.4 minutes at 1x and 1.3 at 4x).
- An 8-car shaft costs $80,000 a quarter, the rent of 8 offices.

**4. Events.**
- Bomb detonation: -$2,000,000 flat plus the 4 nearest rooms destroyed (events.ts:241-251). The bomb is rolled at 3 stars or more at 0.8% a day, 2.38% a quarter. It is harmless with a working security office. The ransom button is enabled only with cash of at least $500,000. Tower A, which reaches about $1.1M, could pay it.
- Fire:
  - no security and no helicopter: $0 cost, but it never ends (I4);
  - helicopter: $250,000 plus $20,000 per burning room. F2: 5 rooms after 60 min, $350,000. F2b: 45 rooms after 12 h, $1,150,000;
  - security: $20,000 times the whole connected row (C1). F4: an office floor, 5 rooms, $100,000, and rent fell $50,000 a quarter.
- Theft: -$2,000, at most once per 3 days, from 3 stars (events.ts:685-699).
- One event can take a healthy tower below -$500,000: the bomb (A dropped to -745,000), or a security-attended lobby fire of more than about (cash + 500,000) / 20,000 segments.

**5. The debt trap.**
- Nothing can be bought while cash is below the cost: spend() and the can* checks (economy.ts:24-30, build.ts:426, 459, 697).
- Levers that cut upkeep: remove cars (-$10,000 each, or -$20,000 express, keeping at least 1); demolish shafts; demolish upkeep rooms (security $20,000, housekeeping $10,000, parking ramp $10,000, escalator $5,000, recycling $50,000, metro $100,000).
- Levers that raise cash: office rent at 150%. The eval drops to 0.7, so rent becomes 10,000 × 0.85 × 1.5 = $12,750. Hotel and condo rent can go up the same way, and commerce and condo income keeps coming in.
- Game over: tick() and advance() stop (tick.ts:12, game.ts:355). A card with no close button offers New tower and Open a saved file (alerts.ts:7-8). A dead tower cannot keep running, and the save keeps it dead (save.ts:706).

**6. Visibility.**
- The cash readout updates on every tick batch (status.ts:347). An offices-only tower's cash is flat all quarter and jumps once at 05:00 during night speed.
- The delta shows spending since the settle (A5).
- Itemisation exists only as totals: the News line and the Finances tiles. Per-kind upkeep is never shown (I1). Event costs are missing from the totals (I2).

**7. Trajectories.** Cash at each 05:00 settle; income and upkeep are last quarter's totals.

A) Lobby 45, 1 shaft with 2 cars, 10 offices. Build cost $905,000, cash after build $1,095,000.

| Settle (day) | Cash | Income | Upkeep | Net |
|---|---|---|---|---|
| Q1 (d3) | 1,175,000 | 100,000 (office) | 20,000 (standard) | +80,000 |
| Q2 to Q8 | +80,000 each settle, ending at 1,735,000 | | | |

B) A plus 3 standard shafts with 8 cars each and an express with 4 cars. This costs $4,035,000 and needs 3 stars for the express, so it is unaffordable at the start. The run forced the build and set cash after build to A's $1,095,000.

| Settle | Cash | Income | Upkeep | Net |
|---|---|---|---|---|
| Q1 | 855,000 | 100,000 | 340,000 (standard 260,000, express 80,000) | -240,000 |
| Q5 | -105,000 | | | |
| Q7 | -585,000 (streak 1) | | | |
| Q8 | -825,000 (streak 2), game over day 24 | | | |

B-real: the same clicks with $2,000,000 at 1 star. The express and the last shaft were refused. Cash after build was $55,000, upkeep $120,000 against income $100,000, so -$20,000 a quarter: cash went 35,000, 15,000, -5,000 and on down to -105,000 at Q8. It never reaches bankruptcy inside 8 quarters, and nothing can be built.

C) Lobby 60, 1 shaft (floors 1 to 6) with 2 cars, 4 shops, 2 fast food, 2 condos, 6 twin rooms, housekeeping. Stars were forced to 3 for placement and fell back to 1 by population. Cash after build $310,000.

| Settle | Cash | Income by kind | Upkeep |
|---|---|---|---|
| Q1 | 682,112 | condo 300,000, shop 88,320, fast food 12,192, twin 1,600 | 30,000 (cars 20,000, housekeeping 10,000) |
| Q2 | 755,440 | shop 88,380, fast food 12,348, twin 2,600 | 30,000 |
| Q3 to Q8 | about +72,000 each settle, ending at 1,193,648 | twin 2,000 to 3,200 each quarter | 30,000 |

A plus a bomb planted day 4 at 06:00, no security, ransom not paid: Q1 1,175,000. At Q2, cash 1,255,000 less 2,000,000 gives -745,000 (streak 1), while the settle line read "profit $80,000". Q3 -665,000 (streak 2): game over on day 9.

## Questions for the owner
- Is $20,000 per destroyed room meant to apply to 1-tile lobby segments ($5,000 to build), and should security let a whole row burn before acting?
- Is a one-quarter recovery window below -$500,000 the intended difficulty?

## What the players most likely hit

Offices really do pay, but only $10,000 each per quarter. That is the same as one elevator car, and it lands once, at 5 AM on the first day of a quarter, while the clock races at night speed. Between those moments the cash number does not move, and a newly built office can wait almost two quarters for its first rent. That is "currency not counting up" and "offices didn't seem to generate money": working as designed, but thin and invisible.

The "hidden costs" feeling is partly real bugs:
- Upkeep is never itemised anywhere in the game.
- The Finances panel's cost list is permanently empty.
- The how-to-play page describes a daily charge that does not exist.
- Hotels earn 1/15 of their table value, so a hotel wing loses money every quarter.
- Fire and bomb costs are left out of the quarter's "profit" line.
- The fire card never shows a dollar figure, and its helicopter price is understated.

"In the hole 500k and never got out" is best explained by a fire at 2 or 3 stars. With a security office, the fire burns the whole lobby row and bills $20,000 a tile, which can be millions and makes the lobby vanish. The bank then gives one quarter to recover, a rule the game never states. Elevator-heavy towers (8 cars is $80,000 a quarter) drift negative slowly too, and nothing can be built or refunded once cash is below zero.

In short: the thin, lumpy income is design; the missing itemisation, the hotel fraction, the fire mechanics and the unstated bankruptcy rule are bugs.
