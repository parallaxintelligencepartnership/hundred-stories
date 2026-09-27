import React from 'react';
import { amber, ink, inkDim, mint } from '../style/palette';
import { display } from '../style/fonts';

// The name set in the game's display face, ink on an amber bloom that echoes the first lit window.
export const Wordmark: React.FC<{
  opacity: number;
  scale: number;
  glow: number;
  size?: number;
}> = ({ opacity, scale, glow, size = 150 }) => (
  <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
    <div
      style={{
        position: 'absolute',
        width: size * 9,
        height: size * 3.4,
        borderRadius: '50%',
        background: `radial-gradient(ellipse at center, ${amber}88 0%, ${amber}33 35%, ${amber}00 70%)`,
        opacity: glow,
        filter: 'blur(20px)',
      }}
    />
    <div
      style={{
        fontFamily: display,
        fontWeight: 700,
        fontSize: size,
        letterSpacing: size * 0.04,
        color: ink,
        opacity,
        transform: `scale(${scale})`,
        textShadow: `0 0 ${size * 0.25}px ${amber}66, 0 4px 0 #00000055`,
        whiteSpace: 'nowrap',
      }}
    >
      HUNDRED STORIES
    </div>
  </div>
);

export const Caption: React.FC<{
  text: string;
  opacity: number;
  y: number;
  size?: number;
  color?: string;
  weight?: number;
  rise?: number;
  font?: string;
}> = ({ text, opacity, y, size = 44, color = ink, weight = 500, rise = 0, font = display }) => (
  <div
    style={{
      position: 'absolute',
      left: 0,
      right: 0,
      top: y,
      textAlign: 'center',
      fontFamily: font,
      fontSize: size,
      fontWeight: weight,
      color,
      opacity,
      transform: `translateY(${rise}px)`,
      textShadow: '0 2px 12px #000000aa',
    }}
  >
    {text}
  </div>
);

export const captionColors = { ink, inkDim, mint, amber };
