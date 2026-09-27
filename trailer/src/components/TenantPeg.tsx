import React from 'react';
import { outline, people } from '../style/palette';

// A peg person in the game's illustrated style: rounded shapes, 2px dark outline, no face detail.
// Local origin is the feet; the figure is about 100 units tall at scale 1 and faces right.
export type PegProps = {
  x: number;
  y: number;
  scale?: number;
  facing?: 1 | -1;
  skin?: string;
  hair?: string;
  top?: string;
  bottom?: string;
  /** Arm angles in degrees from hanging straight down; positive swings forward/up. */
  armBack?: number;
  armFront?: number;
  /** Arms folded across the chest (overrides the angles). */
  armsCrossed?: boolean;
  /** Leg swing in degrees (walk cycle); positive puts the front leg forward. */
  legSwing?: number;
  /** Sitting: legs bent forward. */
  sitting?: boolean;
  /** Vertical squash-stretch: 1 is rest, below 1 squashes. Width compensates. */
  squash?: number;
  /** Forward lean of the whole body in degrees. */
  lean?: number;
  /** Extra vertical offset of the upper body (breathing, typing bob). */
  bob?: number;
  sunglasses?: boolean;
  cap?: string;
  apron?: boolean;
  /** Draw as a flat silhouette in this colour (thief, night windows). */
  silhouette?: string;
  opacity?: number;
  children?: React.ReactNode;
};

const limb = (x1: number, y1: number, x2: number, y2: number, color: string, w: number, stroke: string) => (
  <g>
    <line x1={x1} y1={y1} x2={x2} y2={y2} stroke={stroke} strokeWidth={w + 4} strokeLinecap="round" />
    <line x1={x1} y1={y1} x2={x2} y2={y2} stroke={color} strokeWidth={w} strokeLinecap="round" />
  </g>
);

const rad = (d: number) => (d * Math.PI) / 180;

export const TenantPeg: React.FC<PegProps> = ({
  x,
  y,
  scale = 1,
  facing = 1,
  skin = people.skinA,
  hair = people.hairA,
  top = people.topJacket,
  bottom = people.trousers,
  armBack = -8,
  armFront = 8,
  armsCrossed = false,
  legSwing = 0,
  sitting = false,
  squash = 1,
  lean = 0,
  bob = 0,
  sunglasses = false,
  cap,
  apron = false,
  silhouette,
  opacity = 1,
  children,
}) => {
  const sil = silhouette;
  const st = sil ?? outline;
  const cSkin = sil ?? skin;
  const cHair = sil ?? hair;
  const cTop = sil ?? top;
  const cBottom = sil ?? bottom;
  const hipY = -30;
  const shoulderY = -60 + bob;
  const armLen = 28;
  const legLen = 30;

  const legEnd = (deg: number) => [Math.sin(rad(deg)) * legLen, hipY + Math.cos(rad(deg)) * legLen] as const;
  const armEnd = (deg: number) => [Math.sin(rad(deg)) * armLen, shoulderY + Math.cos(rad(deg)) * armLen] as const;

  const [lbx, lby] = sitting ? [22, hipY + 4] : legEnd(-legSwing);
  const [lfx, lfy] = sitting ? [26, hipY + 8] : legEnd(legSwing);
  const [abx, aby] = armEnd(armBack);
  const [afx, afy] = armEnd(armFront);
  const sx = 1 / Math.sqrt(squash);

  return (
    <g transform={`translate(${x} ${y}) scale(${scale * facing * sx} ${scale * squash})`} opacity={opacity}>
      <g transform={`rotate(${lean} 0 ${hipY})`}>
        {/* back limbs */}
        {!armsCrossed && limb(0, shoulderY + 4, abx, aby, cTop, 8, st)}
        {limb(-4, hipY, lbx - 4, lby, cBottom, 9, st)}
        {sitting && limb(lbx - 4, lby, lbx - 2, 0, cBottom, 9, st)}
        {/* body */}
        <rect x={-13} y={shoulderY - 8} width={26} height={hipY - shoulderY + 12} rx={11} fill={cTop} stroke={st} strokeWidth={2} />
        {apron && !sil && <rect x={-9} y={shoulderY + 10} width={18} height={hipY - shoulderY - 6} rx={3} fill={people.apron} stroke={st} strokeWidth={2} />}
        {/* head */}
        <circle cx={1} cy={shoulderY - 22} r={14} fill={cSkin} stroke={st} strokeWidth={2} />
        <path
          d={`M ${-13} ${shoulderY - 22} A 14 14 0 0 1 ${15} ${shoulderY - 24} Q 4 ${shoulderY - 30} ${-13} ${shoulderY - 22} Z`}
          fill={cHair}
          stroke={st}
          strokeWidth={2}
          strokeLinejoin="round"
        />
        {cap && <path d={`M -13 ${shoulderY - 30} Q 1 ${shoulderY - 44} 15 ${shoulderY - 30} L 22 ${shoulderY - 28} L -13 ${shoulderY - 28} Z`} fill={sil ?? cap} stroke={st} strokeWidth={2} />}
        {sunglasses && !sil && (
          <g>
            <rect x={3} y={shoulderY - 26} width={13} height={6} rx={2} fill={people.sunglasses} />
            <line x1={-6} y1={shoulderY - 24} x2={4} y2={shoulderY - 24} stroke={people.sunglasses} strokeWidth={2} />
          </g>
        )}
        {/* front limbs */}
        {limb(4, hipY, lfx + 4, lfy, cBottom, 9, st)}
        {sitting && limb(lfx + 4, lfy, lfx + 6, 0, cBottom, 9, st)}
        {armsCrossed
          ? limb(-9, shoulderY + 14, 11, shoulderY + 12, cTop, 9, st)
          : limb(0, shoulderY + 4, afx, afy, cTop, 8, st)}
        {!armsCrossed && <circle cx={afx} cy={afy} r={4.5} fill={cSkin} stroke={st} strokeWidth={2} />}
        {children}
      </g>
    </g>
  );
};

/** The four-pose wobble walk cycle: returns limb angles for pose 0..3. */
export const walkPose = (pose: number, amp = 1) => {
  const p = ((pose % 4) + 4) % 4;
  const legs = [26, 0, -26, 0][p] * amp;
  const arms = [-28, 0, 28, 0][p] * amp;
  const lean = [4, 8, 4, 8][p];
  const squash = [1, 0.94, 1, 0.94][p];
  return { legSwing: legs, armBack: arms, armFront: -arms, lean, squash };
};
