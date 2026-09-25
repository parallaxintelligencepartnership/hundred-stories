// Toasts: the small notes that float above the bottom edge instead of a ticker strip.
//
// Routine news is a small glass toast that fades on its own after about four seconds, with at
// most two on screen; a third pushes the oldest off. An alert stays until it is tapped. Each
// kind has its own live region, made once and kept in the page so a screen reader is already
// listening when a toast lands: news is polite, alerts are assertive. The event log keeps the
// full history, so a toast that went by too fast is never lost.

import { icon } from './icons';

/** Real milliseconds a news toast stays up before it fades. */
export const NEWS_TOAST_MS = 4000;
/** The fade out, matched to --motion-fade in ui.css. The node leaves the page after it. */
export const TOAST_FADE_MS = 200;
/** News toasts on screen at once. */
export const NEWS_TOAST_MAX = 2;

export interface ToastOptions {
  /** What a tap does. News without one is plain text; an alert always closes on a tap as well. */
  onTap?: () => void;
  /** The tap's words for a screen reader and the tooltip, e.g. "Open the event log". */
  tapLabel?: string;
  /** A small time stamp before the words. */
  time?: string;
  /** Extra classes, e.g. is-story. */
  className?: string;
}

export interface Toasts {
  /** The polite region, bottom center. Mount it in the ui shell. */
  readonly news: HTMLDivElement;
  /** The assertive region. Mount it where alerts belong; the alert cards can live in it too. */
  readonly alerts: HTMLDivElement;
  /** Routine news: fades after NEWS_TOAST_MS, at most NEWS_TOAST_MAX on screen. */
  show(text: string, options?: ToastOptions): HTMLElement;
  /** An alert: stays until tapped. */
  alert(text: string, options?: ToastOptions): HTMLElement;
  /** Escape: close the newest alert toast. False when there is none. */
  dismissNewestAlert(): boolean;
  /** News toasts on screen now, oldest first, not counting one already fading out. */
  visibleNews(): HTMLElement[];
  /** Take every toast down at once (a different tower was loaded). */
  clear(): void;
  destroy(): void;
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className: string, text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

export function createToasts(): Toasts {
  const news = el('div', 'hs-news');
  news.setAttribute('role', 'status');
  news.setAttribute('aria-live', 'polite');
  const alerts = el('div', 'hs-alerts');
  alerts.setAttribute('role', 'alert');
  alerts.setAttribute('aria-live', 'assertive');

  const timers = new Set<ReturnType<typeof setTimeout>>();
  /** News on screen, oldest first, each with the timer that will fade it. */
  let shown: { node: HTMLElement; timer: ReturnType<typeof setTimeout> | null }[] = [];
  let alertNodes: HTMLElement[] = [];

  function later(fn: () => void, ms: number): ReturnType<typeof setTimeout> {
    const timer = setTimeout(() => {
      timers.delete(timer);
      fn();
    }, ms);
    timers.add(timer);
    return timer;
  }

  function cancel(timer: ReturnType<typeof setTimeout> | null): void {
    if (timer === null) return;
    clearTimeout(timer);
    timers.delete(timer);
  }

  /** The words of a toast, and a time before them when there is one. */
  function body(node: HTMLElement, text: string, options: ToastOptions): void {
    if (options.time) node.append(el('span', 'hs-toast-time', options.time));
    node.append(el('span', 'hs-toast-words', text));
  }

  /** Fade out, then leave the page. The fade is the same with or without reduced motion. */
  function fadeOut(node: HTMLElement): void {
    if (node.classList.contains('is-leaving')) return;
    node.classList.add('is-leaving');
    later(() => node.remove(), TOAST_FADE_MS);
  }

  function show(text: string, options: ToastOptions = {}): HTMLElement {
    const tap = options.onTap;
    const node: HTMLElement = tap ? el('button', 'hs-news-toast') : el('div', 'hs-news-toast');
    if (options.className) for (const c of options.className.split(/\s+/).filter(Boolean)) node.classList.add(c);
    body(node, text, options);
    if (tap) {
      (node as HTMLButtonElement).type = 'button';
      if (options.tapLabel) node.title = options.tapLabel;
      node.addEventListener('click', () => {
        drop(node);
        tap();
      });
    }
    news.append(node);
    const entry = { node, timer: null as ReturnType<typeof setTimeout> | null };
    shown.push(entry);
    entry.timer = later(() => {
      entry.timer = null;
      drop(node);
    }, NEWS_TOAST_MS);
    // A third one pushes the oldest off at once: never more than two on screen.
    while (shown.length > NEWS_TOAST_MAX) {
      const oldest = shown.shift();
      if (!oldest) break;
      cancel(oldest.timer);
      oldest.node.remove();
    }
    return node;
  }

  /** A news toast leaves: it stops counting now and fades out. */
  function drop(node: HTMLElement): void {
    const at = shown.findIndex((e) => e.node === node);
    if (at >= 0) {
      cancel(shown[at]?.timer ?? null);
      shown.splice(at, 1);
    }
    fadeOut(node);
  }

  function alert(text: string, options: ToastOptions = {}): HTMLElement {
    const node = el('button', 'hs-alert-toast');
    node.type = 'button';
    if (options.className) for (const c of options.className.split(/\s+/).filter(Boolean)) node.classList.add(c);
    body(node, text, options);
    node.append(icon('close', 'hs-icon hs-alert-toast-x') as unknown as HTMLElement);
    const label = options.tapLabel ?? 'Tap to close';
    node.title = label;
    node.addEventListener('click', () => {
      closeAlert(node);
      options.onTap?.();
    });
    alerts.append(node);
    alertNodes.push(node);
    return node;
  }

  function closeAlert(node: HTMLElement): void {
    alertNodes = alertNodes.filter((n) => n !== node);
    fadeOut(node);
  }

  return {
    news,
    alerts,
    show,
    alert,
    dismissNewestAlert() {
      const node = alertNodes.at(-1);
      if (!node) return false;
      closeAlert(node);
      return true;
    },
    visibleNews: () => shown.map((e) => e.node),
    clear() {
      for (const entry of shown) {
        cancel(entry.timer);
        entry.node.remove();
      }
      shown = [];
      for (const node of alertNodes) node.remove();
      alertNodes = [];
    },
    destroy() {
      for (const timer of timers) clearTimeout(timer);
      timers.clear();
      shown = [];
      alertNodes = [];
      news.remove();
      alerts.remove();
    },
  };
}
