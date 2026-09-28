import React from 'react';
import { AbsoluteFill, Easing, useCurrentFrame } from 'remotion';
import { TenantPeg, walkPose } from '../components/TenantPeg';
import { ElevatorCar, Shaft } from '../components/ElevatorCar';
import { StairFlight, Railing, onFlight } from '../components/StairFlight';
import { ParticleBurst, BurstStar } from '../components/ParticleBurst';
import { Wordmark, Caption } from '../components/Wordmark';
import { fade, lerp, popIn, ramp, wobble } from '../components/anim';
import { alert, amber, ink, line, mint, outline, paneDay, people, room, shaftRail, slab, slabEdge, steel, steel2 } from '../style/palette';
import { display, loadFonts, readout } from '../style/fonts';

loadFonts();

const W = 1920;
const H = 1080;
const FH = 190;
/** Floor line (top of slab) of floor n, 1 based. */
const FB = (n: number) => 1040 - (n - 1) * FH;
const STAIR_L = 260;
const STAIR_R = 700;
const HALL_R = 1560;
const OOO_X = 820; // out of order door
const SHAFT_X = 1240;
const SHAFT_W = 160;
const CAR_W = 140;
const CAR_H = 150;

// Flights: floor k climbs from FB(k) to FB(k+1); odd floors run right to left, even left to right.
const FLIGHT_HI = 640;
const FLIGHT_LO = 320;
const flightX = (k: number) => (k % 2 === 1 ? [FLIGHT_HI, FLIGHT_LO] : [FLIGHT_LO, FLIGHT_HI]);
const FLIGHT_T = [60, 93, 126, 160, 218]; // start of flight k at index k-1, arrival at the end

type Pose = React.ComponentProps<typeof TenantPeg>;

/** Where the stair climber is and how they stand at frame f. */
const climber = (f: number): { x: number; y: number; camY: number; floor: number; pose: Partial<Pose>; stumble: boolean } => {
  if (f < 40) {
    const slump = ramp(f, 10, 6, Easing.out(Easing.quad));
    const squash = 1 - 0.16 * slump + wobble(f, 16, 0.06, 5, 0.9);
    return { x: 990, y: FB(1), camY: FB(1), floor: 1, stumble: false, pose: { facing: -1, squash, lean: 10 * slump, armFront: lerp(10, -4, slump), armBack: lerp(-10, 4, slump), bob: 6 * slump } };
  }
  if (f < 60) {
    const p = ramp(f, 40, 20, Easing.linear);
    return { x: lerp(990, FLIGHT_HI + 10, p), y: FB(1), camY: FB(1), floor: 1, stumble: false, pose: { facing: -1, ...walkPose(Math.floor(f / 4), 0.7), bob: 4, lean: 12 } };
  }
  for (let k = 1; k <= 4; k++) {
    const t0 = FLIGHT_T[k - 1];
    const t1 = FLIGHT_T[k];
    if (f < t1) {
      let p = (f - t0) / (t1 - t0);
      let stumble = false;
      // the stumble: on flight 2 the climber catches a toe and loses a few frames
      if (k === 2) {
        const s0 = 106;
        const s1 = 113;
        if (f >= s0 && f < s1) {
          stumble = true;
          p = (s0 - t0) / (t1 - t0);
        } else if (f >= s1) {
          p = ((s0 - t0) + (f - s1) * ((t1 - s0) / (t1 - s1))) / (t1 - t0);
        }
      }
      const [x0, x1] = flightX(k);
      const pos = onFlight(x0, x1, FB(k), FB(k + 1), p);
      const camY = lerp(FB(k), FB(k + 1), p);
      const facing = (x1 > x0 ? 1 : -1) as 1 | -1;
      const tired = k === 4 ? 0.6 : 1;
      const pose: Partial<Pose> = stumble
        ? { facing, lean: 34, squash: 0.84, armFront: 150, armBack: 120, legSwing: 40 }
        : { facing, ...walkPose(Math.floor(f / 4), 1.1 * tired), lean: 16 + (k === 4 ? 10 : 0) };
      return { x: pos.x, y: pos.y, camY, floor: p > 0.95 ? k + 1 : k, stumble, pose };
    }
  }
  // arrival: bursts through the top door, then heaves, then the exasperated pose
  const burst = ramp(f, 218, 9, Easing.out(Easing.quad));
  const x = lerp(FLIGHT_HI, 800, burst);
  if (f < 262) {
    const heave = Math.sin(f * 0.7);
    return {
      x,
      y: FB(5),
      camY: FB(5),
      floor: 5,
      stumble: false,
      pose: f < 227 ? { ...walkPose(Math.floor(f / 3), 1.3), facing: 1, squash: 1.12, lean: 20 } : { facing: 1, squash: 1 + 0.09 * heave, lean: 28, armFront: 30, armBack: 22, legSwing: 10, bob: 3 * heave },
    };
  }
  const throwUp = popIn(f, 262, 10);
  return { x, y: FB(5), camY: FB(5), floor: 5, stumble: false, pose: { facing: 1, squash: 1 + 0.05 * throwUp, lean: -6, armFront: lerp(30, 145, throwUp), armBack: lerp(22, -145, throwUp), legSwing: 14 } };
};

