import React from 'react';
import { AbsoluteFill, Easing, useCurrentFrame } from 'remotion';
import { TenantPeg, walkPose } from '../components/TenantPeg';
import { ParticleBurst, BurstStar } from '../components/ParticleBurst';
import { Wordmark, Caption } from '../components/Wordmark';
import { TrashBag, bagStack } from '../components/TrashBag';
import { JanitorCart } from '../components/JanitorCart';
import { keyCam, pegHand } from '../components/rig';
import { fade, lerp, popIn, ramp, wobble } from '../components/anim';
import { alert, amber, ink, inkDim, line, mint, outline, paneDay, people, room, shaftCavity, slab, slabEdge, steel, steel2, carHandrail } from '../style/palette';
import { display, loadFonts, readout } from '../style/fonts';

loadFonts();

const W = 1920;
const H = 1080;
const FL = 860; // hall floor line
const CEIL = FL - 560;
const DOOR_X = 520;
const DOOR_W = 120;
const DOOR_H = 180;
const PX = 800; // pile base
const MAX_BAGS = 11;
// Landing frame of bags 1..10 (bag 0 is already there): the tenant's own at 28, then the time lapse.
const LAND = [28, ...Array.from({ length: 9 }, (_, k) => 50 + k * 10)];
const TOSS = 7; // frames a tossed bag is airborne
const REMOVE0 = 246; // first bag lifted into the cart
const REMOVE_DT = 1.6;
const FLY = 8;
const CART_REST = 1330;

type Pose = React.ComponentProps<typeof TenantPeg>;

const landedSmooth = (f: number) => 1 + LAND.reduce((s, t) => s + ramp(f, t, 5, Easing.out(Easing.quad)), 0);
const landedCount = (f: number) => 1 + LAND.filter((t) => f >= t).length;

// Stack tilt in degrees. Grows with the pile, sways through the tension beat (time is slowed to a
// near-freeze at the peak of a sway), topples at 212, is caught at 226 and pushed upright.
const TENSE0 = 166;
const TENSE1 = 184;
const warp = (f: number) => (f < TENSE0 ? f : f < TENSE1 ? TENSE0 + (f - TENSE0) * 0.12 : TENSE0 + (TENSE1 - TENSE0) * 0.12 + (f - TENSE1));
const thetaRaw = (f: number) => {
  const base = 1.5 * landedSmooth(f);
  const jiggle = LAND.reduce((s, t) => s + wobble(f, t, 2.4, 6, 0.8), 0);
  const tw = warp(f);
  const amp = f < 140 ? 0 : lerp(2, 10, ramp(f, 140, 70, Easing.in(Easing.quad)));
  const sway = amp * Math.sin((tw - 140) * 0.28) + (f >= TENSE0 && f < TENSE1 ? 0.5 * Math.sin(f * 2.1) : 0);
  const topple = 26 * ramp(f, 212, 14, Easing.in(Easing.quad));
  return base + jiggle + sway + topple;
};
const CATCH = 226;
const theta = (f: number) => {
  if (f < CATCH) return thetaRaw(f);
  const caught = thetaRaw(CATCH) + wobble(f, CATCH, 4, 5, 0.9);
  return lerp(caught, 2, ramp(f, 232, 12, Easing.inOut(Easing.quad)));
};

const removeAt = (j: number) => REMOVE0 + j * REMOVE_DT;
const removedCount = (f: number) => Array.from({ length: MAX_BAGS }, (_, j) => j).filter((j) => f >= removeAt(j)).length;

/** Waste meter 0..1 and whether it is in the clear-down. */
const meterLevel = (f: number) => {
  if (f >= 262) return 1 - ramp(f, 262, 10, Easing.out(Easing.cubic));
  return Math.min(1, landedSmooth(f) / MAX_BAGS);
};

