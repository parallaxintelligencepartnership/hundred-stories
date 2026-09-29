import React from 'react';
import { AbsoluteFill, Sequence, useCurrentFrame } from 'remotion';
import { BUILD_S, BuildCatchOverlay, EveryFloorTitles, SiteIntroScenes, TOWER_W, siteIntroSkyTop, type TitleLayout } from './SiteIntro';

// The landing splash for phones held upright: SiteIntro frames 300 to 839 (Build, then Every
// Floor through the wordmark and its caption), the same cut as public/trailers/site-splash.mp4,
// reframed to 1080x1920. The 1920x1080 scene is scaled uniformly (one factor on both axes) and
// centred on the tower, which the SiteIntro camera always keeps at the horizontal centre. Filling
// the height would leave a 607 px slice, narrower than the tower, so the factor is the one that
// fits the tower (its foundation slab at the Build zoom) into TOWER_SHARE of the width, leaving
// room for a phone's object-fit: cover to trim the sides. The scene sits on the bottom edge (the
// ground) and the strip above it carries on the scene's sky colour. The titles are drawn here at
// a portrait size, on the same clock, because the landscape wordmark is wider than the frame.

export const PORTRAIT_W = 1080;
export const PORTRAIT_H = 1920;
export const PORTRAIT_FRAMES = 540;
const SRC_W = 1920;
const SRC_H = 1080;
const START = 300; // SiteIntro frame of this composition's frame 0
const TOWER_SHARE = 0.92;
const TOWER_SPAN = (TOWER_W + 20) * BUILD_S; // the foundation slab on screen at the Build zoom
export const PORTRAIT_SCALE = (PORTRAIT_W * TOWER_SHARE) / TOWER_SPAN;
const SCENE_H = SRC_H * PORTRAIT_SCALE;
// Whole pixels, so the scene's top edge is not a half-covered row over the black under its sky.
const SCENE_TOP = Math.floor(PORTRAIT_H - SCENE_H);
const SCENE_LEFT = (PORTRAIT_W - SRC_W * PORTRAIT_SCALE) / 2;

const PORTRAIT_TITLES: TitleLayout = {
  wordmarkSize: 92,
  captionY: 640 * PORTRAIT_SCALE,
  captionSize: 58,
  playY: 640 * PORTRAIT_SCALE + 170,
  playSize: 44,
};

export const SiteSplashPortrait: React.FC = () => {
  const frame = useCurrentFrame();
  const skyTop = siteIntroSkyTop(frame + START);
  return (
    <AbsoluteFill style={{ background: skyTop, overflow: 'hidden' }}>
      <div
        style={{
          position: 'absolute',
          left: 0,
          top: 0,
          width: SRC_W,
          height: SRC_H,
          overflow: 'hidden',
          transformOrigin: '0 0',
          transform: `translate(${SCENE_LEFT}px, ${SCENE_TOP}px) scale(${PORTRAIT_SCALE})`,
        }}
      >
        <Sequence from={-START} name="SiteIntro">
          <SiteIntroScenes reframed />
        </Sequence>
      </div>
      {/* the sky strip, over the scene's first rows (the same colour) so no seam shows */}
      <div style={{ position: 'absolute', left: 0, right: 0, top: 0, height: SCENE_TOP + 2, background: skyTop }} />
      <Sequence from={0} durationInFrames={600 - START} name="Catch flash">
        <BuildCatchOverlay />
      </Sequence>
      <div style={{ position: 'absolute', left: 60, right: 60, top: SCENE_TOP, height: SCENE_H, textWrap: 'balance' }}>
        <Sequence from={600 - START} name="Titles">
          <EveryFloorTitles layout={PORTRAIT_TITLES} />
        </Sequence>
      </div>
    </AbsoluteFill>
  );
};
