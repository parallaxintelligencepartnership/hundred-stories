import React from 'react';
import { AbsoluteFill, Easing, useCurrentFrame } from 'remotion';
import { TenantPeg, walkPose } from '../components/TenantPeg';
import { ElevatorCar, Shaft } from '../components/ElevatorCar';
import { ParticleBurst, BurstStar } from '../components/ParticleBurst';
import { Wordmark, Caption } from '../components/Wordmark';
import { OpeningBumper, CornerWatermark } from '../components/Watermark';
import { FloorIndicator } from '../components/FloorIndicator';
import { keyCam } from '../components/rig';
import { fade, lerp, popIn, ramp, wobble } from '../components/anim';
import { amber, ink, inkDim, line, mint, outline, paneDay, people, room, slab, slabEdge, steel, steel2 } from '../style/palette';
import { display, loadFonts, readout } from '../style/fonts';

loadFonts();

const W = 1920;
const H = 1080;
const FL = 860;
const CEIL = FL - 520;
const CAR_X = 1130;
const CAR_W = 240;
const CAR_H = 230;
const CAR2_X = 1520;
const BTN_X = 1078;
const BTN_Y = FL - 92;
const QS = 1.25; // queue scale
const TICKS = [146, 160, 174]; // floor 6 -> 7 -> 8 -> 9
const DING = 180;
const SYNC = 124;

type Pose = React.ComponentProps<typeof TenantPeg>;
type Look = Pick<Pose, 'top' | 'skin' | 'hair'>;
type Mood = 'watch' | 'crossed' | 'sit' | 'hips';

const QUEUE: { slot: number; start: number; mood: Mood; look: Look }[] = [
  { slot: 1030, start: -999, mood: 'watch', look: { top: people.topJacket, skin: people.skinA, hair: people.hairA } },
  { slot: 925, start: 40, mood: 'crossed', look: { top: people.topSweater, skin: people.skinB, hair: people.hairB } },
  { slot: 820, start: 54, mood: 'crossed', look: { top: people.topTee, skin: people.skinC, hair: people.hairA } },
  { slot: 715, start: 70, mood: 'sit', look: { top: people.topHoodie, skin: people.skinD, hair: people.hairB } },
  { slot: 610, start: 86, mood: 'hips', look: { top: people.topJacket, skin: people.skinC, hair: people.hairB } },
  { slot: 505, start: 100, mood: 'crossed', look: { top: people.topTee, skin: people.skinB, hair: people.hairB } },
];
const WALK_SPEED = 40;
const RUN_SPEED = 55;
const carSlot = (i: number) => 1350 - i * 38;
const runStart = (i: number) => 259 + i * 2;

const floorShown = (f: number) => (f < TICKS[0] ? 6 : f < TICKS[1] ? 7 : f < TICKS[2] ? 8 : 9);

const doorOpen = (f: number) => {
  if (f < DING) return 0;
  if (f < 190) return ramp(f, DING, 10, Easing.out(Easing.quad));
  if (f < 266) return 1;
  if (f < 280) return lerp(1, 0.28, ramp(f, 266, 14, Easing.inOut(Easing.quad)));
  if (f < 284) return lerp(0.28, 0.45, ramp(f, 280, 4, Easing.out(Easing.quad)));
  if (f < 292) return lerp(0.45, 0.1, ramp(f, 284, 8));
  return lerp(0.1, 0, ramp(f, 292, 4));
};

/** Forward lean from the anticipation ticks: snap forward on each tick, settle back. */
const tickLean = (f: number) => {
  let l = f >= 140 && f < DING ? 6 * ramp(f, 140, 40) : 0;
  for (const t of TICKS) if (f >= t && f < DING) l += 16 * Math.min(1, (f - t) / 3) * Math.exp(-Math.max(0, f - t - 3) / 8);
  return l;
};

