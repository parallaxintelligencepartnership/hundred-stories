const R = '/Users/matthew/parallax-private/Projects/hundred-stories/src/sim/';
const { createWorld } = await import(R + 'world');
const { tick } = await import(R + 'tick');
const { serialize, deserialize } = await import(R + 'save');
const { startBuildLog, applyAndRecord } = await import(R + 'buildlog');
const { verifySave, markCheckpoint } = await import(R + 'replay');
const { ROOMS } = await import(R + 'rules');
function build(reload: boolean) {
  let w: any = createWorld(4242, { cash: 50_000_000 });
  startBuildLog(w, undefined, { start: { cash: 50_000_000 } });
  const ok = (c: any) => applyAndRecord(w, c).ok;
  for (let x = 0; x < 120; x++) ok({ kind: 'build', room: 'lobby', floor: 1, x });
  ok({ kind: 'shaft.build', shaft: 'standard', x: 20, floorMin: 1, floorMax: 8 });
  for (let f = 2; f <= 6; f++) for (let x = 0; x + ROOMS.office.width <= 120; x += ROOMS.office.width) ok({ kind: 'build', room: 'office', floor: f, x });
  let hotelsBuilt = false;
  let saves = 0;
  const endDay = 30;
  while (w.time.minute < endDay * 1440) {
    tick(w);
    if (!hotelsBuilt && w.stars >= 2) {
      hotelsBuilt = true;
      let n = 0;
      for (let x = 30; x + 4 <= 118; x += 4) if (ok({ kind: 'build', room: 'hotelSingle', floor: 7, x })) n++;
      console.log(reload ? 'B' : 'A', 'hotels built', n, 'at minute', w.time.minute);
    }
    // B: a page load every game day at 03:00, the way the game saves and reloads
    if (reload && w.time.minute % 1440 === 180) {
      markCheckpoint(w); saves++;
      const r = deserialize(serialize(w)); if (!r.ok) throw new Error(r.reason);
      w = r.world;
    }
  }
  const inf = [...w.rooms.values()].filter((r: any) => r.infested).length;
  markCheckpoint(w);
  const text = serialize(w);
  const v: any = verifySave(text);
  console.log(reload ? 'B (reload daily)' : 'A (no reload)', 'stars', w.stars, 'infested rooms', inf, 'reloads', saves, 'verifySave:', v.status, v.divergedAt ?? '', 'lastMatch', v.lastMatch ?? '');
  return w;
}
build(false);
build(true);