// The cleaner: sprint in pulling the cart, lunge, catch, push upright, sweep, wipe brow, thumbs up.
const cleaner = (f: number): { pose: Pose; arm: number; broom: 'carry' | 'brace' | 'sweep' | 'cart' | 'none' } => {
  const base = { y: FL, scale: 1.15, top: people.staffTop, apron: true, skin: people.skinD, hair: people.hairB, cap: people.staffTop } as const;
  if (f < 200) return { pose: { ...base, x: 2300 }, arm: 0, broom: 'none' };
  if (f < 218) {
    const p = ramp(f, 200, 18, Easing.linear);
    const w = walkPose(Math.floor(f / 2), 1.5);
    return { pose: { ...base, x: lerp(2250, 1150, p), facing: -1, ...w, lean: 24, armFront: 120 }, arm: 120, broom: 'carry' };
  }
  if (f < 232) {
    const p = ramp(f, 218, 8, Easing.out(Easing.quad));
    return { pose: { ...base, x: lerp(1150, 1060, p), facing: -1, lean: lerp(24, 34, p), legSwing: lerp(0, 44, p), armFront: 132, armBack: 118, squash: 0.92 }, arm: 132, broom: 'brace' };
  }
  if (f < 246) {
    const p = ramp(f, 232, 12, Easing.inOut(Easing.quad));
    return { pose: { ...base, x: lerp(1060, 1010, p), facing: -1, lean: lerp(34, 14, p), legSwing: lerp(44, 20, p), armFront: lerp(132, 115, p), armBack: 110, squash: lerp(0.92, 1, p) }, arm: lerp(132, 115, p), broom: 'brace' };
  }
  if (f < 264) {
    const s = Math.sin((f - 246) * 0.9);
    return { pose: { ...base, x: 1010, facing: -1, lean: 8 + 6 * s, armFront: 60 + 30 * s, armBack: 40 + 30 * s, legSwing: 10 }, arm: 60 + 30 * s, broom: 'sweep' };
  }
  if (f < 282) {
    const wipe = 160 + 16 * Math.sin((f - 266) * 0.6);
    const settle = ramp(f, 264, 4);
    return { pose: { ...base, x: 1010, facing: 1, lean: -4 * settle, squash: 1 - 0.04 * settle, armFront: lerp(40, wipe, settle), armBack: -10 }, arm: wipe, broom: 'cart' };
  }
  const up = popIn(f, 282, 10);
  return { pose: { ...base, x: 1010, facing: 1, lean: -6, squash: 1 + 0.05 * up, armFront: lerp(40, 100, up), armBack: -14 }, arm: 100, broom: 'cart' };
};

// Neighbours who pass the pile: step into the foreground lane to give it room, lean away, hurry off.
const passer = (f: number, t0: number, dir: 1 | -1) => {
  const dur = 56;
  if (f < t0 || f > t0 + dur) return null;
  const p = (f - t0) / dur;
  // slow near the pile: remap progress so the middle third takes longer
  const slowed = p < 0.3 ? p * 1.3 : p < 0.7 ? 0.39 + (p - 0.3) * 0.55 : 0.61 + (p - 0.7) * 1.3;
  const x = dir === 1 ? lerp(-120, 1900, slowed) : lerp(1900, -120, slowed);
  const near = Math.max(0, 1 - Math.abs(x - (PX + 60)) / 380);
  const w = walkPose(Math.floor(f / (near > 0.3 ? 5 : 3)), near > 0.3 ? 0.6 : 1);
  return {
    x,
    y: FL + 46 * near,
    scale: 1.1 + 0.08 * near,
    near,
    pose: { ...w, facing: dir, lean: lerp(w.lean, -18, near), armFront: lerp(w.armFront, 20, near), armBack: lerp(w.armBack, -20, near), squash: lerp(w.squash, 1.08, near) },
  };
};

const doorOpen = (f: number) => {
  let o = 0;
  // the tenant's own trip
  o = Math.max(o, ramp(f, 4, 6, Easing.out(Easing.quad)) * (1 - ramp(f, 34, 6)));
  // a flick for every tossed bag in the time lapse
  for (let k = 1; k < LAND.length; k++) {
    const t = LAND[k] - TOSS;
    o = Math.max(o, 0.7 * ramp(f, t - 4, 3) * (1 - ramp(f, t + 2, 4)));
  }
  return o;
};

