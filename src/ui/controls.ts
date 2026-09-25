// The Controls page in Settings: only the controls for the device in the player's hands, each
// one short line with a small picture, in words an eight year old can follow.
//
// Which device: a controller when one is connected, else touch on a touch screen, else the
// mouse and keyboard. The page is asked again each time it opens, so plugging in a controller
// and opening Controls shows the controller.
//
// The keyboard page takes its shortcut lines from keys.ts, so the help always names the keys
// the game really answers to.

import { keyHelpLines } from './keys';
import { GROUPS } from './palette';

export type ControlsDevice = 'touch' | 'mouse' | 'controller';

/** What the page reads of the browser, so a test can hand it a stand-in. */
export interface DeviceEnv {
  /** Is the main pointer a finger? */
  coarse: boolean;
  /** The connected pads, as navigator.getGamepads() lists them (empty slots are null). */
  gamepads: readonly ({ connected?: boolean } | null)[];
}

export const CONTROLS_DEVICE_LABEL: Record<ControlsDevice, string> = {
  touch: 'Touch',
  mouse: 'Mouse and keyboard',
  controller: 'Controller',
};

/** Which device's controls to show. A connected controller wins, then touch, then the mouse. */
export function controlsDevice(env: DeviceEnv): ControlsDevice {
  if (env.gamepads.some((pad) => pad !== null && pad !== undefined && pad.connected !== false)) return 'controller';
  return env.coarse ? 'touch' : 'mouse';
}

/** The browser as it is now. A browser that will not answer is a mouse with no controller. */
export function currentDeviceEnv(): DeviceEnv {
  let coarse = false;
  try {
    coarse = typeof window !== 'undefined' && window.matchMedia('(pointer: coarse)').matches;
  } catch {
    coarse = false;
  }
  let gamepads: DeviceEnv['gamepads'] = [];
  try {
    const nav = (globalThis as { navigator?: { getGamepads?: () => ArrayLike<{ connected?: boolean } | null> } }).navigator;
    const list = nav?.getGamepads?.();
    if (list) gamepads = Array.from(list);
  } catch {
    gamepads = [];
  }
  return { coarse, gamepads };
}

export type ControlIcon = 'move' | 'zoom' | 'build' | 'size' | 'look' | 'speed' | 'keys' | 'back' | 'menu' | 'pick';

export interface ControlLine {
  icon: ControlIcon;
  text: string;
}

/** The lines for one device, in the order a new player needs them. */
export function controlLines(device: ControlsDevice, groupCount: number = GROUPS.length): ControlLine[] {
  if (device === 'touch') {
    return [
      { icon: 'move', text: 'Slide one finger to look around.' },
      { icon: 'zoom', text: 'Pinch with two fingers to zoom in and out.' },
      { icon: 'build', text: 'Tap Build, pick a room, then tap where it goes.' },
      { icon: 'size', text: 'For a lobby or an elevator, drag to make it bigger. Use two fingers to move while you do.' },
      { icon: 'look', text: 'Tap a room or a person to see how they are doing.' },
    ];
  }
  if (device === 'controller') {
    return [
      { icon: 'move', text: 'Left stick or the arrow pad: look around.' },
      { icon: 'zoom', text: 'Right stick: zoom in and out.' },
      { icon: 'pick', text: 'A: pick or place.' },
      { icon: 'back', text: 'B: go back or close.' },
      { icon: 'speed', text: 'Shoulder buttons: slower or faster.' },
      { icon: 'menu', text: 'Start: open the menu.' },
    ];
  }
  const [tools, speed, drop] = keyHelpLines(groupCount);
  return [
    { icon: 'move', text: 'Drag with the mouse, or press W A S D or the arrow keys, to look around.' },
    { icon: 'zoom', text: 'Hold Ctrl and scroll, or press plus and minus, to zoom.' },
    { icon: 'build', text: 'Pick a room, then click where it goes.' },
    { icon: 'size', text: 'For a lobby or an elevator, drag to make it bigger. Move with the right mouse button while you do.' },
    { icon: 'look', text: 'Click a room or a person to see how they are doing.' },
    { icon: 'keys', text: tools ?? '' },
    { icon: 'speed', text: speed ?? '' },
    { icon: 'back', text: drop ?? '' },
  ].filter((line): line is ControlLine => line.text !== '');
}

