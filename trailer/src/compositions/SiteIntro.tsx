import React from 'react';
import { AbsoluteFill, Easing, Sequence, interpolateColors, random, useCurrentFrame } from 'remotion';
import { TenantPeg, walkPose } from '../components/TenantPeg';
import { Skyline } from '../components/Skyline';
import { TowerFloor, FLOOR_H } from '../components/TowerFloor';
import { ElevatorCar } from '../components/ElevatorCar';
import { ParticleBurst, BurstStar } from '../components/ParticleBurst';
import { Wordmark, Caption } from '../components/Wordmark';
import { Sky } from '../components/Sky';
import { fade, lerp, popIn, ramp, wobble } from '../components/anim';
import { alert, amber, black, ink, line, mint, outline, paneVacant, people, room, sky, steel, steel2 } from '../style/palette';
import { display, loadFonts, readout } from '../style/fonts';

loadFonts();

const W = 1920;
const H = 1080;
const GROUND = 900;
const TOWER_X = 720;
const TOWER_W = 480;
const BASE = 890; // top of the foundation slab: the lobby's floor line
const floorTop = (i: number) => BASE - (i + 1) * FLOOR_H;

const World: React.FC<{ transform: string; children: React.ReactNode }> = ({ transform, children }) => (
  <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} style={{ position: 'absolute', inset: 0 }}>
    <defs>
      <filter id="glow" x="-200%" y="-200%" width="500%" height="500%">
        <feGaussianBlur stdDeviation="10" />
      </filter>
      <filter id="glowSmall" x="-100%" y="-100%" width="300%" height="300%">
        <feGaussianBlur stdDeviation="4" />
      </filter>
    </defs>
    <g transform={transform}>{children}</g>
  </svg>
);

const camera = (s: number, fx: number, fy: number) => `translate(${W / 2} ${H / 2}) scale(${s}) translate(${-fx} ${-fy})`;

// ---------------------------------------------------------------- Scene 1: Spark
const WIN_X = 1330;
const WIN_Y = 560;

const Spark: React.FC = () => {
  const f = useCurrentFrame();
  const spark = popIn(f, 30, 16);
  const pull = ramp(f, 45, 115, Easing.inOut(Easing.cubic));
  const s = lerp(3, 1, pull);
  const fx = lerp(WIN_X, W / 2, pull);
  const fy = lerp(WIN_Y, H / 2, pull);
  const dawn = ramp(f, 100, 70, Easing.inOut(Easing.quad));
  const lot = fade(f, 150, 40);
  const slabPop = popIn(f, 252, 18);
  const flicker = 0.85 + 0.15 * Math.sin(f * 0.25);
  return (
    <AbsoluteFill style={{ background: black }}>
      <AbsoluteFill style={{ opacity: dawn, background: `linear-gradient(180deg, ${black} 0%, ${steel} 45%, ${sky.dusk} 80%, ${sky.dawn} 84%)` }} />
      <World transform={camera(s, fx, fy)}>
        <g opacity={lerp(0.25, 1, pull)}>
          <Skyline seed="s1-far" color={steel} baseY={GROUND} minH={140} maxH={330} gap={[TOWER_X - 30, TOWER_X + TOWER_W + 30]} />
          {/* the building that holds the one lit window */}
          <rect x={1270} y={GROUND - 460} width={150} height={462} fill={steel} />
        </g>
        <rect x={WIN_X - 8} y={WIN_Y - 11} width={16} height={22} fill={amber} opacity={spark} />
        <circle cx={WIN_X} cy={WIN_Y} r={26 * spark} fill={amber} opacity={0.7 * spark * flicker} filter="url(#glow)" />
        {/* ground and the empty lot */}
        <rect x={-2000} y={GROUND} width={6000} height={600} fill={black} />
        <rect x={-2000} y={GROUND} width={6000} height={2} fill={line} opacity={dawn} />
        <rect
          x={TOWER_X}
          y={floorTop(4)}
          width={TOWER_W}
          height={GROUND - floorTop(4)}
          fill="none"
          stroke={line}
          strokeWidth={2}
          strokeDasharray="10 10"
          opacity={lot}
        />
        <g transform={`translate(${TOWER_X + TOWER_W / 2} ${GROUND + 2}) scale(${slabPop}) translate(${-(TOWER_X + TOWER_W / 2)} ${-(GROUND + 2)})`}>
          <rect x={TOWER_X - 10} y={BASE} width={TOWER_W + 20} height={GROUND - BASE + 2} fill={steel2} stroke={line} strokeWidth={2} />
        </g>
      </World>
      <Caption text="Every tower starts with one story." opacity={fade(f, 200, 25)} rise={(1 - fade(f, 200, 25)) * 12} y={150} size={56} color={ink} />
    </AbsoluteFill>
  );
};

