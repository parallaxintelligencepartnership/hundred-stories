// A browser that blocks site data: the localStorage getter throws (Chrome "block all cookies").
(globalThis as any).window = { get localStorage() { throw new DOMException('blocked', 'SecurityError'); } };
const { PREF_KEYS, setFlag, getFlag } = await import('/Users/matthew/parallax-private/Projects/hundred-stories/src/ui/prefs.ts');
const { watchDisplayPrefs } = await import('/Users/matthew/parallax-private/Projects/hundred-stories/src/ui/display.ts');
const { hapticsEnabled, setHapticsEnabled } = await import('/Users/matthew/parallax-private/Projects/hundred-stories/src/ui/haptics.ts');
const classes = new Set<string>();
let colorBlind: boolean | null = null;
const root = { classList: { toggle(n: string, on?: boolean) { if (on) classes.add(n); else classes.delete(n); return !!on; } } };
watchDisplayPrefs({ root, colorBlind(on) { colorBlind = on; } });
// What the Settings switches do (panels.ts 1422-1436)
setFlag(PREF_KEYS.largeText, true);
setFlag(PREF_KEYS.colorBlind, true);
setHapticsEnabled(false);
console.log('Larger text on the root:', classes.has('hs-large-text'), '| color-blind views:', colorBlind, '| haptics enabled:', hapticsEnabled(), '| switch reads back:', getFlag(PREF_KEYS.largeText));
