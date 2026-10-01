# Hundred Stories game-readiness review: agent handoff

Date: 2026-10-01  
Reviewed target: `50deb78e66172e502e17d0647befd1ed6c1e2fd0`, version `0.6.12`  
Method: three delegated Sol reviewers covering player experience, simulation/staff, and reliability, with the orchestrator independently inspecting the principal findings.

## Read this first

Hundred Stories needs a coordinated game-experience and reliability pass. The simulation has substantial working systems, but important information is difficult to recover, some interactions remove the player's ability to respond, and several save and staff paths have concrete defects.

The review was READ ONLY. No tests, builds, Colima, deployment, or code changes occurred. The owner subsequently explicitly requested this handoff file. Live-site access failed in the review environment. Source-confirmed means established by inspection of concrete code paths, not reproduced through played interaction or executed tests. Device and visual conclusions remain subject to verification.

The website is already deployed and has real visitors. iOS is awaiting App Store approval. Android has not been submitted. Steam is on hold, has never been tested, and is OUT OF SCOPE. Do not treat this document as authorization to implement or deploy; obtain the next agent's task scope from the owner. No Colima tests were authorized in this review.

Read current `.itworks/DECISIONS.md` before implementation. This is a SimTower-style, offline-capable tower-management game. Preserve meaningful congestion and its consequences. Earned stars never fall. Elevator rider settings mean priority, not exclusivity; leftover and passing pickups are intentional. Avoid generic live-service recommendations.

Line references below describe the reviewed commit and may move. All paths are relative to the repository root.

## Explicit owner requirements

- **Stories and News are one feature.** They changed names during development. Consolidate the incomplete rename into **Stories**; do not create competing destinations called News and Stories.
- VIP arrival needs a deliberate game alert; departure needs a substantial result/rating card with the guest's information.
- Tower-problem toasts currently feel worthless. Explain the problem and provide an actionable destination.
- Some items opened through Build seem to open from the Menu button. Verify specific examples visually and correct ownership/positioning.
- Center the **icon-and-label group** inside each pause-menu button.
- Include the existing video clips in the menu.
- Add **Save and exit**, which saves before presenting a custom exited screen using the game's logo/graphics.
- Review actual housekeeping, guard, and garbage-collector behavior, plus technical resource cleanup.
- Identify immediate failures, latent problems over roughly three months, and missing features appropriate to a finished management game.

The owner reports severe elevator congestion and mass fleeing tenants, while acknowledging that congestion consequences are expected. Do not remove those consequences merely to make warning counts smaller.

## P1: functional defects and save protection

### F1. Update Reload proceeds after saving fails

Status: source-confirmed.

Evidence: `src/ui/ui.ts:2359-2361` reloads in `finally`, including rejected flushes. `src/game/game.ts:1201-1205` discards the result from `saveWorld`; `game.ts:613-616` catches write failures and resolves `{ok:false}`.

Trigger: a dirty tower, storage refuses the next write, and the player chooses Reload for an update. Saving fails but reload proceeds, losing recent changes. Read-protected stand-in worlds can also leave without preservation.

Recommendation: return and check an explicit flush result. Hold the clock/input while saving for a transition so edits cannot occur after the snapshot. Failure retains the current tower and offers retry/export. Reuse this corrected contract for Save and exit.

Acceptance: deferred success saves the final permitted state before one reload; rejection or `{ok:false}` causes no reload and leaves the tower available. Existing update tests cover successful ordering with a fake flush, not the complete failure path.

### F2. Import abandons an outgoing tower before knowing its save succeeded

Status: source-confirmed.

Evidence: `src/game/game.ts:1254-1273` checks the previous `lastSaveFailed`, launches `void saveWorld('quiet', slot, world)` at 1264, and immediately switches slot/world. Normal transitions await `readyToLeave` at 709-713.

Trigger: dirty daily/friend tower, earlier saves succeeded, next write fails, valid file imported. Import returns success before the outgoing save fails. Its latest changes are no longer available in memory or storage. UI accessibility of each slot's import route should be verified; the API path is defective regardless.

Recommendation: make import use the serialized transition and await outgoing save success.

Acceptance: delayed/rejected outgoing write preserves the old world and slot with export available. Successful import preserves outgoing-slot isolation.

### F3. Concurrent browser sessions silently overwrite progress

Status: source-confirmed last-writer behavior; product support policy needs defining.

Evidence: `src/game/storage.ts:196-214` assigns a newer save sequence and `storage.ts:254-293` replaces the whole slot without comparing the revision originally loaded. Game visibility/pagehide handling can save automatically. No single-writer lock or conflict detection was found.

