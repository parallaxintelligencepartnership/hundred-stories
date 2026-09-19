// Camera and the world to screen mapping for the tower view.
//
// World units are pixels: one tile is TILE_PX wide, one floor is FLOOR_PX tall.
// Floor 1's slab sits at world y = 0. Floors above ground climb into negative y,
// underground floors run down into positive y. Floor 0 does not exist, so the
// floor axis skips it: floor 1 -> band 1, floor -1 -> band 0.
//
// The camera holds the world point at the center of the viewport, plus a zoom.
// It has no knowledge of pixi: renderer.ts feeds it input and reads x, y, zoom.

import { MAX_FLOOR, MIN_FLOOR, TOWER_WIDTH } from '../sim/types';
import { FLOOR_PX, TILE_PX } from './art';
import type { WheelGesture } from './input';

export const MIN_ZOOM = 0.35;
/** Opening zoom. The original drew its 8 px tiles on a 640 px screen; 2x on a modern display reads the same. */
export const DEFAULT_ZOOM = 2;
export const MAX_ZOOM = 3;
/** Zoom levels the wheel snaps to once it stops. */
export const SNAP_ZOOMS: readonly number[] = [0.5, 1, 2, 3];
/** MIN_ZOOM is a stop too, otherwise the lowest zoom could never be held. */
const SNAP_STOPS: readonly number[] = [MIN_ZOOM, ...SNAP_ZOOMS];

const WHEEL_IDLE_MS = 160; // how long the wheel must rest before the zoom snaps
const SNAP_EASE_MS = 70;
const KEY_PAN_PX_PER_SECOND = 900;
const FRICTION_MS = 110; // inertia half life, roughly
const MIN_INERTIA_SPEED = 0.015; // screen px per ms
const MAX_INERTIA_SPEED = 4; // screen px per ms
const PAN_MARGIN_PX = 240;
const FOLLOW_EASE_MS = 140; // how fast the view catches up with a room it had to follow
const KEY_ZOOM_DELTA = 120; // one wheel notch, so the plus and minus keys feel like the wheel
/** Where the street sits in the opening shot, as a fraction down the viewport. */
export const DEFAULT_GROUND_LINE = 0.68;
/** On a phone the palette is a bottom sheet, so the street starts above it, not behind it. */
export const PHONE_GROUND_LINE = 0.4;
/** The width ui.css turns the palette into a bottom sheet at. */
export const PHONE_MAX_WIDTH_PX = 720;

/**
 * Where to put the street when the game opens, for a viewport this wide.
 *
 * Two thirds down is the right stage for a tower on a desktop. On a phone the lower half of
 * the screen belongs to the palette sheet and the ticker, so an empty lot framed that way puts
 * the ground the player has to build on behind the sheet, with nothing but sky in the gap.
 */
export function groundLineFor(viewportWidth: number): number {
  return viewportWidth <= PHONE_MAX_WIDTH_PX ? PHONE_GROUND_LINE : DEFAULT_GROUND_LINE;
}

const PAN_KEYS: Record<string, { dx: number; dy: number }> = {
  KeyW: { dx: 0, dy: -1 },
  KeyS: { dx: 0, dy: 1 },
  KeyA: { dx: -1, dy: 0 },
  KeyD: { dx: 1, dy: 0 },
  ArrowUp: { dx: 0, dy: -1 },
  ArrowDown: { dx: 0, dy: 1 },
  ArrowLeft: { dx: -1, dy: 0 },
  ArrowRight: { dx: 1, dy: 0 },
};

/** The band a floor occupies on the vertical axis, counting from floor 1 = 1. */
export function floorBand(floor: number): number {
  return floor > 0 ? floor : floor + 1;
}

/** Continuous version of floorBand for cars and sims moving between floors. */
export function floorBandFloat(floor: number): number {
  if (floor >= 1) return floor;
  if (floor <= -1) return floor + 1;
  return (floor + 1) / 2; // nothing rests inside the ground, this only keeps motion smooth
}

/** World y of the top edge of a floor. Floor 1 spans -FLOOR_PX to 0. */
export function floorTopY(floor: number): number {
  return -floorBand(floor) * FLOOR_PX + 0; // the + 0 keeps floor -1 at 0 rather than -0
}

/** World y of the slab a floor stands on. Floor 1's slab is y = 0. */
export function floorBaseY(floor: number): number {
  return floorTopY(floor) + FLOOR_PX;
}

