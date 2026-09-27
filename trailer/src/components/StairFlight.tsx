import React from 'react';
import { outline, slabEdge } from '../style/palette';

// One straight flight between two slabs: solid stringer under square risers, so no step floats.
// Rises from (x0, yBottom) to (x1, yTop); x1 may be left or right of x0.
export const StairFlight: React.FC<{
  x0: number;
  x1: number;
  yBottom: number;
  yTop: number;
  steps?: number;
  fill: string;
}> = ({ x0, x1, yBottom, yTop, steps = 10, fill }) => {
  const dx = (x1 - x0) / steps;
  const dy = (yBottom - yTop) / steps;
  let d = `M ${x0} ${yBottom}`;
  for (let i = 0; i < steps; i++) {
    const x = x0 + dx * i;
    const y = yBottom - dy * (i + 1);
    d += ` L ${x} ${y} L ${x + dx} ${y}`;
  }
  // underside: a straight soffit back down to the start, thick enough to read as concrete
  d += ` L ${x1} ${yTop + 22} L ${x0 + dx * 1.5} ${yBottom} Z`;
  return <path d={d} fill={fill} stroke={outline} strokeWidth={2} strokeLinejoin="round" />;
};

export const Railing: React.FC<{ x0: number; x1: number; yBottom: number; yTop: number }> = ({ x0, x1, yBottom, yTop }) => (
  <line x1={x0} y1={yBottom - 40} x2={x1} y2={yTop - 40} stroke={slabEdge} strokeWidth={3} strokeLinecap="round" />
);

/** Position along a flight for progress p (0..1): feet on the step nosings. */
export const onFlight = (x0: number, x1: number, yBottom: number, yTop: number, p: number, steps = 10) => {
  const x = x0 + (x1 - x0) * p;
  const stepIdx = Math.min(steps, Math.floor(p * steps) + 1);
  const y = p <= 0 ? yBottom : yBottom - ((yBottom - yTop) / steps) * stepIdx;
  return { x, y };
};
