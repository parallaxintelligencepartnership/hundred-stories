import React from 'react';
import { outline, slab, slabEdge } from '../style/palette';

export const FLOOR_H = 110;
export const SLAB_H = 9;

// A room cell: wall, a darker shadow face on the right, 2px outline, and the slab along the bottom
// (docs/VISUAL.md). Interior actors are passed as children, clipped to the cell.
export const TowerFloor: React.FC<{
  id: string;
  x: number;
  y: number; // top of the floor
  w: number;
  h?: number;
  wall: string;
  shade?: string;
  children?: React.ReactNode;
}> = ({ id, x, y, w, h = FLOOR_H, wall, shade = '#00000022', children }) => (
  <g>
    <clipPath id={`clip-${id}`}>
      <rect x={x} y={y} width={w} height={h - SLAB_H} />
    </clipPath>
    <rect x={x} y={y} width={w} height={h} fill={wall} />
    <rect x={x + w - 16} y={y} width={16} height={h - SLAB_H} fill={shade} />
    <g clipPath={`url(#clip-${id})`}>{children}</g>
    <rect x={x} y={y + h - SLAB_H} width={w} height={SLAB_H} fill={slab} />
    <rect x={x} y={y + h - SLAB_H} width={w} height={2} fill={slabEdge} />
    <rect x={x} y={y} width={w} height={h} fill="none" stroke={outline} strokeWidth={2} />
  </g>
);
