# Hotel single room will not demolish, no text: diagnosis (commit 0f05723, read only)

## Cause
The sim never leaks occupancy on a hotel room. Every refusal the probe recorded is legitimate: a guest really is inside, or the support rule applies. The failure with no text happens in the tap path.

**IMPORTANT: src/game/game.ts:1312-1315**. With the Demolish tool in hand, a pick hit that carries `simId` is dropped without a word:
```ts
if (tool.kind === 'demolish') {
  if (hit.roomId !== undefined) api.apply({ kind: 'demolish', roomId: hit.roomId });
  else if (hit.shaftId !== undefined) api.apply({ kind: 'shaft.demolish', shaftId: hit.shaftId });
  return;
}
```
src/render/renderer.ts:2372-2376 (pickAt) builds a hit that carries **either** `simId` **or** the room/shaft, never both. A drawn sprite always wins, a rule added in 21335cb, "the sprite under a tap wins". A single room is 4 tiles wide with capacity 1. inRoomSlot (renderer.ts:805-819) parks its guest at tile room.x+1. PICK_RADIUS_TILES is 1.5 (renderer.ts:752), so the guest covers room.x-0.5 to room.x+2.5. That is 10 of the room's 16 quarter-tile tap points, the left 62.5% of the room. The guest is drawn when its id is in the one-in-four crowd sample (inCrowd, renderer.ts:747). So at night, for one hotel guest in four, most taps on the room do nothing: no command, no log line, no toast, no haptic.

The same swallow happens in daytime whenever any drawn sprite stands within 1.5 tiles of the tap on that floor, for example a housekeeper or a guest walking the hall. In that case the demolish would have succeeded.

**ADVISORY: src/ui/ui.ts:1486-1501**. A refusal from a tower tap does reach the room. It goes through api.apply → logEvent 'warn' (game.ts:974) and then refreshNews, not through act()/notice(), because `acting` is false. That puts it under the warn throttle: it is dropped if any warn toast was shown in the last 20 s (GIVE_UP_TOAST_GAP_MS, ui.ts:97), folded into "N problems in the tower." when other warns are pending, and hidden in Watch mode (ui.ts:1475). In a tower where people give up waiting, "People are inside." can also fail to show on screen. It is always in the News panel. The haptic 'refuse' still plays (ui.ts:747).

## What the sim does (no leak)
- Check-in is booked at 17:00 (people.ts:178-194). The guest enters between 17:00 and 22:00 and stays with no set end (stayMinutes 0). It leaves on the checkout entry, between 07:00 and 10:00. departRoom (people.ts:612-623) takes off the occupancy and checks out (tenants cleared, room dirty).
- Give-up (728-754): a guest is not a tenant under isTenant, so it becomes `leaving`. runLeaving/finishLeave call departRoom when it is in a room. Housekeepers are counted in occupancy while cleaning, 20 min (enterRoom 580, finishCleaning 953 departRoom). sendAway (785-800) decrements. events.ts sets no hotel occupancy. The hourly recountOccupancy (90-100) would heal any phantom anyway.
- Probe: for every minute of 6 days × 4 layouts × 2 seeds, the occupancy of the target room was compared with the number of sims whose inRoomId is that room. Mismatches: **none**.

## Player window
A booked room refuses with "People are inside." from the guest's arrival (17:00-22:00) to checkout (07:00-10:00). It can be demolished roughly 10:00-17:00 every day, and all night on a night it was not booked. Weekday booking chance is 0.6 and weekend 0.9. Without a housekeeping office, the room stays dirty after its first checkout and is never booked again, so it can be demolished at any hour. It also refuses for about 20 min while a housekeeper cleans. "Something above rests on this. Remove that first." appears only when a room above rests on nothing else (build.ts:308-317, decision 2026-09-24). explain.ts is only the placement chip's second line and has no demolish text. The demolish refusal reaches the player only as a news toast (above), on touch and on desktop alike: both use the same onPick → api.apply path.

## Reproduction
- `/private/tmp/claude-501/-Users-matthew-parallax-private-Projects-hundred-stories/92fda5a1-ea82-4f34-a969-78dde5016111/scratchpad/hotel-demolish/probe.ts` runs hourly applyAndRecord demolish attempts on a structuredClone of the world, plus a leak check every minute. Output is in `probe-output.txt`. Run it from the checkout with `npx vite-node <path>`.
  - A (single over lobby), seed 11: OK 132, "People are inside." 12, every refusal with occ=1 and the guest inRoom. Leaks: none.
  - B (with housekeeping beside), seed 7: OK 65, inside 79. Accepted between 07:00 and 22:00 (hours of day); refused only while a guest is really in the room.
  - C (room above resting only on it): the support refusal, with text. D (room above straddling two rooms): same as A.
- `/private/tmp/claude-501/-Users-matthew-parallax-private-Projects-hundred-stories/92fda5a1-ea82-4f34-a969-78dde5016111/scratchpad/hotel-demolish/pick.ts` reproduces the tap with the renderer's own pickSimAt, pickTargetAt and inRoomSlot. Output is in `pick-output.txt`. When guest 36 is in the crowd sample (bump 1), taps at x=110.125 to 112.375 give `hit={"simId":36}` → **NOTHING (tap swallowed, no text)**, and taps at 112.625 to 113.875 give `People are inside.`. When the guest is not drawn, every tap gives `People are inside.`.

## Fix spec
1. game.ts onPick, demolish branch: when the hit has no roomId or shaftId, resolve the structure from `hit.floor` and `hit.x` with the same rule pickTargetAt uses, then apply. Alternatively, have pickAt put the room or shaft target into the hit alongside `simId`. A demolish tap must never end without either a command or a refusal. Query and none tools keep the sprite first.
2. Tower-tap refusals: speak them as the player's own notice, as act()/notice() does, so the warn-toast throttle, folding and Watch mode do not swallow them. This one is ADVISORY.
3. Tests:
   - tests/game: fake renderer that captures the onPick listener. Build a lobby, a shaft and a hotelSingle on floor 2, put a guest inside, set the Demolish tool, and fire `{ simId: guest.id, floor: 2, x: room.x + 1 }`. Expect the log to gain "People are inside." (or the room to be gone once the guest is removed). It fails today, with no log line, and passes after.
   - Mirror case: the same hit with the room empty. Expect the room to be demolished.
   - tests/render (optional): pickAt over an in-room drawn guest in demolish mode yields the room.
