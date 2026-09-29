// Watch mode on a touch screen: the finger that brings the chrome back has its release
// swallowed even when a second finger presses and lifts first (audit 2026-09-28 review F6: a
// watch.ts change that cleared the swallow on any pointer passed every watch test).
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { PREF_KEYS, setFlag } from '../../src/ui/prefs';
import { createWatchMode, WATCH_IDLE_MS } from '../../src/ui/watch';
import { FakeDom } from './fake-dom';

let dom: FakeDom; let uninstall: () => void;
beforeEach(() => { vi.useFakeTimers(); dom = new FakeDom(); uninstall = dom.install(); });
afterEach(() => { uninstall(); vi.useRealTimers(); });
const spied = (e: Record<string, unknown>) => { const ev = { ...e, stopped: false, stopImmediatePropagation() { ev.stopped = true; }, stopPropagation() {}, preventDefault() {} }; return ev; };

it('two fingers: the restore finger\'s release stays swallowed while a second finger presses and lifts', () => {
  setFlag(PREF_KEYS.watchMode, true);
  const shell = dom.createElement('div');
  const w = createWatchMode({ shell: shell as never, busy: () => false });
  vi.advanceTimersByTime(WATCH_IDLE_MS + 10);
  expect(w.isWatching()).toBe(true);
  const a = spied({ type: 'pointerdown', pointerId: 11, pointerType: 'touch' }); dom.fireWindow('pointerdown', a);
  const b = spied({ type: 'pointerdown', pointerId: 12, pointerType: 'touch' }); dom.fireWindow('pointerdown', b);
  const bu = spied({ type: 'pointerup', pointerId: 12, pointerType: 'touch' }); dom.fireWindow('pointerup', bu);
  const au = spied({ type: 'pointerup', pointerId: 11, pointerType: 'touch' }); dom.fireWindow('pointerup', au);
  expect([a.stopped, b.stopped, bu.stopped, au.stopped]).toEqual([true, false, false, true]);
  w.destroy();
});
