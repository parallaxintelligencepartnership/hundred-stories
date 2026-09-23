// The minimap: the whole tower as one row per floor on a small DOM canvas in the bottom right
// of the view, the viewport as an outline, click or drag to move the camera there.
//
// It shows only while the tower is taller than the free band (the part of the view no chrome
// covers) at the current zoom. Two stacked canvases keep the work small: the tower layer is
// drawn from the world when world.structureVersion changes, the outline layer on the frames
// the camera moved. It reads the camera through its public fields and never touches the
// renderer, and it measures nothing: the view size comes from the camera's own arithmetic.

import type { Camera } from '../render/camera';
import { FLOOR_PX, TILE_PX } from '../render/grid';
import { ROOMS } from '../sim/rules';
import type { RoomKind, World } from '../sim/types';

/** The minimap's width in css pixels: a desktop, and a phone. */
export const MINIMAP_W = 96;
export const MINIMAP_W_COMPACT = 64;
/** A floor row is at most this many css pixels tall, so a short tower still reads. */
const MAX_ROW_PX = 4;
/** The phone breakpoint the css uses. */
const COMPACT_QUERY = '(max-width: 720px)';

/** The built tower in floor bands (floor 1 = band 1, floor -1 = band 0) and tiles. */
export interface TowerExtent {
  /** Highest band built, inclusive. */
  bandTop: number;
  /** Lowest band built, inclusive. */
  bandBottom: number;
  /** Leftmost tile built. */
  xMin: number;
  /** One past the rightmost tile built. */
  xMax: number;
}

/** The band a floor occupies, counting from floor 1 = 1. Floor 0 does not exist. */
export function bandOf(floor: number): number {
  return floor > 0 ? floor : floor + 1;
}

/** The whole built tower, rooms and shafts, or null for an empty lot. */
export function towerExtent(world: Pick<World, 'rooms' | 'shafts'>): TowerExtent | null {
  let bandTop = -Infinity;
  let bandBottom = Infinity;
  let xMin = Infinity;
  let xMax = -Infinity;
  const take = (low: number, high: number, x: number, width: number): void => {
    bandBottom = Math.min(bandBottom, low);
    bandTop = Math.max(bandTop, high);
    xMin = Math.min(xMin, x);
    xMax = Math.max(xMax, x + width);
  };
  for (const room of world.rooms.values()) {
    const low = bandOf(room.floor);
    take(low, low + Math.max(1, room.height) - 1, room.x, room.width);
  }
  for (const shaft of world.shafts.values()) take(bandOf(shaft.floorMin), bandOf(shaft.floorMax), shaft.x, shaft.width);
  if (!Number.isFinite(bandTop)) return null;
  return { bandTop, bandBottom, xMin, xMax };
}

export function towerFloors(extent: TowerExtent): number {
  return extent.bandTop - extent.bandBottom + 1;
}

/**
 * The visibility rule: the tower's height in floors times a floor's height at this zoom is more
 * than the free band. A tower that fits needs no map of itself.
 */
export function minimapVisible(floors: number, zoom: number, bandPx: number): boolean {
  if (!(floors > 0) || !(zoom > 0)) return false;
  return floors * FLOOR_PX * zoom > Math.max(0, bandPx);
}

/** Where the minimap draws: its size in css pixels and how tall a floor row is. */
export interface MinimapGeometry {
  extent: TowerExtent;
  width: number;
  height: number;
  rowPx: number;
}

/**
 * One row per floor, as tall as MAX_ROW_PX while it fits in maxHeight, and squeezed below one
 * pixel only for a tower taller than that. The x axis spans the built extent, so the tower
 * fills the width and every room sits where it stands.
 */
export function minimapGeometry(extent: TowerExtent, width: number, maxHeight: number): MinimapGeometry {
  const floors = towerFloors(extent);
  const limit = Math.max(1, Math.floor(maxHeight));
  const rowPx = floors <= limit ? Math.max(1, Math.min(MAX_ROW_PX, Math.floor(limit / floors))) : limit / floors;
  return { extent, width, height: Math.round(floors * rowPx), rowPx };
}

