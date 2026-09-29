// Matt's schedule numbers (decision 2026-09-28, review of ccc0f7e A5): workers arrive 7:30 to
// 9:15 AM and leave 4:30 to 7:30 PM, residents come home 5:00 to 9:30 PM. Pinned as literals so
// a drift in rules.ts fails here rather than passing every test that reads the constants.

import { describe, expect, it } from 'vitest';

import { SCHEDULES } from '../../src/sim/rules';

const hm = (h: number, m = 0): number => h * 60 + m;

describe('the day schedule matches the decided numbers', () => {
  it('workers arrive 7:30 to 9:15 AM and leave 4:30 to 7:30 PM', () => {
    expect(SCHEDULES.worker.arriveStart).toBe(hm(7, 30));
    expect(SCHEDULES.worker.arriveEnd).toBe(hm(9, 15));
    expect(SCHEDULES.worker.leaveStart).toBe(hm(16, 30));
    expect(SCHEDULES.worker.leaveEnd).toBe(hm(19, 30));
  });

  it('residents come home 5:00 to 9:30 PM', () => {
    expect(SCHEDULES.resident.returnStart).toBe(hm(17));
    expect(SCHEDULES.resident.returnEnd).toBe(hm(21, 30));
  });
});
