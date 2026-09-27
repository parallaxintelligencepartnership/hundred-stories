import React from 'react';
import { carHandrail, carInterior, mint, outline, shaftCavity, shaftRail, steel2 } from '../style/palette';
import { readout } from '../style/fonts';

// A shaft: cavity, two rails and the cable to the top (docs/VISUAL.md shafts).
export const Shaft: React.FC<{ x: number; top: number; bottom: number; w: number }> = ({ x, top, bottom, w }) => (
  <g>
    <rect x={x} y={top} width={w} height={bottom - top} fill={shaftCavity} />
    <rect x={x + 6} y={top} width={4} height={bottom - top} fill={shaftRail} />
    <rect x={x + w - 10} y={top} width={4} height={bottom - top} fill={shaftRail} />
  </g>
);

// The car: rounded crown, mint highlight edge and indicator, sliding doors. `open` is 0..1.
// Passengers are drawn as children between the back wall and the doors.
export const ElevatorCar: React.FC<{
  x: number;
  y: number; // floor of the car
  w: number;
  h: number;
  open: number;
  label?: string;
  flash?: number;
  shaftTop?: number;
  /** Glass doors: passengers stay visible while the car travels. */
  glass?: boolean;
  children?: React.ReactNode;
}> = ({ x, y, w, h, open, label, flash = 0, shaftTop, glass = false, children }) => {
  const clipId = `car-${Math.round(x)}-${w}`;
  const top = y - h;
  const doorW = (w - 12) / 2;
  const slide = doorW * open;
  return (
    <g>
      {shaftTop !== undefined && <line x1={x + w / 2} y1={shaftTop} x2={x + w / 2} y2={top - 10} stroke={shaftCavity} strokeWidth={2} />}
      <path
        d={`M ${x} ${y} L ${x} ${top + 12} Q ${x} ${top - 10} ${x + w / 2} ${top - 10} Q ${x + w} ${top - 10} ${x + w} ${top + 12} L ${x + w} ${y} Z`}
        fill={steel2}
        stroke={outline}
        strokeWidth={2}
      />
      <rect x={x + 6} y={top + 6} width={w - 12} height={h - 10} fill={carInterior} />
      <line x1={x + 10} y1={top + h * 0.55} x2={x + w - 10} y2={top + h * 0.55} stroke={carHandrail} strokeWidth={3} />
      {children}
      {/* doors */}
      <clipPath id={clipId}>
        <rect x={x + 6} y={top + 6} width={w - 12} height={h - 10} />
      </clipPath>
      <g clipPath={`url(#${clipId})`}>
        <rect x={x + 6 - slide} y={top + 6} width={doorW} height={h - 10} fill={shaftRail} fillOpacity={glass ? 0.35 : 1} stroke={outline} strokeWidth={2} />
        <rect x={x + 6 + doorW + slide} y={top + 6} width={doorW} height={h - 10} fill={shaftRail} fillOpacity={glass ? 0.35 : 1} stroke={outline} strokeWidth={2} />
      </g>
      <rect x={x + 3} y={top + 4} width={w - 6} height={h - 6} fill="none" stroke={mint} strokeWidth={3} />
      {label && (
        <text x={x + w / 2} y={top - 16} fill={mint} fontFamily={readout} fontSize={22} textAnchor="middle">
          {label}
        </text>
      )}
      {flash > 0 && <rect x={x - 20} y={top - 20} width={w + 40} height={h + 30} fill={mint} opacity={flash * 0.6} rx={16} />}
    </g>
  );
};