function spanX(g: MinimapGeometry): number {
  return Math.max(1, g.extent.xMax - g.extent.xMin);
}

/** A world point (px) to a minimap point (css px). */
export function worldToMap(g: MinimapGeometry, wx: number, wy: number): { x: number; y: number } {
  return {
    x: ((wx / TILE_PX - g.extent.xMin) * g.width) / spanX(g),
    // World y of band b's top edge is -b * FLOOR_PX; the top row is bandTop.
    y: ((wy + g.extent.bandTop * FLOOR_PX) / FLOOR_PX) * g.rowPx,
  };
}

/** A minimap point (css px) to a world point (px). */
export function mapToWorld(g: MinimapGeometry, mx: number, my: number): { x: number; y: number } {
  return {
    x: (g.extent.xMin + (mx * spanX(g)) / g.width) * TILE_PX,
    y: (my / g.rowPx) * FLOOR_PX - g.extent.bandTop * FLOOR_PX,
  };
}

/** What the minimap knows of the view: the camera, the viewport and the chrome over it. */
export interface ViewState {
  x: number;
  y: number;
  zoom: number;
  viewW: number;
  viewH: number;
  /** Screen pixels of chrome over the top and the bottom of the view. */
  top: number;
  bottom: number;
}

export function freeBandPx(view: ViewState): number {
  return Math.max(0, view.viewH - view.top - view.bottom);
}

/** The camera center that puts a minimap point in the middle of the free band. */
export function cameraTarget(g: MinimapGeometry, mx: number, my: number, view: ViewState): { x: number; y: number } {
  const point = mapToWorld(g, mx, my);
  const bandMid = view.top + freeBandPx(view) / 2;
  return { x: point.x, y: point.y - (bandMid - view.viewH / 2) / view.zoom };
}

/** The free band of the view as a rectangle on the minimap, in css px. */
export function viewportRect(g: MinimapGeometry, view: ViewState): { x: number; y: number; w: number; h: number } {
  const left = view.x - view.viewW / 2 / view.zoom;
  const right = view.x + view.viewW / 2 / view.zoom;
  const top = view.y + (view.top - view.viewH / 2) / view.zoom;
  const bottom = view.y + (view.viewH - view.bottom - view.viewH / 2) / view.zoom;
  const a = worldToMap(g, left, top);
  const b = worldToMap(g, right, bottom);
  return { x: a.x, y: a.y, w: b.x - a.x, h: b.y - a.y };
}

/** Read the view from the camera without measuring the page: its center maps to the view's. */
export function readView(camera: Camera, chrome: { top: number; bottom: number }): ViewState {
  const center = camera.worldToScreen(camera.x, camera.y);
  return {
    x: camera.x,
    y: camera.y,
    zoom: camera.zoom,
    viewW: center.x * 2,
    viewH: center.y * 2,
    top: chrome.top,
    bottom: chrome.bottom,
  };
}

/** A colour per room kind, low saturation so the map reads as a diagram, not a second tower. */
const GROUP_COLORS: Record<string, string> = {
  structure: '#a3a39b',
  residential: '#8497ab',
  hotel: '#9c8fab',
  commercial: '#b0a283',
  services: '#88a08f',
};
const KIND_COLORS: Partial<Record<RoomKind, string>> = {
  office: '#a9b1bd',
  parkingRamp: '#7d8189',
  parkingSpace: '#7d8189',
};
const SHAFT_COLOR = '#5d6574';
const GROUND_COLOR = '#3a4556';
const OUTLINE_COLOR = '#f4b942';

export function roomColor(kind: RoomKind): string {
  return KIND_COLORS[kind] ?? GROUP_COLORS[ROOMS[kind]?.group ?? ''] ?? '#9aa0a8';
}

export interface MinimapOptions {
  camera: Camera;
  getWorld(): World;
  /** The chrome band the ui measured; the minimap never measures it itself. */
  getChrome(): { top: number; bottom: number };
  /** Called after a click or drag moved the camera. */
  onMove?(): void;
}

