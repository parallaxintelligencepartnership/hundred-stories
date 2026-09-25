// The information views: one Views button in the top bar opens a small list of the views, an
// icon and a name each. The view that is on shows as a chip under the top bar, with its legend
// and an x that turns it off. One view at a time or none; off by default and not remembered, so
// every load opens on the plain tower.
//
// The list is a popover (the Popover API, placed against the button with anchor positioning
// where the browser has it, ui.css). Without the Popover API it is a plain box the button shows
// and hides, and a tap outside or Escape closes it all the same.

import { OVERLAY_KINDS, overlayLegend, overlayTitle, type OverlayKind } from '../render/overlays';
import { icon, type IconName } from './icons';

export type ViewChoice = OverlayKind | null;

const VIEW_ICONS: Record<OverlayKind, IconName> = {
  stress: 'stress',
  noise: 'noise',
  vacancy: 'vacancy',
  wait: 'wait',
};

/** The views in the list, top to bottom. */
export const VIEW_OPTIONS: readonly { kind: OverlayKind; label: string; icon: IconName }[] = OVERLAY_KINDS.map((kind) => ({
  kind,
  label: overlayTitle(kind),
  icon: VIEW_ICONS[kind],
}));

export interface ViewControl {
  /** The Views button for the top bar. */
  button: HTMLButtonElement;
  /** The list of views: a popover, or the fallback box. */
  menu: HTMLDivElement;
  /** The chip under the top bar: the view that is on, its legend, and the x. */
  chip: HTMLDivElement;
  legend: HTMLDivElement;
  get(): ViewChoice;
  /** Turn a view on, or all of them off. Tells onChange only when the choice moved. */
  set(kind: ViewChoice): void;
  isOpen(): boolean;
  open(): void;
  close(options?: { restoreFocus?: boolean }): void;
  /** Draw the legend in the color-blind friendly ramp, the worst step striped. */
  setColorBlind(on: boolean): void;
  destroy(): void;
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

/** True where the browser has the Popover API. */
export function supportsPopover(): boolean {
  try {
    return typeof HTMLElement !== 'undefined' && typeof HTMLElement.prototype.showPopover === 'function';
  } catch {
    return false;
  }
}

interface PopoverNode {
  showPopover?: () => void;
  hidePopover?: () => void;
}

export function createViewControl(
  onChange: (kind: ViewChoice) => void,
  options: { popover?: boolean } = {},
): ViewControl {
  const popover = options.popover ?? supportsPopover();
  let current: ViewChoice = null;
  let colorBlind = false;
  let open = false;

  const button = h('button', 'hs-icon-btn hs-round hs-views-btn');
  button.type = 'button';
  button.append(icon('views', 'hs-icon hs-btn-icon') as unknown as HTMLElement, h('span', 'hs-btn-label', 'Views'));
  button.setAttribute('aria-label', 'Views');
  button.title = 'Views: stress, noise, vacancy and elevator wait';
  button.setAttribute('aria-expanded', 'false');

  const menu = h('div', 'hs-views-menu');
  menu.id = 'hs-views-menu';
  menu.setAttribute('role', 'group');
  menu.setAttribute('aria-label', 'Views');
  button.setAttribute('aria-controls', menu.id);
  if (popover) {
    menu.setAttribute('popover', 'auto');
    // The button opens and closes the list by itself, light dismiss included.
    button.setAttribute('popovertarget', menu.id);
  } else {
    menu.hidden = true;
    button.addEventListener('click', () => (open ? close({ restoreFocus: false }) : show()));
  }
  menu.append(h('p', 'hs-views-title', 'Views'));
  const items = VIEW_OPTIONS.map((option) => {
    const node = h('button', 'hs-views-item');
    node.type = 'button';
    node.dataset['view'] = option.kind;
    node.append(icon(option.icon, 'hs-icon hs-views-item-icon') as unknown as HTMLElement, h('span', 'hs-views-item-label', option.label));
    node.addEventListener('click', () => {
      // The view that is on turns off from its own row as well as from the chip's x.
      set(current === option.kind ? null : option.kind);
      close({ restoreFocus: true });
    });
    menu.append(node);
    return { node, kind: option.kind };
  });

  const chip = h('div', 'hs-view-chip is-hidden');
  const chipIcon = h('span', 'hs-view-chip-icon');
  chipIcon.setAttribute('aria-hidden', 'true');
  const chipTitle = h('span', 'hs-view-chip-title');
  const legend = h('div', 'hs-view-legend');
  legend.setAttribute('aria-live', 'polite');
  const chipClose = h('button', 'hs-icon-btn hs-view-chip-close');
  chipClose.type = 'button';
  chipClose.append(icon('close', 'hs-icon') as unknown as HTMLElement);
  chipClose.addEventListener('click', () => {
    set(null);
    (button as { focus?: () => void }).focus?.();
  });
  chip.append(chipIcon, chipTitle, legend, chipClose);

  // The popover tells the button when it opens or closes, light dismiss included.
  const onToggle = (event: Event): void => {
    open = (event as ToggleEvent).newState === 'open';
    paintOpen();
    if (open) focusItem();
  };
  if (popover) menu.addEventListener('toggle', onToggle);

  // Without the Popover API a tap outside closes the fallback box.
  const onOutside = (event: Event): void => {
    if (!open) return;
    const target = event.target;
    if (menu.contains(target as Node) || button.contains(target as Node)) return;
    close({ restoreFocus: false });
  };
  if (!popover && typeof window !== 'undefined') window.addEventListener('pointerdown', onOutside);

  function focusItem(): void {
    const at = items.find((item) => item.kind === current) ?? items[0];
    (at?.node as { focus?: () => void } | undefined)?.focus?.();
  }

  function paintOpen(): void {
    button.setAttribute('aria-expanded', open ? 'true' : 'false');
    if (!popover) menu.hidden = !open;
  }

  function show(): void {
    if (open) return;
    if (popover) {
      try {
        (menu as PopoverNode).showPopover?.();
      } catch {
        // not connected yet: nothing to show
      }
      return; // the toggle event paints and focuses
    }
    open = true;
    paintOpen();
    focusItem();
  }

  function close(closeOptions: { restoreFocus?: boolean } = {}): void {
    if (!open) return;
    if (popover) {
      try {
        (menu as PopoverNode).hidePopover?.();
      } catch {
        // already closed
      }
    }
    open = false;
    paintOpen();
    if (closeOptions.restoreFocus) (button as { focus?: () => void }).focus?.();
  }

  function paint(): void {
    for (const item of items) {
      const pressed = item.kind === current ? 'true' : 'false';
      if (item.node.getAttribute('aria-pressed') !== pressed) item.node.setAttribute('aria-pressed', pressed);
    }
    button.classList.toggle('is-on', current !== null);
    chip.classList.toggle('is-hidden', current === null);
    if (current === null) {
      chipTitle.textContent = '';
      chipIcon.replaceChildren();
      legend.replaceChildren();
      legend.removeAttribute('aria-label');
      return;
    }
    const info = overlayLegend(current, colorBlind);
    chipIcon.replaceChildren(icon(VIEW_ICONS[current], 'hs-icon') as unknown as HTMLElement);
    chipTitle.textContent = info.title;
    chipClose.setAttribute('aria-label', `Turn off the ${info.title.toLowerCase()} view`);
    chipClose.title = `Turn off the ${info.title.toLowerCase()} view`;
    legend.setAttribute('aria-label', `${info.title} legend`);
    legend.replaceChildren(
      ...info.entries.map((entry) => {
        const item = h('span', 'hs-legend-item');
        const swatch = h('span', colorBlind && entry.worst ? 'hs-legend-swatch is-striped' : 'hs-legend-swatch');
        swatch.style.backgroundColor = hex(entry.color);
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
  return {
    button,
    menu,
    chip,
    legend,
    get: () => current,
    set,
    isOpen: () => open,
    open: show,
    close,
    setColorBlind(on) {
      if (on === colorBlind) return;
      colorBlind = on;
      paint();
    },
    destroy() {
      if (popover) menu.removeEventListener('toggle', onToggle);
      else if (typeof window !== 'undefined') window.removeEventListener('pointerdown', onOutside);
    },
  };
}
