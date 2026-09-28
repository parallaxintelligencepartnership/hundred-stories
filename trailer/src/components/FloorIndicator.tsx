import React from 'react';
import { mint, steel } from '../style/palette';
import { readout } from '../style/fonts';

// The mint floor readout above an elevator door, in the same style as the ShareClip floor badge.
// Origin is the panel centre; `pop` scales it on a tick.
export const FloorIndicator: React.FC<{ x: number; y: number; label: string; arrow?: string; pop?: number; size?: number; dim?: boolean }> = ({
  x,
  y,
  label,
  arrow,
  pop = 1,
  size = 56,
  dim = false,
}) => {
  const w = size * (arrow ? 2.4 : 1.6);
  const h = size * 1.2;
  return (
    <g transform={`translate(${x} ${y}) scale(${pop})`} opacity={dim ? 0.55 : 1}>
      <rect x={-w / 2} y={-h / 2} width={w} height={h} rx={size * 0.16} fill={steel} stroke={mint} strokeWidth={3} />
      {arrow && (
        <text x={-w / 2 + size * 0.55} y={size * 0.34} fill={mint} fontFamily={readout} fontSize={size * 0.6} textAnchor="middle">
          {arrow}
        </text>
      )}
      <text x={arrow ? size * 0.3 : 0} y={size * 0.34} fill={mint} fontFamily={readout} fontSize={size} textAnchor="middle">
        {label}
      </text>
    </g>
  );
};
