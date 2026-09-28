// Smart hiding for the round Watch and Sound buttons (Matt, 2026-09-27: "collapse to an icon ...
// they should collapse when not moving ... the user doesnt need the full label unless they touch
// it"). A new player sees the words once; after LABEL_IDLE_MS with no pointer move, press, wheel or key
// the shell takes LABELS_QUIET_CLASS and ui.css folds each word away over --label-fade, leaving
// the icon in its circle. Any input takes the class off at once. Hover or keyboard focus on a
// button keeps its word out whatever the class says (ui.css). A phone shows icons only anyway.
//
// It only listens: passive, it never prevents or stops an event, so every input still reaches
// Watch mode (watch.ts, its own capture listeners), the ui and the tower as before.

/** Real milliseconds without input before the words fold away. */
export const LABEL_IDLE_MS = 2_000;
/** The class on the ui shell while the words are folded away. */
export const LABELS_QUIET_CLASS = 'is-quiet-labels';

/** The window events that count as the player's hand on the game. */
const INPUT_EVENTS = ['pointermove', 'pointerdown', 'wheel', 'keydown'] as const;

export interface QuietLabelsOptions {
  shell: { classList: { toggle(name: string, on?: boolean): boolean } };
  /** The words just folded away (true) or came back (false): the buttons changed width. */
  onChange?(quiet: boolean): void;
}

export interface QuietLabels {
  /** The player did something: the words come back and the idle clock starts over. */
  input(): void;
  isQuiet(): boolean;
  destroy(): void;
}

export function createQuietLabels(options: QuietLabelsOptions): QuietLabels {
  let quiet = false;
  let lastInput = Date.now();
  let timer: ReturnType<typeof setTimeout> | null = null;

  function setQuiet(on: boolean): void {
    if (on === quiet) return;
    quiet = on;
    options.shell.classList.toggle(LABELS_QUIET_CLASS, on);
    options.onChange?.(on);
  }

  /** One timer at most; input only moves lastInput, so a moving mouse sets no timers. */
  function arm(delay: number): void {
    if (timer !== null) return;
    timer = setTimeout(onTimer, Math.max(0, delay));
  }

  function onTimer(): void {
    timer = null;
    if (quiet) return;
    const idle = Date.now() - lastInput;
    if (idle < LABEL_IDLE_MS) {
      arm(LABEL_IDLE_MS - idle);
      return;
    }
    setQuiet(true);
  }

  function input(): void {
    lastInput = Date.now();
    setQuiet(false);
    arm(LABEL_IDLE_MS);
  }

  const onInput = (): void => input();
  const listen = { capture: true, passive: true } as const;
  for (const type of INPUT_EVENTS) window.addEventListener(type, onInput, listen);

  arm(LABEL_IDLE_MS);

  return {
    input,
    isQuiet: () => quiet,
    destroy() {
      if (timer !== null) clearTimeout(timer);
      timer = null;
      for (const type of INPUT_EVENTS) window.removeEventListener(type, onInput, { capture: true });
    },
  };
}