export interface Minimap {
  node: HTMLElement;
  /** Check the world and the camera and draw what changed. The frame loop calls this. */
  refresh(): void;
  /** Visible right now. */
  isVisible(): boolean;
  destroy(): void;
}

export function createMinimap(options: MinimapOptions): Minimap {
  const { camera } = options;
  const node = document.createElement('div');
  node.className = 'hs-minimap is-hidden';
  node.setAttribute('role', 'img');
  node.setAttribute('aria-label', 'Tower map. Click or drag to move the view.');
  node.title = 'Tower map: click or drag to move the view';
  const base = document.createElement('canvas');
  base.className = 'hs-minimap-tower';
  const overlay = document.createElement('canvas');
  overlay.className = 'hs-minimap-view';
  node.append(base, overlay);

  let lastWorld: World | null = null;
  let lastVersion = -1;
  let extent: TowerExtent | null = null;
  let geometry: MinimapGeometry | null = null;
  let geometryKey = '';
  let towerDirty = true;
  let viewKey = '';
  let visible = false;
  let compact = readCompact();
  let raf = 0;
  let dragging = false;
  let destroyed = false;

  const onResize = (): void => {
    compact = readCompact();
  };
  window.addEventListener('resize', onResize);

  overlay.addEventListener('pointerdown', (event: unknown) => {
    const e = event as PointerEvent;
    if (!visible || !geometry) return;
    dragging = true;
    try {
      overlay.setPointerCapture?.(e.pointerId);
    } catch {
      // a pointer that is already gone cannot be captured; the drag still follows moves over the map
    }
    e.preventDefault?.();
    moveTo(e.offsetX, e.offsetY);
  });
  overlay.addEventListener('pointermove', (event: unknown) => {
    if (!dragging) return;
    const e = event as PointerEvent;
    moveTo(e.offsetX, e.offsetY);
  });
  const endDrag = (): void => {
    dragging = false;
  };
  overlay.addEventListener('pointerup', endDrag);
  overlay.addEventListener('pointercancel', endDrag);

  function moveTo(mx: number, my: number): void {
    if (!geometry) return;
    const view = readView(camera, options.getChrome());
    const target = cameraTarget(geometry, mx, my, view);
    camera.panBy((target.x - camera.x) * camera.zoom, (target.y - camera.y) * camera.zoom);
    refresh();
    options.onMove?.();
  }

  function refresh(): void {
    if (destroyed) return;
    const world = options.getWorld();
    const version = typeof world.structureVersion === 'number' ? world.structureVersion : 0;
    if (world !== lastWorld || version !== lastVersion) {
      lastWorld = world;
      lastVersion = version;
      extent = towerExtent(world);
      towerDirty = true;
    }
    const view = readView(camera, options.getChrome());
    const band = freeBandPx(view);
    const show = extent !== null && minimapVisible(towerFloors(extent), view.zoom, band);
    if (show !== visible) {
      visible = show;
      node.classList.toggle('is-hidden', !show);
      viewKey = '';
    }
    if (!show || !extent) return;

    const width = compact ? MINIMAP_W_COMPACT : MINIMAP_W;
    const maxHeight = Math.max(48, Math.min(compact ? 160 : 280, band * 0.45));
    const key = `${extent.bandTop},${extent.bandBottom},${extent.xMin},${extent.xMax},${width},${Math.round(maxHeight)}`;
    if (key !== geometryKey) {
      geometryKey = key;
      geometry = minimapGeometry(extent, width, maxHeight);
      sizeCanvas(base, geometry);
      sizeCanvas(overlay, geometry);
      node.style.width = `${geometry.width}px`;
      node.style.height = `${geometry.height}px`;
      towerDirty = true;
      viewKey = '';
    }
    if (!geometry) return;
    if (towerDirty) {
      towerDirty = false;
      drawTower(base, geometry, world);
    }
    const nextViewKey = `${view.x},${view.y},${view.zoom},${view.viewW},${view.viewH},${view.top},${view.bottom}`;
    if (nextViewKey !== viewKey) {
      viewKey = nextViewKey;
      drawOutline(overlay, geometry, view);
    }
  }

  function loop(): void {
    raf = 0;
    if (destroyed) return;
    refresh();
    raf = requestAnimationFrame(loop);
  }
  raf = requestAnimationFrame(loop);

  return {
    node,
    refresh,
    isVisible: () => visible,
    destroy() {
      destroyed = true;
      if (raf) cancelAnimationFrame(raf);
      raf = 0;
      window.removeEventListener('resize', onResize);
      node.remove();
    },
  };
}