Trigger: A and B load My tower S. A advances and saves S_A. B still holds its divergent S_B and later saves or hides. B obtains a newer sequence and replaces A's progress. Browser/PWA combinations matter where storage is shared.

Recommendation: one active writer per slot or an atomic loaded-revision check, with stale-session export/reload choices.

Acceptance: after A saves, B cannot silently overwrite A through either manual or background saving. Existing fallback sequence tests do not prove stale-world conflict safety.

### F4. Dismissing fire/bomb cards removes the only response buttons

Status: source-confirmed interaction defect. Dismissal itself is intentional.

Evidence: `src/ui/alerts.ts:249-257` removes card/body but retains the active incident. Synchronization at 375-377 and 471-475 does not recreate a dismissed active card. Helicopter/ransom controls exist only in the cards at 329 and 430. `src/ui/news.ts:55-67` still recommends those actions, but the older News panel only supplies text/camera links.

Recommendation: keep toast dismissal while preserving current incidents and command buttons in the unified Stories destination. Do not fix this by repeatedly reopening a dismissed toast; existing tests intentionally prohibit that.

Acceptance: close either alert, reopen Stories, and respond without reloading. Controls update for cash, resolution, and security state.

### F5. One unreachable dirty hotel room starves reachable cleaning work

Status: source-confirmed.

Evidence: `src/sim/people.ts:938` selects the first unclaimed dirty room; `assignCleaning` at 986-987 returns false if routing fails. The next keeper chooses the same room. `dirtyHotelRooms` retains room iteration order.

Trigger: an earlier-built dirty hotel becomes unreachable while a later dirty hotel remains connected to housekeeping. Idle keepers repeatedly fail the first assignment. Reachable rooms stay dirty and cannot resume bookings. No failed-assignment explanation is emitted.

Recommendation: try further unclaimed rooms until finding a reachable job; expose inaccessible work without flooding alerts.

Acceptance: reachable room cleans despite an earlier unreachable room; restored access cleans the remaining room; blocked work has a visible reason.

### F6. Idle housekeeping office becomes demolition-locked

Status: source-confirmed.

Evidence: `src/sim/people.ts:947-953` hires six keepers and increments office occupancy. `src/sim/build.ts:535` refuses occupied demolition. With no dirty rooms, `people.ts:928` returns and staff remain inside indefinitely. Guards/collectors do not count toward their home-office occupancy in the same way.

Recommendation: allow demolition when occupants are exclusively that office's staff and clean up their room/car membership correctly. Preserve occupied tenant-room protections and actual hotel-cleaning occupancy.

Acceptance: build housekeeping, tick, remove it, receive the correct refund, and leave no orphan staff or passenger references.

### F7. Party hall event income is paid per attendee

Status: source-confirmed integration defect.

Evidence: `src/sim/people.ts:227-241` spawns up to 50 attendees. Each arrival calls `recordVisit` at 620. `src/sim/economy.ts:254-255` credits `partyHallIncomePerEvent`, $15,000, each time. `src/sim/rules.ts:46` prices the hall at $100,000 with no upkeep.

Result: 50 arrivals produce $750,000 for one party. Multiple halls magnify this. The test named “per event, not per visitor” in `tests/sim/economy.test.ts` invokes `recordVisit` only once and misses the crowd integration.

Recommendation: pay once per occurrence. Specify whether payment requires the first attendee or the scheduled event itself, and reconcile displayed income expectations.

Acceptance: 1, 25, and 50 actual attendees do not multiply one event payment; later parties pay once each; save/reload cannot duplicate a payment.

### F8. Evaluation eviction overwrites a passenger's physical travel state

Status: invalid transition source-confirmed; duration and permanent-stall consequences require reproduction.

Evidence: `src/sim/evaluation.ts:153-169` sets tenants to leaving and clears routes without resolving `inCarId` or car passenger membership. `src/sim/people.ts:833-850` already has a safe `sendAway` path using `letOffAtNextStop`. `runLeaving` plans from the old boarding position. Elevator waiting checks reject a sim with non-null `inCarId`, while alighting at `src/sim/elevators.ts:532` consults the overwritten route.

Trigger: a room stays below evaluation threshold for a full day and an hourly evaluation evicts a tenant while riding. A lunch journey can have a different original destination from the replacement exit route.

Do not claim every case jams permanently: a ride already headed to the lobby can heal when the car opens there. A different destination can retain a ghost seat until a compatible opening. Idle return does not itself open the doors.