const Hall: React.FC<{ f: number }> = ({ f }) => {
  const o = doorOpen(f);
  const leafR = DOOR_X + DOOR_W * (1 - 0.78 * o);
  return (
    <g>
      <rect x={-1500} y={CEIL - 400} width={5000} height={400} fill={steel2} />
      <rect x={-1500} y={CEIL} width={5000} height={FL - CEIL} fill={room.condo} />
      <rect x={-1500} y={CEIL - 12} width={5000} height={12} fill={slab} stroke={slabEdge} strokeWidth={2} />
      <rect x={-1500} y={FL - 22} width={5000} height={22} fill={room.office} stroke={outline} strokeWidth={1.5} />
      {/* floor: a deep band so passers can step into the foreground lane */}
      <rect x={-1500} y={FL} width={5000} height={90} fill={slab} />
      <rect x={-1500} y={FL} width={5000} height={3} fill={slabEdge} />
      <rect x={-1500} y={FL + 90} width={5000} height={400} fill={steel2} />
      {/* neighbouring doors */}
      {[-260, 1520].map((dx, i) => (
        <g key={dx}>
          <rect x={dx} y={FL - DOOR_H} width={DOOR_W} height={DOOR_H} fill={people.vipCoat} stroke={outline} strokeWidth={2} />
          <circle cx={dx + DOOR_W - 18} cy={FL - 86} r={6} fill={amber} stroke={outline} strokeWidth={1.5} />
          <text x={dx + DOOR_W / 2} y={FL - DOOR_H - 18} fill={line} fontFamily={readout} fontSize={30} textAnchor="middle">
            {i === 0 ? '4A' : '4C'}
          </text>
        </g>
      ))}
      {/* our tenant's door: dark interior, then the leaf swinging out */}
      <rect x={DOOR_X} y={FL - DOOR_H} width={DOOR_W} height={DOOR_H} fill={shaftCavity} stroke={outline} strokeWidth={2} />
      <text x={DOOR_X + DOOR_W / 2} y={FL - DOOR_H - 18} fill={line} fontFamily={readout} fontSize={30} textAnchor="middle">
        4B
      </text>
      <rect x={DOOR_X - 8} y={FL - 10} width={DOOR_W + 16} height={10} fill={line} opacity={0.35} />
      <DoorLeaf leafR={leafR} o={o} />
    </g>
  );
};

const DoorLeaf: React.FC<{ leafR: number; o: number }> = ({ leafR, o }) => (
  <g>
    <polygon
      points={`${DOOR_X},${FL - DOOR_H} ${leafR},${FL - DOOR_H - 12 * o} ${leafR},${FL + 8 * o} ${DOOR_X},${FL}`}
      fill={people.vipCoat}
      stroke={outline}
      strokeWidth={2}
      strokeLinejoin="round"
    />
    <circle cx={leafR - 18 * (1 - o * 0.6)} cy={FL - 86} r={6} fill={amber} stroke={outline} strokeWidth={1.5} />
  </g>
);