// ---------------------------------------------------------------- Scene 2: Build
const APPEAR = [8, 45, 80, 115, 150]; // lobby, shop, office, condo, cinema
const BUILD_S = 1.3;
const BUILD_FY = 575;
const CATCH = 212; // local frame of the thief catch (global 512)
const FREEZE_END = 236;

const Build: React.FC = () => {
  const raw = useCurrentFrame();
  // comic freeze-frame: everything in the scene holds while the flash and burst play
  const f = raw >= CATCH && raw < FREEZE_END ? CATCH : raw;

  const bob = APPEAR.reduce((acc, t) => acc + wobble(f, t + 6, 7, 6, 0.8), 0);
  const skyTop = interpolateColors(f, [0, 50, 190, 299], [sky.nightHorizon, sky.dayTop, sky.dayTop, sky.nightHorizon]);
  const skyHor = interpolateColors(f, [0, 50, 190, 299], [sky.dawn, sky.dayHorizon, sky.dayHorizon, sky.dusk]);
  const punch = raw >= CATCH && raw < FREEZE_END ? 1 + 0.06 * popIn(raw, CATCH, 6) : 1;
  const fy = BUILD_FY + bob + (punch > 1 ? -120 * (punch - 1) / 0.06 : 0);

  const floorPop = (i: number) => popIn(f, APPEAR[i], 14);
  const floorGroup = (i: number, content: React.ReactNode) => {
    const p = floorPop(i);
    if (p <= 0) return null;
    const cx = TOWER_X + TOWER_W / 2;
    const by = floorTop(i) + FLOOR_H;
    return (
      <g key={i} transform={`translate(${cx} ${by}) scale(${p}) translate(${-cx} ${-by})`}>
        {content}
      </g>
    );
  };

  // lobby: the elevator dings and a VIP steps out
  const ding = APPEAR[0] + 26;
  const doorsOpen = Math.min(ramp(f, ding, 8), 1 - ramp(f, ding + 70, 10));
  const vipWalk = ramp(f, ding + 8, 36, Easing.inOut(Easing.quad));
  const vipX = lerp(1125, 930, vipWalk);
  const vipPose = vipWalk > 0 && vipWalk < 1 ? walkPose(Math.floor(f / 4), 0.8) : null;

  // thief on the roof edge, caught by a guard from the roof door
  const roofY = floorTop(4);
  const thiefP = ramp(raw >= FREEZE_END ? CATCH : f, 170, CATCH - 170, Easing.linear);
  const thiefX = lerp(735, 900, thiefP);
  const exitP = ramp(raw, FREEZE_END + 6, 40, Easing.inOut(Easing.quad));
  const guardIn = ramp(f, 196, CATCH - 196, Easing.out(Easing.quad));
  const guardX = lerp(1110, 1000, guardIn) + exitP * 150;
  const caught = raw >= CATCH;
  const thiefShownX = caught ? thiefX + exitP * 150 + (raw >= FREEZE_END ? 25 * ramp(raw, FREEZE_END, 6) : 0) : thiefX;
  const flash = raw >= CATCH ? 1 - ramp(raw, CATCH, 10, Easing.out(Easing.quad)) : 0;

  return (
    <AbsoluteFill>
      <Sky top={skyTop} horizon={skyHor} horizonAt={80} />
      <World transform={camera(BUILD_S * punch, W / 2, fy)}>
        <Skyline seed="p-far" color={line} baseY={GROUND} minH={220} maxH={420} drift={f * 0.35} opacity={0.55} />
        <Skyline seed="p-mid" color={steel2} baseY={GROUND} minH={130} maxH={280} drift={f * 0.8} opacity={0.85} />
        <Skyline seed="p-near" color={steel} baseY={GROUND} minH={60} maxH={150} drift={f * 1.4} />
        <rect x={-400} y={GROUND} width={W + 800} height={400} fill={steel2} />
        <rect x={-400} y={GROUND} width={W + 800} height={2} fill={line} />
        <rect x={TOWER_X - 10} y={BASE} width={TOWER_W + 20} height={GROUND - BASE + 2} fill={steel2} stroke={line} strokeWidth={2} />

        {floorGroup(
          0,
          <TowerFloor id="lobby" x={TOWER_X} y={floorTop(0)} w={TOWER_W} wall={room.lobby}>
            {[790, 950].map((x) => (
              <rect key={x} x={x} y={floorTop(0)} width={12} height={FLOOR_H} fill={room.lobbyColumn} />
            ))}
            <ElevatorCar x={1085} y={BASE} w={80} h={92} open={doorsOpen} flash={f >= ding && f < ding + 10 ? 1 - (f - ding) / 10 : 0}>
              {vipWalk <= 0 && <TenantPeg x={1125} y={BASE - 2} scale={0.7} facing={-1} top={people.vipCoat} skin={people.skinB} hair={people.hairB} sunglasses armsCrossed />}
            </ElevatorCar>
            {vipWalk > 0 && (
              <TenantPeg
                x={vipX}
                y={BASE - 2}
                scale={0.72}
                facing={-1}
                top={people.vipCoat}
                skin={people.skinB}
                hair={people.hairB}
                sunglasses
                armsCrossed={!vipPose}
                {...(vipPose ?? {})}
              />
            )}
            <ParticleBurst x={1125} y={BASE - 55} t={f - ding - 6} seed="vip" color={mint} count={12} radius={70} duration={26} size={7} shape="sparkle" />
          </TowerFloor>,
        )}
        {f >= ding && f < ding + 26 && (
          <text x={1125} y={floorTop(0) - 8 - 20 * ramp(f, ding, 10)} fill={mint} fontFamily={readout} fontSize={30} textAnchor="middle" opacity={1 - ramp(f, ding + 14, 12)}>
            ding
          </text>
        )}

        {floorGroup(
          1,
          <TowerFloor id="shop" x={TOWER_X} y={floorTop(1)} w={TOWER_W} wall={room.shop}>
            <ShopAction f={f} top={floorTop(1)} />
          </TowerFloor>,
        )}
        {floorGroup(
          2,
          <TowerFloor id="office" x={TOWER_X} y={floorTop(2)} w={TOWER_W} wall={room.office}>
            <OfficeAction f={f} top={floorTop(2)} />
          </TowerFloor>,
        )}
        {floorGroup(
          3,
          <TowerFloor id="condo" x={TOWER_X} y={floorTop(3)} w={TOWER_W} wall={room.condo}>
            <CondoAction f={f} top={floorTop(3)} since={APPEAR[3]} skyColor={skyHor} />
          </TowerFloor>,
        )}
        {floorGroup(
          4,
          <TowerFloor id="cinema" x={TOWER_X} y={floorTop(4)} w={TOWER_W} wall={room.cinema} shade="#00000044">
            <CinemaAction f={f} top={floorTop(4)} />
          </TowerFloor>,
        )}

        {/* roof: thief and guard */}
        {f >= 160 && (
          <g>
            {!caught && (
              <TenantPeg
                x={thiefX}
                y={roofY}
                scale={0.72}
                silhouette={steel}
                lean={18}
                legSwing={Math.sin(f * 0.45) * 30}
                armBack={120}
                armFront={140 + Math.sin(f * 0.45) * 10}
                squash={0.92 + 0.05 * Math.abs(Math.sin(f * 0.45))}
              />
            )}
            {caught && exitP < 1 && (
              <TenantPeg
                x={thiefShownX}
                y={roofY - (raw < FREEZE_END ? 18 : 0)}
                scale={0.72}
                silhouette={steel}
                facing={raw < FREEZE_END ? 1 : 1}
                armBack={170}
                armFront={165}
                legSwing={raw < FREEZE_END ? 35 : exitP > 0 ? Math.sin(raw * 0.5) * 18 : 0}
                squash={raw < FREEZE_END ? 1.12 : 1}
              />
            )}
            {guardIn > 0 && exitP < 1 && (
              <TenantPeg
                x={guardX}
                y={roofY}
                scale={0.75}
                facing={caught && raw >= FREEZE_END ? 1 : -1}
                top={people.guardTop}
                bottom={people.guardTop}
                cap={people.guardCap}
                skin={people.skinC}
                {...(!caught ? walkPose(Math.floor(f / 3), 1.2) : exitP > 0 ? walkPose(Math.floor(raw / 4), 0.7) : {})}
                lean={caught ? 0 : 12}
                armFront={caught && raw < FREEZE_END ? 95 : !caught ? 60 : 30}
                armBack={caught ? -20 : -50}
              />
            )}
            {/* roof access hut, drawn after the figures so they walk into it */}
            <rect x={1080} y={roofY - 70} width={90} height={70} fill={steel2} stroke={outline} strokeWidth={2} />
            <rect x={1090} y={roofY - 56} width={34} height={56} fill={steel} stroke={outline} strokeWidth={2} />
          </g>
        )}
        {raw >= CATCH && raw < FREEZE_END + 4 && (
          <g transform={`translate(${(thiefX + 1000) / 2} ${roofY - 150}) scale(${popIn(raw, CATCH, 8)})`}>
            <BurstStar x={0} y={0} r={52} fill={alert} rot={f * 0}>
              <text x={0} y={16} fill={ink} fontFamily={display} fontWeight={800} fontSize={48} textAnchor="middle">
                !
              </text>
            </BurstStar>
          </g>
        )}
      </World>
      {flash > 0 && <AbsoluteFill style={{ background: alert, opacity: flash * 0.45 }} />}
      {raw >= CATCH && raw < FREEZE_END && <AbsoluteFill style={{ boxShadow: `inset 0 0 160px ${alert}` , opacity: 0.8 }} />}
    </AbsoluteFill>
  );
};

