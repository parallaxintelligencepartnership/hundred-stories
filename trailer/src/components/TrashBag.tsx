import React from 'react';
import { inkDim, outline, shaftCavity } from '../style/palette';

// A tied bin bag in the game's style: rounded sack, 2px outline, two knot ears.
// Local origin is the bottom centre; `rot` tilts it about that point, `squash` is the landing squash.
export const TrashBag: React.FC<{
  x: number;
  y: number;
  w?: number;
  h?: number;
  rot?: number;
  squash?: number;
  fill?: string;
}> = ({ x, y, w = 96, h = 66, rot = 0, squash = 1, fill = shaftCavity }) => {
  const sx = 1 / Math.sqrt(squash);
  return (
    <g transform={`translate(${x} ${y}) rotate(${rot}) scale(${sx} ${squash})`}>
      <path
        d={`M ${-0.42 * w} 0 C ${-0.58 * w} ${-0.1 * h} ${-0.58 * w} ${-0.86 * h} ${-0.12 * w} ${-0.86 * h} L ${0.12 * w} ${-0.86 * h} C ${0.58 * w} ${-0.86 * h} ${0.58 * w} ${-0.1 * h} ${0.42 * w} 0 Z`}
        fill={fill}
        stroke={outline}
        strokeWidth={2}
        strokeLinejoin="round"
      />
      {/* crease and shine */}
      <path d={`M ${-0.3 * w} ${-0.62 * h} Q ${-0.36 * w} ${-0.35 * h} ${-0.28 * w} ${-0.14 * h}`} fill="none" stroke={inkDim} strokeOpacity={0.55} strokeWidth={3} strokeLinecap="round" />
      <path d={`M ${0.08 * w} ${-0.7 * h} Q ${0.16 * w} ${-0.45 * h} ${0.1 * w} ${-0.2 * h}`} fill="none" stroke={outline} strokeOpacity={0.5} strokeWidth={2} strokeLinecap="round" />
      {/* neck and knot ears */}
      <path d={`M ${-0.1 * w} ${-0.85 * h} L ${-0.03 * w} ${-0.97 * h} L ${0.03 * w} ${-0.97 * h} L ${0.1 * w} ${-0.85 * h} Z`} fill={fill} stroke={outline} strokeWidth={2} strokeLinejoin="round" />
      <ellipse cx={-0.09 * w} cy={-1.02 * h} rx={0.08 * w} ry={0.045 * h} transform={`rotate(-28 ${-0.09 * w} ${-1.02 * h})`} fill={fill} stroke={outline} strokeWidth={2} />
      <ellipse cx={0.09 * w} cy={-1.02 * h} rx={0.08 * w} ry={0.045 * h} transform={`rotate(28 ${0.09 * w} ${-1.02 * h})`} fill={fill} stroke={outline} strokeWidth={2} />
    </g>
  );
};

/** Bottom-centre and tilt of each bag in a leaning stack: every bag tilts a little more than the one below. */
export const bagStack = (n: number, baseX: number, baseY: number, theta: number, sway: number, step = 46, max = 11) => {
  const out: { x: number; y: number; rot: number }[] = [];
  let x = baseX;
  let y = baseY;
  for (let i = 0; i < n; i++) {
    const k = i / Math.max(1, max - 1);
    const phi = theta * (0.25 + 0.75 * k ** 1.3) + sway * k ** 2;
    if (i > 0) {
      const a = (phi * Math.PI) / 180;
      x += step * Math.sin(a);
      y -= step * Math.cos(a);
    }
    out.push({ x, y, rot: phi });
  }
  return out;
};
