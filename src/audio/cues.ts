import type { BeatCode } from '../sim/story';

export type Cue =
  | 'bell0' | 'bell1' | 'bell2' | 'bell3' | 'door' | 'build' | 'register'
  | 'star2' | 'star3' | 'star4' | 'star5' | 'tower'
  | 'fire.start' | 'bomb.start' | 'theft.start' | 'guard.dispatch'
  | 'release.up' | 'release.down'
  | 'vip.notice' | 'vip.arrival' | 'vip.poor' | 'vip.fair' | 'vip.good';

export function vipRatingCue(value: number | undefined): Cue {
  return value === 0 ? 'vip.poor' : value === 1 ? 'vip.fair' : 'vip.good';
}

export function beatCue(code: BeatCode, value?: number): Cue | null {
  switch (code) {
    case 'fire.started': return 'fire.start';
    case 'bomb.started': return 'bomb.start';
    case 'theft.started': return 'theft.start';
    case 'guard.dispatched': return 'guard.dispatch';
    case 'fire.resolved': case 'bomb.resolved': case 'theft.caught': return 'release.up';
    case 'bomb.failed': case 'theft.escaped': return 'release.down';
    case 'vip.notice': return 'vip.notice';
    case 'vip.arrival': return 'vip.arrival';
    case 'vip.rated': return vipRatingCue(value);
    case 'wait.long': case 'trip.gaveUp': case 'trip.arrived': case 'room.vacated':
    case 'star.gained': case 'star.lost': return null;
  }
  // Package 6 will add waste.backlog and waste.cleared to BeatCode; both stay silent here.
  return null;
}

export function cueDuration(cue: Cue): number {
  if (cue === 'tower') return 12;
  if (cue === 'theft.start') return 1.05;
  if (cue === 'guard.dispatch') return 0.4;
  return cue.startsWith('star') ? 1.6 : 0.8;
}