const ShopAction: React.FC<{ f: number; top: number }> = ({ f, top }) => {
  const floor = top + FLOOR_H - 9;
  const cyc = (f % 48) / 48;
  const tip = Math.sin(cyc * Math.PI * 2);
  const armA = 95 + tip * 25;
  const hx = 830 + Math.sin((armA * Math.PI) / 180) * 28 * 0.72;
  const hy = floor - 60 * 0.72 + Math.cos((armA * Math.PI) / 180) * 28 * 0.72;
  return (
    <g>
      <TenantPeg x={830} y={floor} scale={0.72} top={people.staffTop} apron skin={people.skinD} armFront={armA} armBack={-10} />
      <g transform={`rotate(${tip * 25} ${hx} ${hy})`}>
        <rect x={hx - 3} y={hy - 18} width={14} height={16} rx={3} fill={room.lobby} stroke={outline} strokeWidth={2} />
      </g>
      {[0, 1, 2].map((k) => {
        const t = ((f + k * 16) % 48) / 48;
        return (
          <circle key={k} cx={hx + 4 + Math.sin(t * 7 + k) * 5} cy={hy - 22 - t * 34} r={3 + t * 4} fill={room.lobby} opacity={0.9 * (1 - t)} stroke={line} strokeWidth={1} />
        );
      })}
      {/* counter */}
      <rect x={870} y={floor - 38} width={130} height={38} fill={people.staffTop} stroke={outline} strokeWidth={2} />
      <rect x={866} y={floor - 42} width={138} height={6} fill={room.lobby} stroke={outline} strokeWidth={2} />
      <TenantPeg x={1060} y={floor} scale={0.72} facing={-1} top={people.topTee} skin={people.skinA} hair={people.hairB} armFront={20 + Math.sin(f * 0.1) * 6} />
    </g>
  );
};

