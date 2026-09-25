const ls = new Map<string, string>();
(globalThis as any).localStorage = { getItem: (k: string) => ls.get(k) ?? null, setItem: (k: string, v: string) => void ls.set(k, v) };
const { createGame } = await import('/Users/matthew/parallax-private/Projects/hundred-stories/src/game/game');
const clk = { now: () => 0, hidden: () => true, scheduleIdle: (r: () => void) => { r(); return () => {}; }, today: () => '2026-09-28', freshSeed: () => 77 };
const g0 = createGame(11, clk);
g0.apply({ kind: 'build', room: 'lobby', floor: 1, x: 150 });
const good = g0.exportSave();
for (const [label, entry] of [['truncated', (g: any) => g.openFriend(4242)], ['daily', (g: any) => g.openDaily()]] as const) {
  ls.clear();
  const corrupt = good.slice(0, Math.floor(good.length / 2)); // damaged: half the bytes
  ls.set('hundred-stories:autosave', corrupt);
  const game = createGame(5, clk);
  await entry(game);
  console.log(`[${label}] before openMyTower: slot=${game.getSlot()} autosave bytes=${ls.get('hundred-stories:autosave')!.length} (corrupt ${corrupt.length})`);
  await game.openMyTower();
  const now = ls.get('hundred-stories:autosave')!;
  let parsed: any = null; try { parsed = JSON.parse(now); } catch {}
  console.log(`[${label}] after openMyTower: slot=${game.getSlot()} autosave bytes=${now.length} seed=${parsed?.seed} sameAsCorrupt=${now === corrupt} stash=${ls.has('hs.save.unreadable')} warns=${JSON.stringify(game.world.log.filter((l: any) => l.level === 'warn').map((l: any) => l.text))}`);
}
// contrast: boot path load()
ls.clear();
ls.set('hundred-stories:autosave', good.slice(0, 100));
const b = createGame(5, clk);
const r = await b.load();
console.log('[boot load()] ok=', r.ok, 'stash=', ls.has('hs.save.unreadable'), 'warn=', b.world.log.filter((l: any) => l.level === 'warn').length);