const member = (i: number, f: number): { pose: Pose; sitting: boolean } => {
  const q = QUEUE[i];
  const base = { y: FL, scale: QS, facing: 1 as const, ...q.look };
  const walkDur = Math.round((q.slot + 250) / WALK_SPEED);
  // walking in
  if (f < q.start) return { pose: { ...base, x: -600, opacity: 0 }, sitting: false };
  if (f < q.start + walkDur) {
    const p = (f - q.start) / walkDur;
    return { pose: { ...base, x: lerp(-250, q.slot, p), ...walkPose(Math.floor(f / 3), 0.9) }, sitting: false };
  }
  const arrived = q.start + walkDur;
  const sits = q.mood === 'sit' && f >= 122 && f < runStart(i);
  const sitY = FL + 26 * QS;

  // scramble into the car
  const rs = runStart(i);
  if (f >= rs) {
    const slot = carSlot(i);
    const dur = Math.max(6, Math.round((slot - q.slot) / RUN_SPEED));
    if (f < rs + dur) {
      const p = ramp(f, rs, dur, Easing.in(Easing.quad));
      return { pose: { ...base, x: lerp(q.slot, slot, p), ...walkPose(Math.floor(f / 2), 1.5), lean: 22, y: FL - 6 * Math.abs(Math.sin(f * 0.8)) }, sitting: false };
    }
    const squeeze = 1.3 + wobble(f, rs + dur, 0.12, 4, 1.1);
    return { pose: { ...base, x: slot + 3 * Math.sin(f * 0.9 + i), squash: squeeze, lean: (i % 2 ? 5 : -5) + wobble(f, rs + dur, 6, 5, 1), armFront: 6, armBack: -6 }, sitting: false };
  }

  // idle states before the ding
  const phase = f < SYNC ? f * 0.5 + i * 1.9 : (f - SYNC) * 0.55;
  const tapping = f < 140 && q.mood !== 'sit';
  const tap = tapping ? Math.max(0, Math.sin(phase)) : 0;
  const breath = Math.sin(f * 0.12 + i);
  let pose: Pose = { ...base, x: q.slot, legSwing: 10 * tap, squash: 1 - 0.02 * tap + 0.01 * breath };
  if (q.mood === 'crossed') pose = { ...pose, armsCrossed: true, lean: -3 };
  if (q.mood === 'hips') pose = { ...pose, armFront: -38, armBack: 38 };
  if (q.mood === 'watch') {
    const glance = Math.max(ramp(f, 8, 4) * (1 - ramp(f, 22, 4)), ramp(f, 104, 4) * (1 - ramp(f, 118, 4)));
    const jab = f >= 28 && f < 42 ? Math.abs(Math.sin((f - 28) * 0.9)) : 0;
    pose = { ...pose, armFront: lerp(lerp(8, 96, glance), 88, jab), lean: 8 * glance };
  }
  if (sits) {
    const plop = wobble(f, 122, 0.12, 4, 1.2);
    pose = { ...pose, y: sitY, sitting: true, legSwing: 0, lean: -10, armsCrossed: true, squash: 0.96 + plop };
  }
  if (f < DING) {
    pose = { ...pose, lean: (pose.lean ?? 0) + tickLean(f) * (sits ? 0.5 : 1) };
    if (f < arrived + 4) pose = { ...pose, squash: (pose.squash ?? 1) + wobble(f, arrived, 0.08, 4, 1.1) };
    return { pose, sitting: sits };
  }
  // ding: hope
  if (f < 190) {
    const h = popIn(f, DING, 8);
    return { pose: { ...pose, armsCrossed: false, armFront: lerp(10, 60, h), armBack: lerp(-10, -50, h), squash: (pose.squash ?? 1) + 0.08 * h, lean: -4, legSwing: 0 }, sitting: sits };
  }
  // watching the lone passenger stroll off
  if (f < 220) return { pose: { ...pose, armsCrossed: false, armFront: 10, armBack: -8, lean: -4, legSwing: 0 }, sitting: sits };
  // double take: jolt back, look at each other, look back
  if (f < 234) {
    const jolt = popIn(f, 220, 6) * (1 - ramp(f, 228, 6));
    const look = f >= 224 && f < 230 ? -1 : 1;
    return { pose: { ...pose, facing: look as 1 | -1, armsCrossed: false, armFront: 30 * jolt, armBack: -30 * jolt, lean: -14 * jolt, squash: 1 + 0.1 * jolt, legSwing: 0 }, sitting: sits };
  }
  // collective facepalm and deflate
  if (f < 256) {
    const d = ramp(f, 234, 8, Easing.out(Easing.quad));
    return { pose: { ...pose, armsCrossed: false, armFront: lerp(10, 166, d), armBack: 4, lean: 16 * d, squash: 1 - 0.1 * d, bob: 3 * d, legSwing: 0 }, sitting: sits };
  }
  // the doors: realise
  const r = popIn(f, 256, 4);
  return { pose: { ...pose, armsCrossed: false, armFront: 40 * r, armBack: -40 * r, lean: -8 * r, squash: 1 + 0.1 * r, legSwing: 0 }, sitting: sits };
};