const OfficeAction: React.FC<{ f: number; top: number }> = ({ f, top }) => {
  const floor = top + FLOOR_H - 9;
  const typing = Math.abs(Math.sin(f * 0.9));
  return (
    <g>
      <TenantPeg x={880} y={floor} scale={0.72} sitting top={people.topJacket} skin={people.skinC} hair={people.hairA} bob={typing * 3} armFront={78 + typing * 12} armBack={70 - typing * 10} />
      {/* desk and monitor */}
      <rect x={920} y={floor - 44} width={130} height={8} fill={steel2} stroke={outline} strokeWidth={2} />
      <rect x={1030} y={floor - 36} width={8} height={36} fill={steel2} />
      <rect x={955} y={floor - 90} width={62} height={42} rx={3} fill={paneVacant} stroke={outline} strokeWidth={2} />
      {[0, 1, 2].map((k) => (
        <rect key={k} x={962} y={floor - 82 + k * 10} width={(20 + ((Math.floor(f / 3) + k * 7) % 5) * 7)} height={3} fill={mint} opacity={0.9} />
      ))}
      <rect x={982} y={floor - 48} width={8} height={4} fill={steel2} />
    </g>
  );
};

const CondoAction: React.FC<{ f: number; top: number; since: number; skyColor: string }> = ({ f, top, since, skyColor }) => {
  const floor = top + FLOOR_H - 9;
  const t = f - since - 16;
  const waving = t > 0 && t < 36;
  const wave = waving ? 150 + Math.sin((t / 36) * Math.PI * 4) * 25 : 20;
  return (
    <g>
      <rect x={1030} y={top + 14} width={110} height={52} fill={skyColor} stroke={outline} strokeWidth={2} />
      <line x1={1085} y1={top + 14} x2={1085} y2={top + 66} stroke={outline} strokeWidth={2} />
      <rect x={1024} y={top + 64} width={122} height={8} fill={room.lobby} stroke={outline} strokeWidth={2} />
      <TenantPeg x={1060} y={top + 70} scale={0.62} sitting facing={-1} top={people.topSweater} skin={people.skinB} hair={people.hairB} armFront={wave} armBack={-15} />
      {/* sofa */}
      <rect x={780} y={floor - 34} width={130} height={34} rx={8} fill={people.topTee} stroke={outline} strokeWidth={2} />
      <rect x={780} y={floor - 50} width={130} height={20} rx={8} fill={people.topTee} stroke={outline} strokeWidth={2} />
    </g>
  );
};

