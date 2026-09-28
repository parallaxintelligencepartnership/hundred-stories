import React from 'react';
import { outline, people, slab, slabEdge } from '../style/palette';
import { TrashBag } from './TrashBag';

// The cleaner's cart: a staff-teal bin on two wheels with a push handle. `bags` is how many
// bag tops poke out of the bin (0..4). Origin is the floor under the bin centre.
export const JanitorCart: React.FC<{ x: number; y: number; bags?: number; handle?: 1 | -1; tilt?: number }> = ({ x, y, bags = 0, handle = 1, tilt = 0 }) => {
  const w = 130;
  const h = 84;
  const slots = [-34, 30, -2, 14];
  return (
    <g transform={`translate(${x} ${y}) rotate(${tilt} 0 0)`}>
      {/* bags sit in the bin; the bin front hides their lower half */}
      {slots.slice(0, Math.min(4, bags)).map((dx, i) => (
        <TrashBag key={i} x={dx} y={-h + 34 - (i >= 2 ? 16 : 0)} w={62} h={46} rot={i % 2 === 0 ? -10 : 12} />
      ))}
      <line x1={handle * (w / 2)} y1={-24} x2={handle * (w / 2 + 34)} y2={-h - 34} stroke={outline} strokeWidth={9} strokeLinecap="round" />
      <line x1={handle * (w / 2)} y1={-24} x2={handle * (w / 2 + 34)} y2={-h - 34} stroke={slab} strokeWidth={5} strokeLinecap="round" />
      <rect x={-w / 2} y={-h - 16} width={w} height={h} rx={8} fill={people.staffTop} stroke={outline} strokeWidth={2} />
      <rect x={-w / 2 - 4} y={-h - 20} width={w + 8} height={10} rx={4} fill={slab} stroke={slabEdge} strokeWidth={2} />
      <rect x={-w / 2 + 14} y={-h + 6} width={w - 28} height={8} rx={4} fill={outline} opacity={0.25} />
      {[-w / 2 + 20, w / 2 - 20].map((wx) => (
        <g key={wx}>
          <circle cx={wx} cy={-12} r={12} fill={people.shoe} stroke={outline} strokeWidth={2} />
          <circle cx={wx} cy={-12} r={4} fill={slab} />
        </g>
      ))}
    </g>
  );
};