const carFloorY = (f: number) => lerp(FB(1), FB(5), ramp(f, 162, 50, Easing.inOut(Easing.cubic)));

type Cam = { x: number; y: number; s: number };
const cameraAt = (f: number): Cam => {
  const c = climber(f);
  const follow = (s: number): Cam => ({ x: Math.min(Math.max(c.x, 620), 1300), y: c.camY - 70, s });
  if (f < 40) return { x: 1070, y: FB(1) - 190, s: 1.3 };
  if (f < 160) return follow(1.25);
  if (f < 176) return follow(1.7);
  if (f < 192) return { x: SHAFT_X + SHAFT_W / 2 - 60, y: carFloorY(f) - CAR_H / 2, s: 1.7 };
  if (f < 206) return follow(1.7);
  if (f < 220) return { x: 1000, y: FB(5) - 10, s: 1.0 };
  if (f < 260) return { x: 1030, y: FB(5) - 70, s: 1.45 };
  if (f < 280) {
    const p = ramp(f, 260, 16);
    return { x: lerp(1030, 880, p), y: FB(5) - 70, s: lerp(1.45, 1.8, p) };
  }
  const z = ramp(f, 280, 18, Easing.in(Easing.cubic));
  return { x: 810, y: FB(5) - 90, s: lerp(1.8, 9, z) };
};