const CinemaAction: React.FC<{ f: number; top: number }> = ({ f, top }) => {
  const pulse = 0.55 + 0.45 * (0.5 + 0.5 * Math.sin(f * 0.25));
  const floor = top + FLOOR_H - 9;
  return (
    <g>
      <rect x={1000} y={top + 16} width={170} height={58} fill={ink} opacity={0.18 + 0.1 * Math.sin(f * 0.6)} />
      <rect x={760} y={top + 14} width={200} height={40} rx={4} fill={steel} stroke={amber} strokeWidth={3} />
      <rect x={760} y={top + 14} width={200} height={40} rx={4} fill={amber} opacity={pulse * 0.35} filter="url(#glowSmall)" />
      <text x={860} y={top + 43} fill={amber} opacity={0.6 + 0.4 * pulse} fontFamily={display} fontWeight={700} fontSize={26} textAnchor="middle">
        NOW SHOWING
      </text>
      {Array.from({ length: 10 }, (_, k) => (
        <circle key={k} cx={768 + k * 20.5} cy={top + 60} r={3} fill={amber} opacity={(Math.floor(f / 6) + k) % 2 === 0 ? 1 : 0.25} />
      ))}
      {[800, 850, 900, 1030, 1080, 1130].map((x, k) => (
        <circle key={x} cx={x} cy={floor - 22 - (k % 2) * 3} r={11} fill={steel} />
      ))}
      <rect x={760} y={floor - 14} width={400} height={14} fill={steel} />
    </g>
  );
};

// ---------------------------------------------------------------- Scene 3: Every Floor
const TOTAL_FLOORS = 18;
const WALLS = [room.lobby, room.shop, room.office, room.condo, room.cinema, room.office, room.condo, room.shop, room.office];