Recommendation: route evaluation departures through the safe departure primitive while removing lease membership.

Acceptance: inward/outward/lunch evictions preserve passenger invariants each tick and eventually release evictees. Existing eviction scenarios cover demolition/fire/bombs, not this evaluation path.

## Game experience work

### G1. Complete the Stories consolidation

`src/ui/ui.ts:1876` opens Stories, whose `storiesBody` at `src/ui/panels.ts:1435` contains following/history/milestone actions. Toasts open `panelKind='log'`, built as News at `panels.ts:1258`. Operational needs and the substantial VIP card live in this older path (`panels.ts:1308-1333`).

Treat this as an incomplete rename/consolidation, not two intentional products. One persistent Stories destination should contain current incidents/actions, transport/service problems, active VIP and previous result, followed people, history, and milestones. Toasts should deep-link to the relevant item. All information must be reachable from a quiet screen without waiting for another toast.

### G2. Replace warning-event counts with actionable diagnostics

`src/ui/ui.ts:1629-1684` counts warnings and combines mixed messages into “N problems in the tower” after a throttle. That is a count of buffered warning events, not distinct current problems. `src/ui/news.ts:42` only models fire, bomb, infestation, and money. It can say “Nothing needs you right now” during unresolved transport issues.

Show cause, location, consequence, and action: affected floors, oldest waits/current queues, delayed people, and Inspect elevator/Show floor actions. Historical move-outs belong in history unless their cause remains active. Clear resolved issues. Infestation cards should include existing housekeeping guidance. Older alerts currently hide behind a plain noninteractive “and N more” paragraph (`alerts.ts:215,237-244`); make them recoverable through Stories.

### G3. Give VIPs a complete event experience

Reuse `src/ui/vip.ts:159` and saved `lastVip` data. Booking/final ratings are generic persistent alerts (`src/sim/events.ts:436,510`); arrival/check-in become replaceable four-second news toasts. The substantial checklist/result exists but is buried in the older News path.

- Booking: identity, arrival time, reserved suite, live preparation checklist.
- Arrival: recognizable guest presentation and View guest/View suite actions.
- Departure: prominent rating, wait/suite/safety explanation, progression consequence, next opportunity.
- History: result recoverable after dismissal and reload.

Successful ratings should not look like generic red trouble warnings. Do not duplicate scoring logic in presentation.

Additional misleading wording: “cares most about” a generated preference does not change the rating. `events.ts:470` always takes the worst of wait, suite, and safety. Make the preference meaningful or frame it as characterization without implying different scoring.

Suite selection (`events.ts:381`) chooses the first clean empty suite without preferring reachability. A disconnected first suite can be booked despite a connected alternative. Evaluate preferring reachable suites; classify this as a gameplay improvement, not an established pathfinding bug.

### G4. Give construction and inspection explicit ownership

No palette callback was found incorrectly opening Menu. The concrete path Build → Tools → Look → existing room/elevator mounts a query through the shared sheet. Desktop `.hs-sheet` is fixed beneath the top controls at the right edge (`src/ui/ui.css:1436-1444`), independent of the invoking control. This explains the apparent Menu origin but does not visually reproduce the owner's exact item.

Keep selected category/tool visible for construction; connect inspectors to the selected entity; use consistent game-card styling for rooms, elevators, and construction. Preserve the existing placement chip's relationship to the ghost (`ui.ts:1317-1342`). Verify desktop/tablet/phone examples before calling this a wiring defect.

### G5. Reconcile panel behavior when the viewport changes

`src/ui/sheet.ts:332-343` determines card/sheet mode, backdrop, and `aria-modal` only at mount. CSS changes layout at 900px separately. Resizing an open panel can leave keyboard/modal behavior inconsistent with its appearance.

Update mode on the same breakpoint transition without losing typed text or panel state. Verify both directions with the panel kept open.

### G6. Center pause-button icon/label groups

Explicit owner requirement. `src/ui/ui.css:4156-4159` left-aligns pause items, and shared `.hs-face` at 4399 uses flex without centering justification. `src/ui/pause-menu.ts:387-390` appends icon and label directly.

Center the group as a unit, including changing Save states. Check desktop, narrow screens, larger text, and long labels; avoid unintended changes to settings rows that need separate labels/controls.

### G7. Add Clips and a trustworthy Save and exit flow

Both are absent from `pauseEntries` (`src/ui/ui.ts:1847`).