export const BacklogClip: React.FC = () => {
  const f = useCurrentFrame();
  const cam = keyCam(f, [
    [0, { x: 700, y: FL - 150, s: 1.5 }],
    [38, { x: 700, y: FL - 150, s: 1.5 }],
    [70, { x: 900, y: FL - 300, s: 1.0 }],
    [140, { x: 900, y: FL - 300, s: 1.0 }],
    [176, { x: 880, y: FL - 330, s: 1.22 }],
    [196, { x: 880, y: FL - 330, s: 1.22 }],
    [206, { x: 1020, y: FL - 300, s: 0.98 }],
    [262, { x: 1000, y: FL - 280, s: 1.0 }],
    [290, { x: 1080, y: FL - 150, s: 1.4 }],
  ]);

  const th = theta(f);
  const removed = removedCount(f);
  const total = landedCount(f);
  const stack = bagStack(MAX_BAGS, PX, FL, th, 0);
  const visible = Math.max(0, total - removed);
  const bagSquash = (i: number) => {
    const t = i === 0 ? -100 : LAND[i - 1];
    return 1 - 0.24 * Math.exp(-(f - t) / 5) * Math.cos((f - t) * 0.9) * (f >= t ? 1 : 0);
  };

  // tenant peeking out for bag 1
  const peekOut = ramp(f, 6, 6, Easing.out(Easing.quad)) * (1 - ramp(f, 32, 6, Easing.in(Easing.quad)));
  const toss = ramp(f, 16, 5, Easing.out(Easing.quad));
  const shrug = f >= 22 ? Math.exp(-(f - 22) / 8) * Math.abs(Math.sin((f - 22) * 0.35)) : 0;
  const tenant: Pose = {
    x: lerp(DOOR_X + 70, DOOR_X + 112, peekOut),
    y: FL,
    scale: 1.1,
    top: people.topTee,
    skin: people.skinA,
    hair: people.hairA,
    lean: 12 * peekOut - 4 * shrug,
    armFront: lerp(40, 110, toss) * (1 - Math.min(1, shrug * 2)) + 55 * Math.min(1, shrug * 2),
    armBack: lerp(-8, -55, Math.min(1, shrug * 2)),
    bob: -5 * shrug,
    squash: 1 - 0.03 * shrug,
  };
  const tenantHand = pegHand(tenant, tenant.armFront ?? 0);

  // tossed bags in flight: from the tenant's hand (bag 1) or out of the dark doorway (the rest)
  const flights = LAND.map((t, k) => {
    const i = k + 1;
    const start = t - TOSS;
    if (f < start || f >= t) return null;
    const p = (f - start) / TOSS;
    const from = k === 0 ? { x: tenantHand.x, y: tenantHand.y + 40 } : { x: DOOR_X + DOOR_W - 10, y: FL - 70 };
    const to = stack[i];
    const arcH = k === 0 ? 60 : 110 + i * 10;
    return (
      <TrashBag key={`fly${i}`} x={lerp(from.x, to.x, p)} y={lerp(from.y, to.y, p) - arcH * Math.sin(Math.PI * p)} rot={lerp(-30, to.rot, p) + 200 * p * (k % 2 ? 1 : -1) * (1 - p)} />
    );
  });

  const c = cleaner(f);
  const cp = c.pose;
  const hand = pegHand({ x: cp.x, y: cp.y, scale: cp.scale, facing: cp.facing, squash: cp.squash, lean: cp.lean, bob: cp.bob }, c.arm);
  const cartX = f < 218 ? (cp.x as number) + 130 : lerp(1150 + 130, CART_REST, ramp(f, 218, 16, Easing.out(Easing.cubic)));
  const cartTilt = f >= 218 && f < 236 ? wobble(f, 220, 5, 4, 1.2) : 0;
  const inCart = Array.from({ length: MAX_BAGS }, (_, j) => j).filter((j) => f >= removeAt(j) + FLY).length;

  // broom: handle from the hand to a target, bristles at the far end
  let broomEnd: { x: number; y: number } | null = null;
  let broomStart = hand;
  if (c.broom === 'carry') broomEnd = { x: hand.x - 70, y: hand.y - 110 };
  if (c.broom === 'brace') {
    const b = stack[Math.min(6, visible - 1)];
    const a = (b.rot * Math.PI) / 180;
    broomEnd = { x: b.x + Math.cos(a) * 46 - Math.sin(a) * 36, y: b.y + Math.sin(a) * 46 - Math.cos(a) * 36 };
  }
  if (c.broom === 'sweep') broomEnd = { x: hand.x - 90, y: FL - 6 };
  if (c.broom === 'cart') {
    broomStart = { x: CART_REST - 70, y: FL - 150 };
    broomEnd = { x: CART_REST - 130, y: FL - 4 };
  }
  const broom = broomEnd && (
    <g>
      {(() => {
        const dx = broomEnd.x - broomStart.x;
        const dy = broomEnd.y - broomStart.y;
        const len = Math.hypot(dx, dy) || 1;
        const ux = dx / len;
        const uy = dy / len;
        const tip = { x: broomEnd.x + ux * 14, y: broomEnd.y + uy * 14 };
        return (
          <>
            <line x1={broomStart.x - ux * 30} y1={broomStart.y - uy * 30} x2={broomEnd.x} y2={broomEnd.y} stroke={outline} strokeWidth={10} strokeLinecap="round" />
            <line x1={broomStart.x - ux * 30} y1={broomStart.y - uy * 30} x2={broomEnd.x} y2={broomEnd.y} stroke={carHandrail} strokeWidth={6} strokeLinecap="round" />
            <polygon
              points={`${broomEnd.x - uy * 12},${broomEnd.y + ux * 12} ${broomEnd.x + uy * 12},${broomEnd.y - ux * 12} ${tip.x + uy * 26 + ux * 16},${tip.y - ux * 26 + uy * 16} ${tip.x - uy * 26 + ux * 16},${tip.y + ux * 26 + uy * 16}`}
              fill={amber}
              stroke={outline}
              strokeWidth={2}
              strokeLinejoin="round"
            />
          </>
        );
      })()}
    </g>
  );

  const p1 = passer(f, 66, -1);
  const p2 = passer(f, 96, 1);

  // HUD
  const lvl = meterLevel(f);
  const critical = lvl >= 0.85 && f < 262;
  const meterColor = f >= 262 ? mint : lvl < 0.5 ? mint : lvl < 0.85 ? amber : alert;
  const blink = critical ? (Math.floor(f / 5) % 2 === 0 ? 1 : 0.45) : 1;
  const day = Math.min(9, 1 + LAND.filter((t, k) => k > 0 && f >= t - TOSS).length);
  const hudIn = fade(f, 30, 10);
  const clearPop = popIn(f, 264, 12);
  const status = f >= 262 ? 'CLEAR' : critical ? 'CRITICAL' : lvl >= 0.5 ? 'HIGH' : 'OK';

  const card = ramp(f, 294, 8);
  const cardOut = ramp(f, 344, 15, Easing.in(Easing.quad));
  const openIn = 1 - ramp(f, 0, 8, Easing.out(Easing.quad));

  const peg = (p: NonNullable<ReturnType<typeof passer>>, look: Partial<Pose>, seed: string) => (
    <g>
      <TenantPeg x={p.x} y={p.y} scale={p.scale} {...p.pose} {...look} />
      {p.near > 0.5 && <ParticleBurst x={p.x} y={p.y - 120 * p.scale} t={f % 16} seed={`${seed}${Math.floor(f / 16)}`} color={paneDay} count={2} radius={30} duration={14} size={6} shape="drop" gravity={30} spread={[200, 340]} />}
    </g>
  );

  return (
    <AbsoluteFill style={{ background: steel }}>
      <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} style={{ position: 'absolute', inset: 0 }}>
        <g transform={`translate(${W / 2} ${H / 2}) scale(${cam.s}) translate(${-cam.x} ${-cam.y})`}>
          <Hall f={f} />
          {/* the tenant, drawn in the doorway then the leaf re-drawn over their back half */}
          {f < 40 && peekOut > 0 && (
            <g>
              <TenantPeg {...tenant} />
              {f < LAND[0] - TOSS && <TrashBag x={tenantHand.x + 4} y={tenantHand.y + 44} w={80} h={56} rot={-12} />}
              <DoorLeaf leafR={DOOR_X + DOOR_W * (1 - 0.78 * doorOpen(f))} o={doorOpen(f)} />
            </g>
          )}
          <JanitorCart x={cartX} y={FL} bags={Math.min(4, Math.ceil(inCart / 2.5))} handle={1} tilt={cartTilt} />
          {/* the pile */}
          {stack.slice(0, visible).map((b, i) => (
            <TrashBag key={i} x={b.x} y={b.y} rot={b.rot} squash={bagSquash(i)} />
          ))}
          {flights}
          {/* bags lifted into the cart, top first */}
          {Array.from({ length: MAX_BAGS }, (_, j) => j).map((j) => {
            const t = removeAt(j);
            if (f < t || f >= t + FLY || j >= total) return null;
            const p = (f - t) / FLY;
            const from = bagStack(MAX_BAGS, PX, FL, theta(t), 0)[total - 1 - j];
            return <TrashBag key={`rm${j}`} x={lerp(from.x, CART_REST, p)} y={lerp(from.y, FL - 70, p) - 140 * Math.sin(Math.PI * p)} rot={lerp(from.rot, 0, p) + 240 * p * (1 - p)} w={86} h={60} />;
          })}
          {/* tension beat: one wrapper flutters off the top */}
          {f >= 168 && f < 214 && (
            <g transform={`translate(${Math.sin((f - 168) * 0.35) * 18} 0)`}>
              <ParticleBurst x={stack[MAX_BAGS - 1].x + 10} y={stack[MAX_BAGS - 1].y - 70} t={(f - 168) * 0.5} seed="wrapper" color={ink} count={1} radius={70} duration={23} size={7} shape="sparkle" gravity={260} spread={[-160, -130]} />
            </g>
          )}
          {f >= TENSE0 && f < TENSE1 + 6 && (
            <text x={stack[MAX_BAGS - 1].x + 90} y={stack[MAX_BAGS - 1].y - 40} fill={alert} fontFamily={display} fontWeight={800} fontSize={54} opacity={fade(f, TENSE0, 4, TENSE1, 6)}>
              ...
            </text>
          )}
          {p1 && peg(p1, { top: people.topHoodie, skin: people.skinB, hair: people.hairB }, 'p1')}
          {p2 && peg(p2, { top: people.topSweater, skin: people.skinC, hair: people.hairA }, 'p2')}
          {broom}
          <TenantPeg {...cp}>
            {/* thumbs up: a thumb on the raised fist */}
            {f >= 284 && <rect x={24} y={-82} width={8} height={16} rx={4} fill={cp.skin} stroke={outline} strokeWidth={2} />}
          </TenantPeg>
          {/* speed lines behind the sprint */}
          {f >= 200 && f < 222 &&
            [0, 1, 2].map((k) => <rect key={k} x={(cp.x as number) + 60 + k * 24} y={FL - 110 + k * 30} width={90} height={6} rx={3} fill={line} opacity={0.6} />)}
          {/* the catch */}
          {f >= CATCH && f < 244 && broomEnd && (
            <g transform={`translate(${broomEnd.x + 40} ${broomEnd.y - 50}) scale(${popIn(f, CATCH, 6) * (1 - ramp(f, 238, 6))})`}>
              <BurstStar x={0} y={0} r={42} fill={amber} points={10}>
                <text x={0} y={13} fill={outline} fontFamily={display} fontWeight={800} fontSize={34} textAnchor="middle">
                  !
                </text>
              </BurstStar>
            </g>
          )}
          <ParticleBurst x={PX + 20} y={FL - 120} t={f - 262} seed="clear" color={mint} count={16} radius={200} duration={26} size={10} shape="sparkle" />
          {f >= 266 && f < 284 && <ParticleBurst x={(cp.x as number) + 10} y={FL - 140} t={(f - 266) % 18} seed="brow" color={paneDay} count={3} radius={46} duration={16} size={6} shape="drop" gravity={40} spread={[200, 340]} />}
          <ParticleBurst x={(cp.x as number) + 40} y={FL - 150} t={f - 286} seed="thumb" color={mint} count={6} radius={50} duration={16} size={7} shape="sparkle" />
        </g>
        {/* waste meter HUD, screen space */}
        <g transform="translate(70 64)" opacity={hudIn}>
          <rect x={0} y={0} width={520} height={112} rx={12} fill={steel} stroke={f >= 262 ? mint : critical ? alert : line} strokeWidth={3} opacity={0.94} />
          <text x={24} y={40} fill={inkDim} fontFamily={readout} fontSize={28}>
            WASTE 4F
          </text>
          <text x={496} y={40} fill={inkDim} fontFamily={readout} fontSize={28} textAnchor="end">
            DAY {day}
          </text>
          <rect x={24} y={60} width={330} height={30} rx={6} fill={steel2} stroke={line} strokeWidth={2} />
          <rect x={27} y={63} width={Math.max(0, 324 * lvl)} height={24} rx={4} fill={meterColor} opacity={blink} />
          <g transform={`translate(${436} ${84}) scale(${f >= 262 ? 1 + 0.4 * (1 - clearPop) * (f < 276 ? 1 : 0) : 1})`}>
            <text x={0} y={0} fill={meterColor} fontFamily={readout} fontSize={status === 'CRITICAL' ? 26 : 30} textAnchor="middle" opacity={blink}>
              {status}
            </text>
          </g>
        </g>
        <ParticleBurst x={70 + 190} y={64 + 75} t={f - 262} seed="meter" color={mint} count={14} radius={150} duration={22} size={9} shape="sparkle" />
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
      <AbsoluteFill style={{ background: steel, opacity: openIn }} />
    </AbsoluteFill>
  );
};
