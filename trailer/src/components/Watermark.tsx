import React from 'react';
import { Img } from 'remotion';
import wordmarkUrl from '../../../public/wordmark-line-dark.svg';
import { ink, steel } from '../style/palette';
import { display } from '../style/fonts';

/**
 * A brief solid title card at the very start of a share clip, so anyone
 * scrolling past on social knows what game this is before the gag even
 * lands. Opaque, not a ghost overlay, so it fully occludes the action
 * until it clears.
 */
export const OpeningBumper: React.FC<{ opacity: number; scale: number }> = ({ opacity, scale }) => (
  <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', opacity, pointerEvents: 'none', background: steel }}>
    <Img src={wordmarkUrl} alt="Hundred Stories" style={{ width: 620, transform: `scale(${scale})` }} />
    <div style={{ marginTop: 18, fontFamily: display, fontSize: 30, fontWeight: 500, color: ink, letterSpacing: 1 }}>hundredstories.xyz</div>
  </div>
);

/**
 * Small persistent corner mark during the action, so a mid-clip screenshot
 * or a scrubbed frame still identifies the game.
 */
export const CornerWatermark: React.FC<{ opacity: number }> = ({ opacity }) => (
  <div style={{ position: 'absolute', right: 40, bottom: 34, display: 'flex', alignItems: 'center', gap: 12, opacity, pointerEvents: 'none' }}>
    <Img src={wordmarkUrl} alt="" style={{ width: 150 }} />
    <div style={{ fontFamily: display, fontSize: 20, fontWeight: 500, color: ink }}>hundredstories.xyz</div>
  </div>
);