function readCompact(): boolean {
  try {
    return window.matchMedia(COMPACT_QUERY).matches;
  } catch {
    return false;
  }
}

function pixelRatio(): number {
  const dpr = typeof window !== 'undefined' ? window.devicePixelRatio : 1;
  return Math.max(1, Math.min(3, Math.round(dpr || 1)));
}

function sizeCanvas(canvas: HTMLCanvasElement, g: MinimapGeometry): void {
  const dpr = pixelRatio();
  canvas.width = Math.max(1, Math.round(g.width * dpr));
  canvas.height = Math.max(1, Math.round(g.height * dpr));
  canvas.style.width = `${g.width}px`;
  canvas.style.height = `${g.height}px`;
}

function context(canvas: HTMLCanvasElement): CanvasRenderingContext2D | null {
  const ctx = typeof canvas.getContext === 'function' ? canvas.getContext('2d') : null;
  if (!ctx) return null;
  const dpr = canvas.width / Math.max(1, parseFloat(canvas.style.width) || canvas.width);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return ctx;
}

/** The tower layer: a rect per room and shaft, and the ground line. A few hundred fills. */
function drawTower(canvas: HTMLCanvasElement, g: MinimapGeometry, world: World): void {
  const ctx = context(canvas);
  if (!ctx) return;
  ctx.clearRect(0, 0, g.width, g.height);
  const span = spanX(g);
  const rect = (x: number, width: number, bandLow: number, bandHigh: number): [number, number, number, number] => {
    const left = ((x - g.extent.xMin) * g.width) / span;
    const w = Math.max(1, (width * g.width) / span);
    const top = (g.extent.bandTop - bandHigh) * g.rowPx;
    const h = Math.max(1, (bandHigh - bandLow + 1) * g.rowPx);
    return [left, top, w, h];
  };
  for (const room of world.rooms.values()) {
    const low = bandOf(room.floor);
    ctx.fillStyle = roomColor(room.kind);
    ctx.fillRect(...rect(room.x, room.width, low, low + Math.max(1, room.height) - 1));
  }
  ctx.fillStyle = SHAFT_COLOR;
  for (const shaft of world.shafts.values()) {
    ctx.fillRect(...rect(shaft.x, shaft.width, bandOf(shaft.floorMin), bandOf(shaft.floorMax)));
  }
  // The street: the line under floor 1, where the tower meets the ground.
  if (g.extent.bandTop >= 1 && g.extent.bandBottom <= 0) {
    ctx.fillStyle = GROUND_COLOR;
    ctx.fillRect(0, g.extent.bandTop * g.rowPx, g.width, 1);
  }
}

/** The outline layer: the free band of the view, clipped to the map. */
function drawOutline(canvas: HTMLCanvasElement, g: MinimapGeometry, view: ViewState): void {
  const ctx = context(canvas);
  if (!ctx) return;
  ctx.clearRect(0, 0, g.width, g.height);
  const r = viewportRect(g, view);
  const left = Math.max(0.5, Math.min(g.width - 0.5, r.x));
  const right = Math.max(0.5, Math.min(g.width - 0.5, r.x + r.w));
  const top = Math.max(0.5, Math.min(g.height - 0.5, r.y));
  const bottom = Math.max(0.5, Math.min(g.height - 0.5, r.y + r.h));
  ctx.strokeStyle = OUTLINE_COLOR;
  ctx.lineWidth = 1;
  ctx.strokeRect(Math.round(left) + 0.5, Math.round(top) + 0.5, Math.max(1, Math.round(right - left) - 1), Math.max(1, Math.round(bottom - top) - 1));
}