const EveryFloor: React.FC = () => {
  const f = useCurrentFrame();
  const pull = ramp(f, 0, 150, Easing.inOut(Easing.cubic));
  const s = lerp(BUILD_S, 0.42, pull);
  const fy = lerp(BUILD_FY, -195, pull);
  const comet = ramp(f, 100, 34, Easing.in(Easing.quad));
  const wmIn = fade(f, 150, 28);
  const wmScale = lerp(0.86, 1, popIn(f, 150, 26));
  const blackout = ramp(f, 280, 19, Easing.in(Easing.quad));

  return (
    <AbsoluteFill>
      <Sky top={sky.nightTop} horizon={sky.nightHorizon} horizonAt={90} />
      {/* stars */}
      <svg width={W} height={H} style={{ position: 'absolute', inset: 0 }}>
        {Array.from({ length: 70 }, (_, i) => (
          <circle
            key={i}
            cx={random(`sx${i}`) * W}
            cy={random(`sy${i}`) * 620}
            r={1 + random(`sr${i}`) * 1.6}
            fill={ink}
            opacity={0.3 + 0.5 * (0.5 + 0.5 * Math.sin(f * 0.08 + i))}
          />
        ))}
        {comet > 0 && comet < 1 && (
          <g>
            <defs>
              <linearGradient id="tail" x1="0" y1="0" x2="1" y2="0">
                <stop offset="0" stopColor={amber} stopOpacity={0} />
                <stop offset="1" stopColor={amber} stopOpacity={1} />
              </linearGradient>
            </defs>
            <g transform={`translate(${lerp(-200, 2100, comet)} ${lerp(40, 460, comet)}) rotate(${(Math.atan2(420, 2300) * 180) / Math.PI})`}>
              <rect x={-260} y={-2} width={260} height={4} rx={2} fill="url(#tail)" />
              <circle cx={0} cy={0} r={5} fill={ink} />
            </g>
          </g>
        )}
      </svg>
      <World transform={camera(s, W / 2, fy)}>
        <Skyline seed="p-far" color={line} baseY={GROUND} minH={220} maxH={420} drift={300 * 0.35 + f * 0.2} opacity={0.35} width={4000} />
        <Skyline seed="p-mid" color={steel2} baseY={GROUND} minH={130} maxH={280} drift={300 * 0.8 + f * 0.4} width={4000} />
        <rect x={-3000} y={GROUND} width={9000} height={1200} fill={steel2} />
        <rect x={-3000} y={GROUND} width={9000} height={2} fill={line} />
        <rect x={TOWER_X - 10} y={BASE} width={TOWER_W + 20} height={GROUND - BASE + 2} fill={steel2} stroke={line} strokeWidth={2} />
        {Array.from({ length: TOTAL_FLOORS }, (_, i) => {
          const p = i < 5 ? 1 : popIn(f, 6 + (i - 5) * 5, 12);
          if (p <= 0) return null;
          return <NightFloor key={i} i={i} f={f} p={p} />;
        })}
      </World>
      {/* legibility veil for the title */}
      <AbsoluteFill style={{ background: `linear-gradient(180deg, ${steel}00 0%, ${steel}00 30%, ${steel}f2 36%, ${steel}f2 76%, ${steel}00 82%, ${steel}00 100%)`, opacity: wmIn }} />
      <Wordmark opacity={wmIn} scale={wmScale} glow={wmIn * (0.8 + 0.2 * Math.sin(f * 0.12))} size={140} />
      <Caption text="Every floor is a story. Everyone's got one." opacity={fade(f, 200, 24)} rise={(1 - fade(f, 200, 24)) * 10} y={640} size={48} color={ink} />
      <Caption text="Build yours — free to play." opacity={fade(f, 250, 20)} rise={(1 - fade(f, 250, 20)) * 8} y={722} size={34} color={mint} weight={400} />
      <AbsoluteFill style={{ background: black, opacity: blackout }} />
    </AbsoluteFill>
  );
};

const NightFloor: React.FC<{ i: number; f: number; p: number }> = ({ i, f, p }) => {
  const y = floorTop(i);
  const cx = TOWER_X + TOWER_W / 2;
  const by = y + FLOOR_H;
  const panes = 7;
  const pw = 44;
  const gap = (TOWER_W - panes * pw) / (panes + 1);
  return (
    <g transform={`translate(${cx} ${by}) scale(${p}) translate(${-cx} ${-by})`}>
      <TowerFloor id={`n${i}`} x={TOWER_X} y={y} w={TOWER_W} wall={WALLS[i % WALLS.length]}>
        <rect x={TOWER_X} y={y} width={TOWER_W} height={FLOOR_H} fill={sky.nightTop} opacity={0.62} />
        {Array.from({ length: panes }, (_, k) => {
          const r = random(`pane-${i}-${k}`);
          const px = TOWER_X + gap + k * (pw + gap);
          const lit = r < 0.8;
          const color = !lit ? paneVacant : r < 0.52 ? amber : mint;
          return (
            <g key={k}>
              {lit && <rect x={px - 8} y={y + 12} width={pw + 16} height={76} fill={color} opacity={0.25} filter="url(#glowSmall)" />}
              <rect x={px} y={y + 18} width={pw} height={64} fill={color} stroke={outline} strokeWidth={2} />
            </g>
          );
        })}
        {/* a few tenants moving past the lit windows */}
        {random(`who-${i}`) < 0.6 && (
          <TenantPeg
            x={TOWER_X + 40 + ((random(`wx-${i}`) * 400 + f * (0.6 + random(`ws-${i}`))) % 420)}
            y={y + FLOOR_H - 9}
            scale={0.7}
            silhouette={steel}
            facing={1}
            {...walkPose(Math.floor((f + i * 3) / 5), 0.8)}
          />
        )}
      </TowerFloor>
    </g>
  );
};

// ---------------------------------------------------------------- composition
export const SiteIntro: React.FC = () => (
  <AbsoluteFill style={{ background: black }}>
    <Sequence from={0} durationInFrames={300} name="Spark">
      <Spark />
    </Sequence>
    <Sequence from={300} durationInFrames={300} name="Build">
      <Build />
    </Sequence>
    <Sequence from={600} durationInFrames={300} name="Every Floor">
      <EveryFloor />
    </Sequence>
  </AbsoluteFill>
);