Save and exit: pause/prevent changes → await durable save success → branded exited screen → Continue tower/New tower/Clips. Failed saving keeps the current tower and offers retry/export. Preserve held/unreadable-save protections. Browser exit means leaving gameplay for this screen, not forcibly closing the browser. Save to the platform's local slot/file; do not assume a browser can silently overwrite an arbitrary user-exported file.

Clips need loading/failure handling, preserved progress, and an explicit native/offline strategy: current app builds exclude website trailer assets. Do not simply add a relative website link that fails inside an app shell.

## Staff behavior and balance

| Role | Real effects | Limits and presentation needs |
|---|---|---|
| Housekeeping | Physically routes to hotels, cleans dirt, clears infestation, restores booking eligibility. | Fix F5/F6; expose jobs, blocked routes, idle reasons. |
| Guards | Patrol and physically respond to theft; interception prevents loss and mess. | Fire/bomb outcomes use an intact security-office timer regardless of guard arrival. Explain the distinction or redesign deliberately. |
| Collectors | Route to waste rooms, collect, carry loads, return/unload; backlog dirt and unreachable-floor reporting exist. | Measure endgame throughput and make workload/blocked service visible. |

`src/sim/events.ts:170-173` explicitly says fire/bomb guard travel does not determine the outcome. A disconnected intact security office still protects the tower. Preserve settled timing rules unless the owner requests a mechanics change; do not imply physical response determines success when it does not.

**Recycling incentive concern:** `src/sim/recycling.ts:406-412` clears waste state when no center exists. With stars permanently retained, removing the center after earning the required star eliminates sanitation obligations and upkeep. This is a design/balance decision. Do not address it by making earned stars fall.

**Rejected overclaim:** one reviewer compared a maximum of eight collectors and 1,920 optimistic daily room visits against 2,500 offices and inferred inevitable backlog. That proof is invalid: a visit can collect multiple days' waste (`recycling.ts:259`), and backlog has thresholds/grace time. Keep endgame sanitation as a scenario to measure, not a confirmed unavoidable failure.

Expected elevator congestion should remain consequential. Ordinary waits increase stress; failed trips and persistently poor conditions drive departures. Priority cars carrying leftovers/passing riders are intentional. Routing is structurally based rather than live-queue-aware; repeated selection of an overloaded route is a design limitation, not proof of cache corruption.

## Reliability and three-month risks

### R1. GPU context recovery may leave structural art blank

Strong source/dependency trace, runtime unverified. `src/render/art.ts:1959-1971` creates generated RenderTextures, destroys their drawing source, and retains the texture cache. Inspected Pixi context restoration removes GPU allocations; resource-less textures have no retained drawing to upload. No application rebake path was found.

Force actual WebGL loss/restoration with a populated tower. Verify shells, slabs, shafts, people, further building, and saving. Reconstruct generated textures or rebuild rendering from the current world. Fake 2D-canvas recovery tests do not establish WebGL recovery.

### R2. Replay/save history grows with continued play

Growth confirmed; unacceptable performance or a three-month failure threshold not established. `src/sim/buildlog.ts:231,236-242` appends commands/checkpoints; serialization carries the accumulated history. Ordinary news/story bounds do not bound replay history.

Measure representative long use, export size, serialization pauses, heap, and fallback quota. Establish budgets before choosing compaction or bounded replay segments. Preserve the playable tower and save compatibility.

### R3. IndexedDB connection lifecycle lacks explicit management

`src/game/storage.ts:82` opens fresh connections. No application `db.close()` was found; sequence reads and saves open separately. No blocked/stalled-open deadline was found. Impact and browser reclamation behavior were not measured.

Use managed reuse/recovery or close connections after transactions. Verify counts/resources plateau over repeated saving. A stalled open must remain distinguishable from an empty slot.

### R4. Native interrupted-save durability remains unproven

`src/game/storage.ts:397-418` delegates directly to Capacitor writeFile on the active filename, without application-level serialization, promotion, or previous-good backup. Several save callers can overlap. The inspected wrappers delegate actual writes to native ION libraries whose atomicity was not established. **Do not claim proven file corruption.**

Game lifecycle handling uses visibility/pagehide; native delegates provide no additional application-specific save coordination. Test real release builds on devices: background/force-kill during a large save, immediately after construction, overlapping Save/autosave, app update, offline restart. Inspect dependency guarantees or implement a serialized recoverable protocol. Approval status alone says nothing about these paths.

### R5. Feedback delivery can fail outside the visible game

The checked-in `deploy/n8n-feedback-mailer.json` reads 100 keys without pagination and has no configured error workflow. Failed emails retain their keys, appropriately, but a persistent failing first page can obstruct later messages. Actual deployed n8n settings were not inspected.