// The lone, unhurried passenger.
const passenger = (f: number): Pose | null => {
  if (f >= 250) return null;
  const base = { y: FL, scale: 0.8, top: people.topSweater, skin: people.skinD, hair: people.hairA } as const;
  if (f < 188) return { ...base, x: 1250, facing: 1 };
  if (f < 200) return { ...base, x: lerp(1250, 1320, ramp(f, 188, 12, Easing.linear)), facing: 1, ...walkPose(Math.floor(f / 7), 0.4) };
  if (f < 214) return { ...base, x: 1320, facing: -1, armFront: 150 + Math.sin((f - 200) * 0.9) * 22, armBack: -10, squash: 1 + 0.03 * Math.sin(f) };
  return { ...base, x: lerp(1320, 1700, ramp(f, 214, 36, Easing.linear)), facing: 1, ...walkPose(Math.floor(f / 7), 0.4) };
};

const Lobby: React.FC<{ f: number }> = ({ f }) => {
  const press = f >= 28 && f < 44 ? 1 : 0.35 + 0.15 * Math.sin(f * 0.2);
  return (
    <g>
      <rect x={-1500} y={CEIL - 400} width={5000} height={400} fill={steel2} />
      <rect x={-1500} y={CEIL} width={5000} height={FL - CEIL} fill={room.lobby} />
      <rect x={-1500} y={CEIL - 12} width={5000} height={12} fill={slab} stroke={slabEdge} strokeWidth={2} />
      <rect x={-1500} y={FL - 22} width={5000} height={22} fill={room.office} stroke={outline} strokeWidth={1.5} />
      <rect x={-1500} y={FL} width={5000} height={90} fill={slab} />
      <rect x={-1500} y={FL} width={5000} height={3} fill={slabEdge} />
      <rect x={-1500} y={FL + 90} width={5000} height={400} fill={steel2} />
      <text x={120} y={CEIL + 70} fill={line} fontFamily={readout} fontSize={48}>
        9F
      </text>
      {/* elevator bank surrounds */}
      {[CAR_X, CAR2_X].map((x) => (
        <rect key={x} x={x - 24} y={FL - CAR_H - 44} width={CAR_W + 48} height={CAR_H + 44} fill={line} stroke={outline} strokeWidth={2} />
      ))}
      <Shaft x={CAR_X - 10} top={FL - CAR_H - 30} bottom={FL} w={CAR_W + 20} />
      <Shaft x={CAR2_X - 10} top={FL - CAR_H - 30} bottom={FL} w={CAR_W + 20} />
      {/* call button */}
      <rect x={BTN_X - 16} y={BTN_Y - 30} width={32} height={60} rx={6} fill={steel} stroke={outline} strokeWidth={2} />
      <circle cx={BTN_X} cy={BTN_Y - 10} r={9} fill={amber} opacity={press} stroke={outline} strokeWidth={1.5} />
      <circle cx={BTN_X} cy={BTN_Y + 14} r={9} fill={steel2} stroke={outline} strokeWidth={1.5} />
      {/* the other car, stuck far away */}
      <ElevatorCar x={CAR2_X} y={FL} w={CAR_W} h={CAR_H} open={0} />
      <FloorIndicator x={CAR2_X + CAR_W / 2} y={FL - CAR_H - 90} label="14" arrow="▼" size={44} dim />
    </g>
  );
};

