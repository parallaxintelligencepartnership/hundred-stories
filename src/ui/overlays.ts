// The status bar's View control: Off and the four information views as one segmented control,
// with the legend for the view that is on underneath it. One view at a time or none; off by
// default and not remembered, so every load opens on the plain tower.

import { OVERLAY_KINDS, overlayLegend, overlayTitle, type OverlayKind } from '../render/overlays';

export type ViewChoice = OverlayKind | null;

/** The options left to right, Off first. */
export const VIEW_OPTIONS: readonly { kind: ViewChoice; label: string }[] = [
  { kind: null, label: 'Off' },
  ...OVERLAY_KINDS.map((kind) => ({ kind, label: overlayTitle(kind) })),
];

export interface ViewControl {
  /** The readout column for the status bar: label, the segmented control, the legend. */
  root: HTMLDivElement;
  legend: HTMLDivElement;
  get(): ViewChoice;
  /** Turn a view on, or all of them off. Tells onChange only when the choice moved. */
  set(kind: ViewChoice): void;
}

function h<K extends keyof HTMLElementTagNameMap>(tag: K, className: string, text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function hex(color: number): string {
  return `#${color.toString(16).padStart(6, '0')}`;
}

export function createViewControl(onChange: (kind: ViewChoice) => void): ViewControl {
  const root = h('div', 'hs-readout hs-status-view');
  const label = h('span', 'hs-readout-label', 'View');
  label.id = 'hs-view-label';
  const group = h('div', 'hs-view');
  group.setAttribute('role', 'group');
  group.setAttribute('aria-labelledby', 'hs-view-label');
  const legend = h('div', 'hs-view-legend is-hidden');
  legend.setAttribute('aria-live', 'polite');
  root.append(label, group, legend);

  let current: ViewChoice = null;
  const buttons = VIEW_OPTIONS.map((option) => {
    const node = h('button', 'hs-btn hs-view-btn', option.label);
    node.type = 'button';
    node.dataset['view'] = option.kind ?? 'off';
    node.addEventListener('click', () => set(option.kind));
    group.append(node);
    return { node, kind: option.kind };
  });

  function paint(): void {
    for (const b of buttons) {
      const pressed = b.kind === current ? 'true' : 'false';
      if (b.node.getAttribute('aria-pressed') !== pressed) b.node.setAttribute('aria-pressed', pressed);
    }
    legend.classList.toggle('is-hidden', current === null);
    if (current === null) {
      legend.replaceChildren();
      legend.removeAttribute('aria-label');
      return;
    }
    const info = overlayLegend(current);
    legend.setAttribute('aria-label', `${info.title} legend`);
    legend.replaceChildren(
      ...info.entries.map((entry) => {
        const item = h('span', 'hs-legend-item');
        const swatch = h('span', 'hs-legend-swatch');
        swatch.style.background = hex(entry.color);
        item.append(swatch);
        if (entry.label !== '') item.append(h('span', 'hs-legend-text', entry.label));
        return item;
      }),
    );
  }

  function set(kind: ViewChoice): void {
    if (kind === current) return;
    current = kind;
    paint();
    onChange(kind);
  }

  paint();
  return { root, legend, get: () => current, set };
}
