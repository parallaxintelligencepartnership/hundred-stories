// One game minute. The order matters and is documented in docs/DESIGN.md section 5.
import { onDayStart, onQuarterStart } from './economy';
import { tickElevators } from './elevators';
import { tickEvaluation } from './evaluation';
import { tickEvents } from './events';
import { tickPeople } from './people';
import { SCHEDULES } from './rules';
import { recomputeStars } from './stars';
import { clockOf, type World } from './types';

export function tick(world: World): void {
  if (world.gameOver) return;
  const clock = clockOf(world.time.minute);
  tickEvents(world);
  tickPeople(world);
  tickElevators(world);
  if (clock.minuteOfDay % 60 === 30) tickEvaluation(world);
  if (clock.dayOfQuarter === 0 && clock.minuteOfDay === SCHEDULES.quarterStartMinuteOfDay) onQuarterStart(world);
  if (clock.minuteOfDay % 60 === 0) recomputeStars(world);
  if (clock.minuteOfDay === 0) onDayStart(world); // after recomputeStars, so the count is fresh
  world.time.minute += 1;
}

export function tickMany(world: World, minutes: number): void {
  for (let i = 0; i < minutes && !world.gameOver; i++) tick(world);
}
