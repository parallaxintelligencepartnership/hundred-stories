import React from 'react';
import { Composition } from 'remotion';
import { SiteIntro } from './compositions/SiteIntro';
import { ShareClip } from './compositions/ShareClip';
import { BacklogClip } from './compositions/BacklogClip';
import { WaitClip } from './compositions/WaitClip';

export const Root: React.FC = () => (
  <>
    <Composition id="SiteIntro" component={SiteIntro} durationInFrames={900} fps={30} width={1920} height={1080} />
    <Composition id="ShareClip" component={ShareClip} durationInFrames={360} fps={30} width={1920} height={1080} />
    <Composition id="BacklogClip" component={BacklogClip} durationInFrames={360} fps={30} width={1920} height={1080} />
    <Composition id="WaitClip" component={WaitClip} durationInFrames={360} fps={30} width={1920} height={1080} />
  </>
);