const Building: React.FC<{ f: number }> = ({ f }) => {
  const doorOpen5 = ramp(f, 218, 5, Easing.out(Easing.quad));
  return (
    <g>
      {/* ground */}
      <rect x={-2000} y={FB(1)} width={6000} height={800} fill={steel2} />
      {[1, 2, 3, 4, 5].map((n) => {
        const top = FB(n) - FH + 12;
        return (
          <g key={n}>
            {/* stairwell and hall walls */}
            <rect x={STAIR_L} y={FB(n) - FH} width={STAIR_R - STAIR_L} height={FH} fill={steel2} />
            <rect x={STAIR_R} y={top} width={HALL_R - STAIR_R} height={FH - 12} fill={room.office} />
            <rect x={STAIR_L} y={top} width={HALL_R - STAIR_L} height={FH - 12} fill="none" stroke={outline} strokeWidth={2} />
            {/* regular elevator door */}
            <rect x={OOO_X} y={FB(n) - 128} width={120} height={128} fill={shaftRail} stroke={outline} strokeWidth={2} />
            <line x1={OOO_X + 60} y1={FB(n) - 128} x2={OOO_X + 60} y2={FB(n)} stroke={outline} strokeWidth={2} />
            {/* stairwell door frame on the hall side */}
            <rect x={STAIR_R - 6} y={FB(n) - 120} width={12} height={120} fill={n === 5 ? steel : line} stroke={outline} strokeWidth={2} />
            {/* floor badge painted on the stairwell wall */}
            <text x={STAIR_L + 24} y={top + 42} fill={line} fontFamily={readout} fontSize={34}>
              {n}F
            </text>
          </g>
        );
      })}
      {/* out of order sign on floor 1 */}
      <g transform={`rotate(-4 ${OOO_X + 60} ${FB(1) - 80})`}>
        <rect x={OOO_X + 4} y={FB(1) - 100} width={112} height={44} rx={4} fill={alert} stroke={outline} strokeWidth={2} />
        <text x={OOO_X + 60} y={FB(1) - 82} fill={ink} fontFamily={display} fontWeight={800} fontSize={15} textAnchor="middle">
          OUT OF
        </text>
        <text x={OOO_X + 60} y={FB(1) - 64} fill={ink} fontFamily={display} fontWeight={800} fontSize={15} textAnchor="middle">
          ORDER
        </text>
      </g>
      {/* stairs: one flight per floor, landings as solid slab, openings over each flight */}
      {[1, 2, 3, 4].map((k) => {
        const [x0, x1] = flightX(k);
        return (
          <g key={k}>
            <StairFlight x0={x0} x1={x1} yBottom={FB(k)} yTop={FB(k + 1)} fill={slab} />
            <Railing x0={x0} x1={x1} yBottom={FB(k)} yTop={FB(k + 1)} />
          </g>
        );
      })}
      {/* express shaft through every floor */}
      <Shaft x={SHAFT_X} top={FB(5) - FH + 12} bottom={FB(1)} w={SHAFT_W} />
      {/* slabs: the hall is solid; in the stairwell only the landing end is solid */}
      {[1, 2, 3, 4, 5, 6].map((n) => {
        const y = FB(n);
        const land = n === 1 || n === 6 ? [STAIR_L, STAIR_R] : n % 2 === 0 ? [STAIR_L, FLIGHT_LO + 40] : [FLIGHT_HI - 40, STAIR_R];
        const y0 = n === 6 ? FB(5) - FH : y;
        return (
          <g key={n}>
            <rect x={land[0]} y={y0} width={land[1] - land[0]} height={12} fill={slab} stroke={slabEdge} strokeWidth={2} />
            <rect x={STAIR_R} y={y0} width={SHAFT_X - STAIR_R} height={12} fill={slab} stroke={slabEdge} strokeWidth={2} />
            <rect x={SHAFT_X + SHAFT_W} y={y0} width={HALL_R - SHAFT_X - SHAFT_W} height={12} fill={slab} stroke={slabEdge} strokeWidth={2} />
          </g>
        );
      })}
      {/* top floor stairwell door, swinging open */}
      <polygon
        points={`${STAIR_R - 6},${FB(5) - 120} ${STAIR_R + 6 + 56 * doorOpen5},${FB(5) - 120 - 10 * doorOpen5} ${STAIR_R + 6 + 56 * doorOpen5},${FB(5) + 6 * doorOpen5} ${STAIR_R - 6},${FB(5)}`}
        fill={room.condo}
        stroke={outline}
        strokeWidth={2}
        strokeLinejoin="round"
      />
    </g>
  );
};