export const WaitClip: React.FC = () => {
  const f = useCurrentFrame();
  const cam = keyCam(f, [
    [0, { x: 1060, y: FL - 130, s: 1.55 }],
    [36, { x: 1060, y: FL - 130, s: 1.55 }],
    [66, { x: 820, y: FL - 200, s: 1.1 }],
    [136, { x: 820, y: FL - 200, s: 1.1 }],
    [172, { x: 1000, y: FL - 230, s: 1.28 }],
    [184, { x: 1080, y: FL - 200, s: 1.12 }],
    [216, { x: 1100, y: FL - 200, s: 1.12 }],
    [224, { x: 860, y: FL - 170, s: 1.2 }],
    [256, { x: 860, y: FL - 170, s: 1.2 }],
    [268, { x: 1080, y: FL - 180, s: 1.1 }],
    [296, { x: 1200, y: FL - 150, s: 1.4 }],
  ]);

  const open = doorOpen(f);
  const flash = f >= DING && f < DING + 12 ? 1 - (f - DING) / 12 : 0;
  const lastTick = [...TICKS, DING].filter((t) => f >= t).pop() ?? -100;
  const tickPop = 1 + 0.3 * (1 - ramp(f, lastTick, 8, Easing.out(Easing.back(3))));
  const members = QUEUE.map((_, i) => member(i, f));
  const pass = passenger(f);
  const squishT = 280;

  const card = ramp(f, 294, 8);
  const cardOut = ramp(f, 344, 15, Easing.in(Easing.quad));
  const openIn = 1 - ramp(f, 0, 8, Easing.out(Easing.quad));
  const bumperOpacity = fade(f, 0, 6, 16, 12);
  const bumperScale = 0.9 + 0.1 * popIn(f, 0, 12);
  const watermarkOpacity = fade(f, 30, 10, 280, 12);

  return (
    <AbsoluteFill style={{ background: steel }}>
      <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} style={{ position: 'absolute', inset: 0 }}>
        <g transform={`translate(${W / 2} ${H / 2}) scale(${cam.s}) translate(${-cam.x} ${-cam.y})`}>
          <Lobby f={f} />
          {/* fanfare burst behind the readout */}
          {f >= DING && f < DING + 20 && (
            <g transform={`translate(${CAR_X + CAR_W / 2} ${FL - CAR_H - 90}) scale(${popIn(f, DING, 8) * (1 - ramp(f, DING + 12, 8))})`}>
              <BurstStar x={0} y={0} r={120} fill={amber} points={14} rot={f * 2} />
            </g>
          )}
          <FloorIndicator x={CAR_X + CAR_W / 2} y={FL - CAR_H - 90} label={String(floorShown(f))} arrow={f < DING ? '▲' : undefined} pop={tickPop} size={56} />
          <ElevatorCar x={CAR_X} y={FL} w={CAR_W} h={CAR_H} open={open} flash={flash} glass={f >= 262}>
            {pass && <TenantPeg {...pass} />}
            {members.map(({ pose, sitting }, i) => (
              <g key={i}>
                <TenantPeg {...pose} />
                {/* a floor-sitter: the slab hides the shins so they read as legs out on the floor */}
                {sitting && <rect x={(pose.x as number) - 50} y={FL + 3} width={120} height={60} fill={slab} />}
              </g>
            ))}
          </ElevatorCar>
          {/* ding */}
          {f >= DING && f < DING + 26 && (
            <text x={CAR_X + CAR_W / 2} y={FL - CAR_H - 150 - 18 * ramp(f, DING, 10)} fill={mint} fontFamily={readout} fontSize={52} textAnchor="middle" opacity={1 - ramp(f, DING + 14, 12)}>
              ding!
            </text>
          )}
          <ParticleBurst x={CAR_X + CAR_W / 2} y={FL - CAR_H / 2} t={f - DING} seed="ding" color={mint} count={16} radius={220} duration={24} size={9} shape="sparkle" />
          <ParticleBurst x={CAR_X + CAR_W / 2} y={FL - CAR_H - 90} t={f - DING - 2} seed="ding2" color={amber} count={10} radius={160} duration={20} size={7} />
          {/* unison tapping */}
          {f >= SYNC && f < 140 &&
            [0, 1, 2].map((k) => (
              <text key={k} x={560 + k * 190} y={FL + 60} fill={inkDim} fontFamily={readout} fontSize={30} textAnchor="middle" opacity={Math.max(0, Math.sin((f - SYNC) * 0.55))}>
                tap
              </text>
            ))}
          {/* the wave */}
          {pass && f >= 200 && f < 214 && (
            <text x={1320} y={FL - 120} fill={inkDim} fontFamily={display} fontWeight={600} fontSize={30} textAnchor="middle" opacity={fade(f, 200, 3, 210, 4)}>
              hi!
            </text>
          )}
          {/* deflate sweat */}
          {f >= 236 && f < 256 &&
            [1, 3, 5].map((i) => (
              <ParticleBurst key={i} x={QUEUE[i].slot} y={FL - 150} t={(f - 236 - i * 2) % 18} seed={`sigh${i}`} color={paneDay} count={2} radius={36} duration={16} size={6} shape="drop" gravity={40} spread={[200, 340]} />
            ))}
          {/* realise: the doors! */}
          {f >= 256 && f < 272 && (
            <g transform={`translate(${QUEUE[0].slot + 20} ${FL - 190}) scale(${popIn(f, 256, 5) * (1 - ramp(f, 266, 6))})`}>
              <BurstStar x={0} y={0} r={30} fill={amber} points={8}>
                <text x={0} y={12} fill={outline} fontFamily={display} fontWeight={800} fontSize={34} textAnchor="middle">
                  !
                </text>
              </BurstStar>
            </g>
          )}
          {/* squeeze */}
          {f >= squishT && f < squishT + 12 && (
            <g transform={`translate(${CAR_X + 40} ${FL - CAR_H - 20}) scale(${popIn(f, squishT, 5) * (1 - ramp(f, squishT + 7, 5))})`}>
              <BurstStar x={0} y={0} r={40} fill={amber} points={10} rot={12}>
                <text x={0} y={10} fill={outline} fontFamily={display} fontWeight={800} fontSize={24} textAnchor="middle">
                  oof
                </text>
              </BurstStar>
            </g>
          )}
          {f >= 260 && f < 284 &&
            [0, 1, 2].map((k) => <rect key={k} x={560 + k * 30} y={FL - 130 + k * 34} width={110} height={6} rx={3} fill={line} opacity={0.6 * (1 - ramp(f, 276, 8))} />)}
        </g>
      </svg>
      {card > 0 && (
        <AbsoluteFill style={{ background: steel, opacity: card }}>
          <AbsoluteFill style={{ opacity: 1 - cardOut }}>
            <Wordmark opacity={card} scale={lerp(0.9, 1, popIn(f, 294, 18))} glow={0.9} size={130} />
            <Caption text="Every floor is a story. Everyone's got one." opacity={fade(f, 306, 14)} y={612} size={44} color={ink} />
            <Caption text="Play Free" opacity={fade(f, 318, 12)} y={690} size={36} color={mint} weight={600} />
            <Caption text="hundredstories.xyz" opacity={fade(f, 328, 12)} y={744} size={28} color={ink} weight={400} />
          </AbsoluteFill>
        </AbsoluteFill>
      )}
      {watermarkOpacity > 0 && <CornerWatermark opacity={watermarkOpacity} />}
      <AbsoluteFill style={{ background: steel, opacity: openIn }} />
      {bumperOpacity > 0 && <OpeningBumper opacity={bumperOpacity} scale={bumperScale} />}
    </AbsoluteFill>
  );
};
