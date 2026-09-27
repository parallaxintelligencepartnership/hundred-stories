import React from 'react';
import { Easing, interpolate, random } from 'remotion';
import { outline } from '../style/palette';

// A radial burst: dots or four-point sparkles flying out and fading. `t` is frames since the burst.
export const ParticleBurst: React.FC<{
  x: number;
  y: number;
  t: number;
  seed: string;
  color: string;
  count?: number;
  radius?: number;
  duration?: number;
  size?: number;
  shape?: 'dot' | 'sparkle' | 'drop';
  gravity?: number;
  spread?: [number, number];
}> = ({ x, y, t, seed, color, count = 10, radius = 60, duration = 24, size = 6, shape = 'dot', gravity = 0, spread = [0, 360] }) => {
  if (t < 0 || t > duration) return null;
  const p = Easing.out(Easing.cubic)(t / duration);
  const fade = interpolate(t, [duration * 0.5, duration], [1, 0], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
  return (
    <g opacity={fade}>
      {Array.from({ length: count }, (_, i) => {
        const a = ((spread[0] + (spread[1] - spread[0]) * ((i + random(`${seed}-a${i}`) * 0.6) / count)) * Math.PI) / 180;
        const r = radius * (0.6 + random(`${seed}-r${i}`) * 0.5) * p;
        const px = x + Math.cos(a) * r;
        const py = y + Math.sin(a) * r + gravity * (t / duration) ** 2;
        const s = size * (1 - p * 0.4);
        if (shape === 'sparkle') {
          return (
            <path
              key={i}
              d={`M ${px} ${py - s * 1.6} Q ${px} ${py} ${px + s * 1.6} ${py} Q ${px} ${py} ${px} ${py + s * 1.6} Q ${px} ${py} ${px - s * 1.6} ${py} Q ${px} ${py} ${px} ${py - s * 1.6} Z`}
              fill={color}
            />
          );
        }
        if (shape === 'drop') {
          return <path key={i} d={`M ${px} ${py - s * 1.5} Q ${px + s} ${py} ${px} ${py + s * 0.8} Q ${px - s} ${py} ${px} ${py - s * 1.5} Z`} fill={color} stroke={outline} strokeWidth={1.5} />;
        }
        return <circle key={i} cx={px} cy={py} r={s} fill={color} />;
      })}
    </g>
  );
};

/** Comic "pow" star: a spiky polygon, for the catch and the stumble. */
export const BurstStar: React.FC<{ x: number; y: number; r: number; fill: string; stroke?: string; points?: number; rot?: number; children?: React.ReactNode }> = ({
  x,
  y,
  r,
  fill,
  stroke = outline,
  points = 10,
  rot = 0,
  children,
}) => {
  const pts = Array.from({ length: points * 2 }, (_, i) => {
    const a = (i / (points * 2)) * Math.PI * 2 + (rot * Math.PI) / 180;
    const rr = i % 2 === 0 ? r : r * 0.62;
    return `${x + Math.cos(a) * rr},${y + Math.sin(a) * rr}`;
  }).join(' ');
  return (
    <g>
      <polygon points={pts} fill={fill} stroke={stroke} strokeWidth={3} strokeLinejoin="round" />
      {children}
    </g>
  );
};
