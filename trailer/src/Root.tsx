import React from 'react';
import { Composition } from 'remotion';
import { SiteIntro } from './compositions/SiteIntro';
import { ShareClip } from './compositions/ShareClip';
import { BacklogClip } from './compositions/BacklogClip';
import { WaitClip } from './compositions/WaitClip';
import { PORTRAIT_FRAMES, PORTRAIT_H, PORTRAIT_W, SiteSplashPortrait } from './compositions/SiteSplashPortrait';

export const Root: React.FC = () => (
  <>
    <Composition id="SiteIntro" component={SiteIntro} durationInFrames={900} fps={30} width={1920} height={1080} />
    <Composition id="SiteSplashPortrait" component={SiteSplashPortrait} durationInFrames={PORTRAIT_FRAMES} fps={30} width={PORTRAIT_W} height={PORTRAIT_H} />
    <Composition id="ShareClip" component={ShareClip} durationInFrames={360} fps={30} width={1920} height={1080} />
    <Composition id="BacklogClip" component={BacklogClip} durationInFrames={360} fps={30} width={1920} height={1080} />
    <Composition id="WaitClip" component={WaitClip} durationInFrames={360} fps={30} width={1920} height={1080} />
  </>
);
