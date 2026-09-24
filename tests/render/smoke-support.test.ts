import { describe, expect, it, vi } from 'vitest';

// The demo world is pure sim data; the renderer it can boot is not needed here.
vi.mock('../../src/render/renderer', () => ({ createRenderer: vi.fn() }));

import { isHeldUp } from '../../src/sim/build';
import { buildDemoWorld } from '../../src/render/smoke';

describe('the demo world (landing hero and ?smoke)', () => {
  it('shows no room the build rules would refuse: every room rests on structure', () => {
    const world = buildDemoWorld();
    const floating = [...world.rooms.values()]
      .filter((room) => !isHeldUp(world, room))
      .map((room) => `${room.kind} on floor ${room.floor} at x ${room.x}`);
    expect(floating).toEqual([]);
  });
});