const SVG_NS = 'http://www.w3.org/2000/svg';
const LINE = 'fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round" stroke-linecap="round"';

/** Small 16 by 16 drawings for the rows, in the text color. Decorative: the words say it all. */
const DRAWINGS: Record<ControlIcon, string> = {
  move: `<path d="M8 1.75v12.5M1.75 8h12.5M6 3.75l2-2 2 2M6 12.25l2 2 2-2M3.75 6l-2 2 2 2M12.25 6l2 2-2 2" ${LINE}/>`,
  zoom: `<circle cx="7" cy="7" r="4.5" ${LINE}/><path d="M10.5 10.5l3.75 3.75M5 7h4M7 5v4" ${LINE}/>`,
  build: `<rect x="2.5" y="6" width="11" height="7.5" ${LINE}/><path d="M1.75 6.5L8 2l6.25 4.5M6.5 13.5v-3.5h3v3.5" ${LINE}/>`,
  size: `<path d="M2 6V2h4M14 10v4h-4M2 2l5 5M14 14l-5-5" ${LINE}/>`,
  look: `<circle cx="8" cy="5" r="2.5" ${LINE}/><path d="M3 14c0-3 2.2-4.75 5-4.75s5 1.75 5 4.75" ${LINE}/>`,
  speed: `<path d="M2 3.5v9L8 8zM8 3.5v9L14 8z" ${LINE}/>`,
  keys: `<rect x="1.75" y="4" width="12.5" height="8.5" rx="1.5" ${LINE}/><path d="M4.5 7h.5M7.75 7h.5M11 7h.5M5 10h6" ${LINE}/>`,
  back: `<path d="M9.5 3.5L5 8l4.5 4.5" ${LINE}/>`,
  menu: `<path d="M2.5 4h11M2.5 8h11M2.5 12h11" ${LINE}/>`,
  pick: `<circle cx="8" cy="8" r="6.25" ${LINE}/><path d="M5.25 8.25l2 2 3.5-4" ${LINE}/>`,
};

function drawing(name: ControlIcon): SVGElement {
  const node = document.createElementNS(SVG_NS, 'svg') as SVGElement;
  node.setAttribute('class', 'hs-icon hs-controls-icon');
  node.setAttribute('aria-hidden', 'true');
  node.setAttribute('focusable', 'false');
  node.setAttribute('viewBox', '0 0 16 16');
  node.innerHTML = DRAWINGS[name];
  return node;
}

/** The chevron at the end of a row that opens a page. */
export function chevron(): SVGElement {
  const node = document.createElementNS(SVG_NS, 'svg') as SVGElement;
  node.setAttribute('class', 'hs-icon hs-set-chevron');
  node.setAttribute('aria-hidden', 'true');
  node.setAttribute('focusable', 'false');
  node.setAttribute('viewBox', '0 0 16 16');
  node.innerHTML = `<path d="M6 3.5L10.5 8 6 12.5" ${LINE}/>`;
  return node;
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className: string, text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

/**
 * Fill the page for a device: which device it is, then one row per control. The root keeps its
 * class; the device goes in data-device for the tests and the styles.
 */
export function fillControlsPage(page: HTMLElement, device: ControlsDevice): void {
  page.dataset['device'] = device;
  const list = el('ul', 'hs-set-list hs-controls-list');
  for (const line of controlLines(device)) {
    const item = el('li', 'hs-set-row hs-controls-row');
    item.append(drawing(line.icon) as unknown as HTMLElement, el('span', 'hs-controls-text', line.text));
    list.append(item);
  }
  page.replaceChildren(el('h3', 'hs-section-title', CONTROLS_DEVICE_LABEL[device]), list);
}