Verify production configuration and add failure/backlog visibility. `src/worker/feedback.ts:123` stores without expiry; failed downstream delivery can retain records indefinitely. Decide retention deliberately rather than losing undelivered feedback silently.

Feedback has body limits, validation, origin checks, and rate limiting. Limiters deliberately fail open (`feedback.ts:139-152`), and the configured global rate is not a daily KV-budget guarantee. These are resilience/monitoring considerations; no new exploitable security vulnerability was established.

### R6. Release verification depends on operator discipline

`scripts/ship.sh` invokes deploy/build/predeploy checks but does not itself run the whole test suite or Worker typecheck. Require check evidence tied to the release commit and post-deploy behavior checks. A successful build alone is not a readiness verdict. No deployment occurred in this review.

## Existing protections to preserve

- Read failures are distinguished from empty slots; unread slots are protected against overwrite and unreadable payloads can be retained/exported.
- Browser save metadata/text share transactions with abort handling and explicit fallback ordering.
- Old save versions load; optional fields preserve compatibility.
- Renderer has a 1,000-person drawing ceiling, bounded ghost cache with texture destruction, capped shaft texture pieces, and old-entity cleanup on world replacement.
- Audio has explicit hide/show and late suspend/resume handling; sources/timers are stopped. Destroy suspends rather than closes the context, but no user-impact repeated-mount leak was established.
- Native builds intentionally omit service workers; web PWA scope excludes unrelated/native assets.
- Larger text, reduced motion, color-blind views, first-tower onboarding, focus indicators, and save/export already exist. Do not report them as absent.

These protections are evidence of real cleanup work, not a measured total memory/GPU budget.

## Highest-value game-ready capabilities

1. Transport diagnostics: floor/shaft queues, oldest waits, failed trips, coverage, affected tenants, and actions.
2. Service management: assignments, workload, blocked access, and understandable inactivity.
3. Persistent event presentation: recoverable incident controls and VIP results.
4. Save recovery: previous-good state, visible saving status, concurrent-session protection, reliable exit/resume.
5. Contextual teaching beyond initial onboarding: congestion, hotel service, and progression requirements when they become relevant.
6. Consistent input/reading behavior: clear panel ownership, complete input navigation, readable event cards, and player-paced important information.

These fit this management game's needs. Relevant external reference: [Game Accessibility Guidelines](https://gameaccessibilityguidelines.com/full-list/) on contextual help, input consistency, saved settings, and reading prompts at the player's pace. This review does not establish compliance or a competitive benchmark against other shipped games.

## Suggested implementation order and proof

1. **Save safety:** F1-F3; establish the save-and-exit transition contract.
2. **Simulation correctness:** F5-F8; reproduce before fixing and preserve meaningful congestion.
3. **Unified Stories:** F4 and G1-G3; operational information and actions remain available after dismissal.
4. **Game presentation:** G4-G7; construction ownership, resize behavior, centered pause buttons, Clips, branded exit.
5. **Release verification:** actual browser/iPhone journeys, Android preparation, GPU recovery, interrupted saves, sustained large-tower behavior, feedback delivery checks.

For each defect, establish the reproduction on the current target before changing it and verify the complete player journey afterward. In particular, test integration paths rather than only helpers: an actual party crowd, an actual in-car evaluation eviction, and an actual failed outgoing save. Preserve existing intentional rules. Review fixes for new regressions before any release under the owner's subsequent authorization.

## Coverage and limits

Reviewed relevant UI creation/update/navigation, Stories/News/VIP, alerts, placement, shared sheets, pause menu, and selected accessibility/onboarding/input tests; simulation people/staff/events/economy/evaluation and relevant transport paths/tests; save/storage/boot/transition paths; rendering reconciliation/art-cache lifecycle and installed Pixi recovery code; audio lifecycle; PWA/native configuration and wrappers; Worker/feedback/mailer/release scripts.

This was a broad targeted source review, **not an exhaustive whole-tree audit**. Large art/audio authoring bodies, complete scenario suites, all save-validation/build-rule branches, and every UI support module were not read end to end. No execution, performance measurements, browser visual inspection, live infrastructure inspection, physical mobile testing, signed release artifact inspection, or store-submission verification occurred. Steam was explicitly excluded.

The principal defects were independently traced by the orchestrator. GPU recovery, native durability, endgame collector balance, and long-session performance remain verification work. The review rejected unconditional permanent-elevator-jam and inevitable-collector-backlog claims where evidence did not support them. The original repository was unchanged throughout review; this requested handoff is the only intended new file.