export const ShareClip: React.FC = () => {
  const f = useCurrentFrame();
  const cam = cameraAt(f);
  const c = climber(f);
  const carY = carFloorY(f);
  const carOpen = f < 150 ? 1 : f < 160 ? 1 - ramp(f, 150, 8) : f >= 220 ? ramp(f, 220, 9, Easing.out(Easing.quad)) : 0;
  const vipStep = ramp(f, 230, 16, Easing.inOut(Easing.quad));
  const vipX = lerp(SHAFT_X + SHAFT_W / 2, 1110, vipStep);
  const vipOutside = f >= 230;
  const waveT = f - 246;
  const waving = waveT >= 0 && waveT < 34;
  const moving = f > 162 && f < 212;
  const dingFlash = f >= 220 && f < 232 ? 1 - (f - 220) / 12 : 0;

  // badge: follows the climber, ticks up as they pass floors 2, 3 and 4
  const badgeFloor = f < 93 ? 1 : f < 126 ? 2 : f < 160 ? 3 : 4;
  const badgeChange = [93, 126, 160].filter((t) => f >= t).pop() ?? -100;
  const badgePop = 1 + 0.35 * (1 - ramp(f, badgeChange, 8, Easing.out(Easing.back(3))));
  const showBadge = f >= 60 && f < 218;

  const vip = (x: number, y: number, facing: 1 | -1, extra: Partial<Pose> = {}) => (
    <TenantPeg x={x} y={y} scale={1} facing={facing} top={people.vipCoat} skin={people.skinB} hair={people.hairB} sunglasses armsCrossed {...extra} />
  );

  const worldZoom = f >= 280;
  const bloom = ramp(f, 284, 14, Easing.out(Easing.quad));
  const card = ramp(f, 294, 8);
  const cardOut = ramp(f, 344, 15, Easing.in(Easing.quad));
  const openIn = 1 - ramp(f, 0, 8, Easing.out(Easing.quad));

  return (
    <AbsoluteFill style={{ background: steel }}>
      <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} style={{ position: 'absolute', inset: 0 }}>
        <g transform={`translate(${W / 2} ${H / 2}) scale(${cam.s}) translate(${-cam.x} ${-cam.y})`}>
          <Building f={f} />
          {/* express car */}
          {moving &&
            [0, 1, 2, 3].map((k) => (
              <rect key={k} x={SHAFT_X + 20 + k * 36} y={carY + 10 + k * 22} width={6} height={120} rx={3} fill={mint} opacity={0.5} />
            ))}
          <ElevatorCar x={SHAFT_X + (SHAFT_W - CAR_W) / 2} y={carY} w={CAR_W} h={CAR_H} open={carOpen} flash={dingFlash} label={f < 162 ? '1' : f < 212 ? '▲' : '5'} shaftTop={FB(5) - FH + 12} glass>
            {!vipOutside && vip(SHAFT_X + SHAFT_W / 2, carY - 6, -1, { scale: 0.95 })}
          </ElevatorCar>
          {!vipOutside && f < 160 && (
            <ParticleBurst x={SHAFT_X + SHAFT_W / 2 + 20} y={carY - 110} t={f % 30} seed={`glint${Math.floor(f / 30)}`} color={mint} count={3} radius={26} duration={22} size={5} shape="sparkle" />
          )}
          {vipOutside &&
            vip(vipX, FB(5), -1, waving ? { armsCrossed: false, armFront: 150 + Math.sin((waveT / 34) * Math.PI * 4) * 22, armBack: -10 } : vipStep < 1 ? { armsCrossed: false, ...walkPose(Math.floor(f / 4), 0.5) } : {})}
          <ParticleBurst x={vipX} y={FB(5) - 80} t={f - 232} seed="vipout" color={mint} count={10} radius={80} duration={24} size={7} shape="sparkle" />
          {f >= 220 && f < 246 && (
            <text x={SHAFT_X + SHAFT_W / 2} y={FB(5) - 205 - 16 * ramp(f, 220, 10)} fill={mint} fontFamily={readout} fontSize={38} textAnchor="middle" opacity={1 - ramp(f, 234, 12)}>
              ding
            </text>
          )}

          {/* the climber */}
          <TenantPeg x={c.x} y={c.y} scale={1} top={people.topSweater} skin={people.skinA} hair={people.hairA} {...c.pose} />
          {c.stumble && (
            <g transform={`translate(${c.x + (c.pose.facing === -1 ? -50 : 50)} ${c.y - 120}) scale(${popIn(f, 106, 5)})`}>
              <BurstStar x={0} y={0} r={26} fill={amber} points={8}>
                <text x={0} y={11} fill={outline} fontFamily={display} fontWeight={800} fontSize={32} textAnchor="middle">
                  !
                </text>
              </BurstStar>
            </g>
          )}
          {f >= 227 &&
            [0, 1, 2, 3].map((k) => (
              <ParticleBurst key={k} x={c.x + 4} y={c.y - 100} t={(f - 227 - k * 11) % 44} seed={`sweat${k}`} color={paneDay} count={3} radius={42} duration={20} size={6} shape="drop" gravity={40} spread={[200, 340]} />
            ))}
          {f >= 218 && f < 232 && <ParticleBurst x={STAIR_R + 10} y={FB(5) - 60} t={f - 218} seed="door" color={line} count={8} radius={70} duration={14} size={5} spread={[-80, 80]} />}
          {showBadge && (
            <g transform={`translate(${c.x + (c.pose.facing === -1 ? 80 : -80)} ${c.y - 150}) scale(${badgePop})`}>
              <rect x={-30} y={-24} width={60} height={44} rx={8} fill={steel} stroke={mint} strokeWidth={3} />
              <text x={0} y={10} fill={mint} fontFamily={readout} fontSize={32} textAnchor="middle">
                {badgeFloor}F
              </text>
            </g>
          )}
        </g>
      </svg>
      {/* cut flash on the crosscuts */}
      {[176, 192, 206].map((t) => (f >= t && f < t + 3 ? <AbsoluteFill key={t} style={{ background: ink, opacity: 0.12 * (3 - (f - t)) }} /> : null))}
      {worldZoom && (
        <AbsoluteFill style={{ background: `radial-gradient(circle at 50% 50%, ${amber} 0%, ${amber}aa ${bloom * 30}%, ${steel} ${10 + bloom * 80}%)`, opacity: bloom }} />
      )}
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
