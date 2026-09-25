# Fix review, audit 2026-09-25 remediation

The branch moved from 8a5ef3e to e04a2de (P9, P9b, P10) while this review was running. I re-ran every probe and revert that touches src/game on e04a2de. The results were the same on both commits. All runs were on pi2 (DEST=hs-test). Raw output is in remote/, mutres*.txt and revres2.txt.

## Probes
| Probe | Finding | Result | Evidence |
|---|---|---|---|
| probes-A p1, p4, p5; verifyA v2, v3, v4 | A S1-S4, S6-S8 | fixed | "Put the fire out first.", "Deal with the bomb first.", recycling -3 and metro -4 ok, "Build the floor above this one first.", {0,1} refused, "Lobbies", "-$30,000" |
| verifyA v1 | A S1 | stale-adapted | Demolish was refused 171 times ("Put the fire out first."), so the original crashed on an undefined target |
| probes-A p2 | determinism | holds | c30ac173 on both runs |
| probeB p1-p5; verifyB s1, s2, s4, s4h, s5 (quiet and busy), s6, s78 | B S1-S8, new S2 | fixed | office vacant, income 0; setStop refused; ff occupancy 0; rider off at the next door; VIP outside, no thief |
| verifyB s3 | B S3 | could not reproduce the setup | setStop was refused (another rider was bound for floor 3). probeB p5 covers the case: the sim is gone |
| probeC probe, roach, control; probeD roach; verifyD s2b, s2verify | C S1-S7, D S2 | fixed | hashes equal; "Thieves: 1 caught, 1 got away"; verifySave match (was a mismatch) |
| probeD fuzz, one (15 mutations), old; verifyD s5 (6 mutations); probeD sw | D S5 | fixed (one, s5, sw path-adapted) | every audited mutation refused in 7-21 ms; v1-v5 load. sw now stops at the refusal |
| probeD idb, race, importdaily; verifyD race2 (both orders), n1, s11; verifyNew n1; storage-verify.test | D S1, S3, S4, S6, S11, new S1 | fixed | autosave keeps seed 11; readSave gives 5000; abort settles; ['ok','ok'] |
| verifyD s7 | D S7 | fixed (adapted) | Switch refused, 11 tiles in hand, one warn. The final "1 tile" line only comes from calling openMyTower from inside My tower, and the UI hides that entry |
| verifyD s8 | D S8 | PARTIAL | see below |
| e1probe (3) | E1 S1-S3 | fixed | no replayed cards; prefs held; one card |
| f1probe P1-P4; n5.test | F1 S1-S8, F2 S2, F3 S1, S2, S4, new S5 | fixed | P4 is stale: it calls pickSimAt without drawnAt |
| verifyNew n4.test | new S4 | fixed (adapted) | 192 x 4608 px pieces |
| laneG, verifyG probe | G S1-S5 | fixed | laneG P2 had to be adapted to one timer step |
| verifyG n1, verifyNew n6 | new S6 | stale-adapted | the fake world needed a fire event; the drone is back |
| verifyNew n2, n3 | new S2, S3 | fixed | population 0; the $20,000 is charged |
| probes-A p3, probeD mkbase | none | not run | an owner question, and a generator |

## Mutations (tests/sim unless noted)
All RED: 1a, 1b, 2a, 2c, 5a-5d (build); 2b, 11a (cars); 2d, 2f, 6a, 6c (events); 2e, 3a, 3b, 14b (first-tower); 4a-4c, 11b-11e (stars); 7a, 7b, 8a, 8c, 8e (save); 8b, 8d (recycling); 9a-9e (demo-cap); 10a (replay); 11f (people); 12a (security); 13a (story-worker). Every .old still matches src exactly once. 13a applied at an offset of 14 lines on e04a2de.

GREEN, none of them claimed by a closure:
- 6b: the audit already called it not a real break.
- 7e, 7f: harmless now that deserialize sorts by id.
- 10b: replay and replay-start.
- 14a: people; the audit called it harmless.

## CRITICAL reverts (e04a2de)
| Line | Patch | Test | Result |
|---|---|---|---|
| daily date moved back | reverts/R1-daily | shell-audit | RED (3) |
| housekeeper population | R2-housekeeper | stars | RED (9 vs 6) |
| roach timer saved | R4-roachsave | save-roach | RED (hash) |
| IDB fallback read | R5-idbstamp | storage-audit | RED (3) |
| damaged save | R6-shaftwidth | save | RED |
| office reach | R3-officereach | office-reach | **GREEN** |

R3 is a guard gap. With the class-aware lease gate removed, office-reach.test stays green. verifyB s1 under the same patch shows a lease and a "had no way in, so its tenants moved out" line every few minutes. The move-out path hides the missing gate.

## Not fixed (partial)
- D S8. `saveWhenIdle` (game.ts:414) drops a call while a save is still in flight, and nothing schedules a follow-up save when that one finishes. s8b (a deferred idle and a 50 ms IndexedDB write) printed: `B build, then another 10 ms later during the write: in hand 13 on disk 12 (after 2 s paused, no hide event)`. The original s8 printed: `in hand lobby tiles 11 | on disk rooms 2`. The tower stays dirty, so a pagehide or hide event saves it later. It is only lost if the page dies without one of those events.

## Could not run
- verifyB s3: another rider was bound for floor 3, so the stop was refused before the stranded wait could start. probeB p5 covers the same case.
