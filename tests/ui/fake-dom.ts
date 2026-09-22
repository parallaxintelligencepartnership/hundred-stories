// Just enough of the DOM for the ui's panels and shell to build and refresh in node: a tree of
// elements with text, classes, attributes and listeners, and a counter on every measurement.
// It lays nothing out. getBoundingClientRect answers a fixed size, so a test can count reads.

type Listener = (event: unknown) => void;

export class FakeElement {
  readonly tagName: string;
  children: FakeElement[] = [];
  parentNode: FakeElement | null = null;
  className = '';
  id = '';
  title = '';
  type = '';
  disabled = false;
  hidden = false;
  isContentEditable = false;
  readonly dataset: Record<string, string> = {};
  readonly style: Record<string, string> & { setProperty(name: string, value: string): void };
  readonly attributes = new Map<string, string>();
  readonly listeners = new Map<string, Listener[]>();
  private ownText = '';

  constructor(
    tag: string,
    private readonly dom: FakeDom,
  ) {
    this.tagName = tag.toUpperCase();
    const style: Record<string, string> = {};
    this.style = Object.assign(style, {
      setProperty(name: string, value: string) {
        style[name] = value;
      },
    });
  }

  get classList(): { add(c: string): void; remove(c: string): void; contains(c: string): boolean; toggle(c: string, on?: boolean): boolean } {
    const read = (): string[] => this.className.split(/\s+/).filter(Boolean);
    const write = (list: string[]): void => {
      this.className = list.join(' ');
    };
    return {
      add: (c) => {
        if (!read().includes(c)) write([...read(), c]);
      },
      remove: (c) => write(read().filter((x) => x !== c)),
      contains: (c) => read().includes(c),
      toggle: (c, on) => {
        const want = on ?? !read().includes(c);
        if (want) {
          if (!read().includes(c)) write([...read(), c]);
        } else write(read().filter((x) => x !== c));
        return want;
      },
    };
  }

  get textContent(): string {
    return this.ownText + this.children.map((c) => c.textContent).join('');
  }

  set textContent(text: string | null) {
    this.detachAll();
    this.ownText = text ?? '';
  }

  get firstElementChild(): FakeElement | null {
    return this.children[0] ?? null;
  }

  get lastElementChild(): FakeElement | null {
    return this.children[this.children.length - 1] ?? null;
  }

  append(...nodes: FakeElement[]): void {
    for (const node of nodes) {
      node.remove();
      node.parentNode = this;
      this.children.push(node);
    }
  }

  prepend(...nodes: FakeElement[]): void {
    for (const node of nodes.slice().reverse()) {
      node.remove();
      node.parentNode = this;
      this.children.unshift(node);
    }
  }

  replaceChildren(...nodes: FakeElement[]): void {
    this.detachAll();
    this.ownText = '';
    this.append(...nodes);
  }

  remove(): void {
    const parent = this.parentNode;
    if (!parent) return;
    parent.children = parent.children.filter((c) => c !== this);
    this.parentNode = null;
  }

  setAttribute(name: string, value: string): void {
    this.attributes.set(name, String(value));
  }

  getAttribute(name: string): string | null {
    return this.attributes.get(name) ?? null;
  }

  removeAttribute(name: string): void {
    this.attributes.delete(name);
  }

  addEventListener(type: string, fn: Listener): void {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), fn]);
  }

  removeEventListener(type: string, fn: Listener): void {
    this.listeners.set(type, (this.listeners.get(type) ?? []).filter((f) => f !== fn));
  }

  getBoundingClientRect(): { width: number; height: number; top: number; left: number; right: number; bottom: number } {
    this.dom.measures += 1;
    const { width, height } = this.dom.sizeOf(this);
    return { width, height, top: 0, left: 0, right: width, bottom: height };
  }

  /** Every element under this one, not counting itself. */
  descendants(): FakeElement[] {
    return this.children.flatMap((c) => [c, ...c.descendants()]);
  }

  private detachAll(): void {
    for (const child of this.children) child.parentNode = null;
    this.children = [];
  }
}

export class FakeDom {
  /** getBoundingClientRect calls on any element since the last reset. */
  measures = 0;
  /** Elements created since the last reset. */
  created = 0;
  readonly head: FakeElement;
  readonly body: FakeElement;
  /** Frame callbacks waiting for the next runFrame. */
  private frames = new Map<number, () => void>();
  private nextFrame = 1;
  readonly windowListeners = new Map<string, Listener[]>();

  constructor() {
    this.head = new FakeElement('head', this);
    this.body = new FakeElement('body', this);
  }

  /** What a measured element reports: the shell fills a phone-sized view, anything else is a chip. */
  sizeOf(node: FakeElement): { width: number; height: number } {
    return node.className.split(/\s+/).includes('hs-ui') ? { width: 1000, height: 800 } : { width: 120, height: 30 };
  }

  createElement(tag: string): FakeElement {
    this.created += 1;
    return new FakeElement(tag, this);
  }

  /** Run every frame callback queued so far, as one animation frame would. */
  runFrame(): void {
    const due = [...this.frames.values()];
    this.frames.clear();
    for (const cb of due) cb();
  }

  /** Put document, window and the frame functions on globalThis. Returns the undo. */
  install(): () => void {
    const g = globalThis as Record<string, unknown>;
    const saved = ['document', 'window', 'requestAnimationFrame', 'cancelAnimationFrame'].map((k) => [k, g[k]] as const);
    const store = new Map<string, string>();
    const raf = (cb: () => void): number => {
      const id = this.nextFrame++;
      this.frames.set(id, cb);
      return id;
    };
    const caf = (id: number): void => {
      this.frames.delete(id);
    };
    g['document'] = {
      head: this.head,
      body: this.body,
      createElement: (tag: string) => this.createElement(tag),
      getElementById: () => null,
    };
    g['window'] = {
      localStorage: {
        getItem: (k: string) => store.get(k) ?? null,
        setItem: (k: string, v: string) => store.set(k, v),
      },
      matchMedia: () => ({ matches: false }),
      requestAnimationFrame: raf,
      addEventListener: (type: string, fn: Listener) => {
        this.windowListeners.set(type, [...(this.windowListeners.get(type) ?? []), fn]);
      },
      removeEventListener: (type: string, fn: Listener) => {
        this.windowListeners.set(type, (this.windowListeners.get(type) ?? []).filter((f) => f !== fn));
      },
    };
    g['requestAnimationFrame'] = raf;
    g['cancelAnimationFrame'] = caf;
    return () => {
      for (const [k, v] of saved) {
        if (v === undefined) delete g[k];
        else g[k] = v;
      }
    };
  }

  /** Fire a window event at every listener the ui registered for it. */
  fireWindow(type: string, event: unknown = {}): void {
    for (const fn of this.windowListeners.get(type) ?? []) fn(event);
  }
}
