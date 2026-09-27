import React from 'react';
import { random } from 'remotion';

// Flat-topped towers as plain rectangles. Deterministic from the seed; `drift` scrolls the layer
// horizontally (it wraps), which is how the low-parallax layers move at different speeds.
export const Skyline: React.FC<{
  gap?: [number, number];
  seed: string;
  color: string;
  baseY: number;
  minH: number;
  maxH: number;
  drift?: number;
  width?: number;
  opacity?: number;
  windows?: { color: string; x: number; y: number; w: number; h: number }[];
}> = ({ seed, color, baseY, minH, maxH, drift = 0, width = 1920, opacity = 1, windows, gap }) => {
  const blocks: { x: number; w: number; h: number }[] = [];
  let x = 0;
  let i = 0;
  while (x < width) {
    const w = 70 + Math.floor(random(`${seed}-w-${i}`) * 110);
    const h = minH + Math.floor(random(`${seed}-h-${i}`) * (maxH - minH));
    if (!gap || x + w < gap[0] || x > gap[1]) blocks.push({ x, w, h });
    x += w + Math.floor(random(`${seed}-g-${i}`) * 18);
    i++;
  }
  const off = ((drift % width) + width) % width;
  return (
    <g opacity={opacity}>
      {[0, 1].map((copy) => (
        <g key={copy} transform={`translate(${copy * width - off} 0)`}>
          {blocks.map((b, k) => (
            <rect key={k} x={b.x} y={baseY - b.h} width={b.w} height={b.h + 2} fill={color} />
          ))}
        </g>
      ))}
      {windows?.map((w, k) => <rect key={`w${k}`} x={w.x} y={w.y} width={w.w} height={w.h} fill={w.color} />)}
    </g>
  );
};
