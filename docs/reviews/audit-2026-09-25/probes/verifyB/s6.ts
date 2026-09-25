import { base, applyCommand, tick, hhmm } from './common.ts';
const R = '/Users/matthew/parallax-private/Projects/hundred-stories/src/sim';
const { startVip, startFire, startTheft } = await import(R + '/events.ts');
const w = base(11, 100);
w.stars = 5;
console.log(JSON.stringify(applyCommand(w, { kind: 'build', room: 'office', floor: 2, x: 100 })), JSON.stringify(applyCommand(w, { kind: 'build', room: 'hotelSuite', floor: 3, x: 100 })), JSON.stringify(applyCommand(w, { kind: 'build', room: 'shop', floor: 2, x: 120 })));
applyCommand(w, { kind: 'shaft.build', shaft: 'standard', x: 190, floorMin: 1, floorMax: 3 });
startVip(w);
const vip = w.events.find(e => e.kind === 'vip');
vip.arrivesAt = w.time.minute + 2;
startTheft(w, (w.time.minute % 1440) + 3);
startFire(w); // picks a random room with no security office
const fire = w.events.find(e => e.kind === 'fire');
console.log('fire in', fire && fire.roomIds.map(id => w.rooms.get(id)?.kind));
for (let i = 0; i < 30; i++) tick(w);
const sim = w.sims.get(vip.simId);
console.log('fire still burning', w.events.some(e => e.kind === 'fire'), '| vip state', sim?.state, 'pos', JSON.stringify(sim?.pos), 'inRoom', sim?.inRoomId);
console.log('thief sims', [...w.sims.values()].filter(s => s.kind === 'thief').map(s => `${s.state}@${s.pos.floor}`).join(','), '| theft event', JSON.stringify(w.events.find(e => e.kind === 'theft')?.phase));
console.log(w.log.map(l => `[${hhmm(l.minute)}] ${l.text}`).filter(t => /fire|Fire|VIP|outside|Theft|thief/.test(t)).join('\n'));