/** World y for a fractional floor position, used by cars in motion. */
export function floorYFloat(floor: number): number {
  return -floorBandFloat(floor) * FLOOR_PX;
}

/** The floor that contains a world y. Never returns 0. */
export function yToFloor(y: number): number {
  const band = Math.ceil(-y / FLOOR_PX);
  return band > 0 ? band : band - 1;
}

/** Tile column containing a world x. */
export function xToTile(worldX: number): number {
  return Math.floor(worldX / TILE_PX);
}

export interface Camera {
  x: number;
  y: number;
  zoom: number;
  /** Move the view by screen pixels. Positive dx moves the view right. */
  panBy(dx: number, dy: number): void;
  /** Multiply the zoom, holding the world point under (sx, sy) still. */
  zoomAt(factor: number, sx: number, sy: number): void;
  centerOn(floor: number, x: number): void;
  /** Put the ground line (world y = 0) at this fraction down the viewport. */
  setGroundLine(fraction: number): void;
  /** Back to the opening shot: zoom 1, tower center, street at DEFAULT_GROUND_LINE. */
  reset(): void;
  setViewport(width: number, height: number): void;
  setReducedMotion(on: boolean): void;
  /** Off for the landing hero: no pointer gesture pans. Keys and the wheel zoom still work. */
  setPanEnabled(on: boolean): void;
  isPanEnabled(): boolean;
  /** force overrides setPanEnabled(false), for middle button and space held drags. */
  dragStart(sx: number, sy: number, timeMs: number, force?: boolean): void;
  dragMove(sx: number, sy: number, timeMs: number): void;
  dragEnd(): void;
  /** Zoom toward (sx, sy). deltaY already normalized to pixels by the caller. */
  wheel(deltaY: number, sx: number, sy: number): void;
  /** One normalized wheel gesture: zoom toward (sx, sy), or move the view by screen pixels. */
  wheelAt(gesture: WheelGesture, sx: number, sy: number): void;
  /** Zoom one wheel notch toward the middle of the viewport, for the plus and minus keys. */
  zoomStep(direction: 1 | -1): void;
  /** Ease vertically the shortest distance that puts a whole floor on screen. */
  ensureFloorVisible(floor: number): void;
  setKey(code: string, down: boolean): void;
  clearKeys(): void;
  /** Advance inertia, held keys and zoom snapping. dtMs is real time. */
  update(dtMs: number): void;
  screenToWorld(sx: number, sy: number): { x: number; y: number };
  worldToScreen(wx: number, wy: number): { x: number; y: number };
}

function clamp(value: number, min: number, max: number): number {
  return value < min ? min : value > max ? max : value;
}

class TowerCamera implements Camera {
  x = (TOWER_WIDTH / 2) * TILE_PX;
  y = -FLOOR_PX * 3;
  zoom = DEFAULT_ZOOM;

  private viewW = 800;
  private viewH = 600;
  private reducedMotion = false;
  private panEnabled = true;

  private dragging = false;
  private lastSx = 0;
  private lastSy = 0;
  private lastMoveMs = 0;
  private vx = 0; // screen px per ms, in panBy sign
  private vy = 0;

  private keys = new Set<string>();

  private easeY: number | null = null;

  private wheelIdleMs = 0;
  private anchorX = 0;
  private anchorY = 0;
  private snapping = false;
  private snapTarget = 1;

  setViewport(width: number, height: number): void {
    this.viewW = Math.max(1, width);
    this.viewH = Math.max(1, height);
    this.clampPosition();
  }

  setReducedMotion(on: boolean): void {
    this.reducedMotion = on;
    if (on) {
      this.vx = 0;
      this.vy = 0;
      if (this.snapping) this.applySnapTarget(this.snapTarget);
    }
  }

  panBy(dx: number, dy: number): void {
    this.x += dx / this.zoom;
    this.y += dy / this.zoom;
    this.clampPosition();
  }

  zoomAt(factor: number, sx: number, sy: number): void {
    const from = this.zoom;
    const to = clamp(from * factor, MIN_ZOOM, MAX_ZOOM);
    if (to === from) return;
    const shift = 1 / from - 1 / to;
    this.x += (sx - this.viewW / 2) * shift;
    this.y += (sy - this.viewH / 2) * shift;
    this.zoom = to;
    this.clampPosition();
  }

  centerOn(floor: number, x: number): void {
    this.easeY = null;
    this.x = (x + 0.5) * TILE_PX;
    this.y = floorTopY(floor) + FLOOR_PX / 2;
    this.vx = 0;
    this.vy = 0;
    this.clampPosition();
  }

  setGroundLine(fraction: number): void {
    this.easeY = null;
    // screenY(0) = viewH / 2 - y * zoom, solved for y.
    this.y = (this.viewH / 2 - fraction * this.viewH) / this.zoom;
    this.vx = 0;
    this.vy = 0;
    this.clampPosition();
  }

  reset(): void {
    this.easeY = null;
    this.zoom = DEFAULT_ZOOM;
    this.x = (TOWER_WIDTH / 2) * TILE_PX;
    this.vx = 0;
    this.vy = 0;
    this.snapping = false;
    this.wheelIdleMs = 0;
    this.keys.clear();
    this.setGroundLine(DEFAULT_GROUND_LINE);
  }

  setPanEnabled(on: boolean): void {
    this.panEnabled = on;
    if (!on && this.dragging) this.dragEnd();
  }

  isPanEnabled(): boolean {
    return this.panEnabled;
  }

  dragStart(sx: number, sy: number, timeMs: number, force = false): void {
    if (!this.panEnabled && !force) return;
    this.easeY = null;
    this.dragging = true;
    this.lastSx = sx;
    this.lastSy = sy;
    this.lastMoveMs = timeMs;
    this.vx = 0;
    this.vy = 0;
  }

  dragMove(sx: number, sy: number, timeMs: number): void {
    if (!this.dragging) return;
    this.easeY = null;
    const dx = sx - this.lastSx;
    const dy = sy - this.lastSy;
    this.lastSx = sx;
    this.lastSy = sy;
    // The content follows the pointer, so the view moves the other way.
    this.panBy(-dx, -dy);
    const dt = timeMs - this.lastMoveMs;
    this.lastMoveMs = timeMs;
    if (dt > 0 && dt < 120) {
      const blend = 0.7;
      this.vx = this.vx * (1 - blend) + (-dx / dt) * blend;
      this.vy = this.vy * (1 - blend) + (-dy / dt) * blend;
    }
  }

  dragEnd(): void {
    this.dragging = false;
    if (this.reducedMotion) {
      this.vx = 0;
      this.vy = 0;
      return;
    }
    this.vx = clamp(this.vx, -MAX_INERTIA_SPEED, MAX_INERTIA_SPEED);
    this.vy = clamp(this.vy, -MAX_INERTIA_SPEED, MAX_INERTIA_SPEED);
    if (Math.hypot(this.vx, this.vy) < MIN_INERTIA_SPEED) {
      this.vx = 0;
      this.vy = 0;
    }
  }

  wheel(deltaY: number, sx: number, sy: number): void {
    const factor = clamp(Math.exp(-deltaY * 0.0022), 0.5, 2);
    this.snapping = false;
    this.anchorX = sx;
    this.anchorY = sy;
    this.wheelIdleMs = WHEEL_IDLE_MS;
    this.zoomAt(factor, sx, sy);
  }

  wheelAt(gesture: WheelGesture, sx: number, sy: number): void {
    if (gesture.zoom) {
      this.wheel(gesture.dz, sx, sy);
      return;
    }
    // Scrolling is the second way out of a tall tower, so it answers to the same switch
    // the hero uses to take every pointer gesture away.
    if (!this.panEnabled) return;
    if (gesture.dx === 0 && gesture.dy === 0) return;
    this.easeY = null;
    this.vx = 0;
    this.vy = 0;
    this.panBy(gesture.dx, gesture.dy);
  }

  zoomStep(direction: 1 | -1): void {
    this.wheel(-direction * KEY_ZOOM_DELTA, this.viewW / 2, this.viewH / 2);
  }

  ensureFloorVisible(floor: number): void {
    const half = this.viewH / 2 / this.zoom;
    const top = floorTopY(floor);
    const base = floorBaseY(floor);
    let target: number;
    if (base - top >= 2 * half) target = (top + base) / 2; // deeper than the viewport: center it
    else if (top < this.y - half) target = top + half;
    else if (base > this.y + half) target = base - half;
    else return; // the whole floor is already on screen
    target = clampY(target);
    if (this.reducedMotion) {
      this.easeY = null;
      this.y = target;
      this.clampPosition();
      return;
    }
    this.vy = 0;
    this.easeY = target;
  }

  setKey(code: string, down: boolean): void {
    if (!(code in PAN_KEYS)) return;
    if (down) this.keys.add(code);
    else this.keys.delete(code);
  }

  clearKeys(): void {
    this.keys.clear();
  }

  update(dtMs: number): void {
    const dt = clamp(dtMs, 0, 100);
    if (dt <= 0) return;

    let kx = 0;
    let ky = 0;
    for (const code of this.keys) {
      const dir = PAN_KEYS[code];
      if (!dir) continue;
      kx += dir.dx;
      ky += dir.dy;
    }
    if (kx !== 0 || ky !== 0) {
      this.easeY = null;
      const len = Math.hypot(kx, ky) || 1;
      const step = (KEY_PAN_PX_PER_SECOND * dt) / 1000;
      this.vx = 0;
      this.vy = 0;
      this.panBy((kx / len) * step, (ky / len) * step);
    }

    if (!this.dragging && (this.vx !== 0 || this.vy !== 0)) {
      this.panBy(this.vx * dt, this.vy * dt);
      const decay = Math.exp(-dt / FRICTION_MS);
      this.vx *= decay;
      this.vy *= decay;
      if (Math.hypot(this.vx, this.vy) < MIN_INERTIA_SPEED) {
        this.vx = 0;
        this.vy = 0;
      }
    }

    if (this.easeY !== null) {
      if (this.dragging) this.easeY = null;
      else {
        const t = 1 - Math.exp(-dt / FOLLOW_EASE_MS);
        const next = this.y + (this.easeY - this.y) * t;
        if (Math.abs(this.easeY - next) < 0.5) {
          this.y = this.easeY;
          this.easeY = null;
        } else {
          this.y = next;
        }
        this.clampPosition();
      }
    }

    if (this.wheelIdleMs > 0) {
      this.wheelIdleMs -= dt;
      if (this.wheelIdleMs <= 0) {
        this.wheelIdleMs = 0;
        this.snapTarget = nearestSnap(this.zoom);
        this.snapping = Math.abs(this.snapTarget - this.zoom) > 0.0005;
        if (this.snapping && this.reducedMotion) this.applySnapTarget(this.snapTarget);
      }
    }

    if (this.snapping) {
      const t = 1 - Math.exp(-dt / SNAP_EASE_MS);
      const next = this.zoom + (this.snapTarget - this.zoom) * t;
      if (Math.abs(this.snapTarget - next) < 0.002) this.applySnapTarget(this.snapTarget);
      else this.zoomAt(next / this.zoom, this.anchorX, this.anchorY);
    }
  }

  screenToWorld(sx: number, sy: number): { x: number; y: number } {
    return {
      x: this.x + (sx - this.viewW / 2) / this.zoom,
      y: this.y + (sy - this.viewH / 2) / this.zoom,
    };
  }

  worldToScreen(wx: number, wy: number): { x: number; y: number } {
    return {
      x: (wx - this.x) * this.zoom + this.viewW / 2,
      y: (wy - this.y) * this.zoom + this.viewH / 2,
    };
  }

  private applySnapTarget(target: number): void {
    this.snapping = false;
    if (Math.abs(target - this.zoom) > 0.0005) this.zoomAt(target / this.zoom, this.anchorX, this.anchorY);
    this.zoom = target;
  }

  private clampPosition(): void {
    const left = -PAN_MARGIN_PX;
    const right = TOWER_WIDTH * TILE_PX + PAN_MARGIN_PX;
    this.x = clamp(this.x, left, right);
    this.y = clampY(this.y);
  }
}

/** The vertical range the camera center may sit in, roof to basement plus the margin. */
function clampY(y: number): number {
  return clamp(y, floorTopY(MAX_FLOOR) - PAN_MARGIN_PX, floorBaseY(MIN_FLOOR) + PAN_MARGIN_PX);
}

/** The snap stop nearest to a zoom, measured in log space so 0.5 and 2 feel even. */
export function nearestSnap(zoom: number): number {
  let best = SNAP_STOPS[0] as number;
  let bestDistance = Infinity;
  for (const stop of SNAP_STOPS) {
    const distance = Math.abs(Math.log(zoom / stop));
    if (distance < bestDistance) {
      bestDistance = distance;
      best = stop;
    }
  }
  return best;
}

export function createCamera(): Camera {
  return new TowerCamera();
}
