// Floor connectivity: which floors can a sim reach, and by which legs.
//
// The graph is tiny (floors as nodes, shafts and stairs as edges) so it is rebuilt
// from scratch whenever world.routingDirty is set and cached on a module level
// WeakMap keyed by the world. Nothing here mutates the world except clearing that
// flag, and no number is invented: costs come from the module constants below and
// the stair limit comes from LIMITS.

import { LIMITS } from './rules';
import { carRangeOf } from './types';
import type { Id, Leg, RiderClass, Room, World } from './types';
import { roomsOfKind, roomsOnFloor } from './world';

/** Cost of boarding one elevator. One floor is quicker on foot, two or more ride. */
const TRANSFER_COST = 5;
/** Cost of one floor climbed on foot, on top of the transfer free walk. */
const STAIR_FLOOR_COST = 4;
/** Walking this many tiles costs the same as one unit of route cost. */
const WALK_TILES_PER_COST = 50;
/** Floating point slack when two route costs are compared. */
const EPSILON = 1e-9;

/** One way to move between floors: an elevator shaft or a stairs/escalator room. */
interface Connector {
  kind: 'shaft' | 'stairs';
  id: Id;
  /** Tile a sim walks to in order to use it. */
  x: number;
  /** Floors this connector serves, ascending. */
  floors: number[];
  /** Service shafts are only offered to staff routes. */
  staffOnly: boolean;
}

interface RoutingGraph {
  byFloor: Map<number, Connector[]>;
}

/** Search state: standing on a floor at a tile, having climbed some stair floors. */
interface Node {
  floor: number;
  x: number;
  stairFloors: number;
  cost: number;
  /** Walk distance from the trip origin to the first connector used, for tie breaks. */
  firstDist: number;
  via: Connector | null;
  fromFloor: number;
  parent: Node | null;
}

/**
 * One graph per rider class, because a shaft only connects the floors some car will
 * carry that rider between. The key `all` is the class blind graph: every car counts,
 * which is what a structural question like isReachableFromLobby wants.
 */
type GraphKey = RiderClass | 'all';

const graphs = new WeakMap<World, Map<GraphKey, RoutingGraph>>();

function walkCost(tiles: number): number {
  return Math.abs(tiles) / WALK_TILES_PER_COST;
}

function isStairRoom(room: Room): boolean {
  return room.kind === 'stairs' || room.kind === 'escalator';
}

/** The tile a sim walks to in order to use a stairs or escalator room. */
function stairAccessX(room: Room): number {
  return room.x + Math.floor(room.width / 2);
}

function buildGraph(world: World, key: GraphKey): RoutingGraph {
  const byFloor = new Map<number, Connector[]>();
  const add = (connector: Connector): void => {
    for (const floor of connector.floors) {
      let list = byFloor.get(floor);
      if (!list) byFloor.set(floor, (list = []));
      list.push(connector);
    }
  };

  for (const shaft of world.shafts.values()) {
    const stops = [...shaft.stops]
      .filter((f) => f >= shaft.floorMin && f <= shaft.floorMax)
      .sort((a, b) => a - b);
    if (stops.length < 2) continue; // a shaft with one stop connects nothing
    // One connector per distinct range among the cars that would carry this rider.
    // A dedicated car counts for its own class only: the leftover rule is a courtesy
    // the dispatcher pays at the door, never a connection a trip may be planned on.
    const ranges = new Set<string>();
    for (const car of shaft.cars) {
      if (key !== 'all' && car.serves !== 'any' && car.serves !== key) continue;
      const { lo, hi } = carRangeOf(shaft, car);
      if (ranges.has(`${lo}:${hi}`)) continue;
      ranges.add(`${lo}:${hi}`);
      const floors = stops.filter((f) => f >= lo && f <= hi);
      if (floors.length < 2) continue; // this car connects nothing
      add({
        kind: 'shaft',
        id: shaft.id,
        x: shaft.x,
        floors,
        staffOnly: shaft.kind === 'service',
      });
    }
  }

  for (const room of world.rooms.values()) {
    if (!isStairRoom(room)) continue;
    add({
      kind: 'stairs',
      id: room.id,
      x: stairAccessX(room),
      floors: [room.floor, room.floor + 1],
      staffOnly: false,
    });
  }

  for (const list of byFloor.values()) {
    list.sort((a, b) => a.x - b.x || a.id - b.id);
  }
  return { byFloor };
}

export function ensureRouting(world: World): void {
  if (world.routingDirty || !graphs.has(world)) {
    graphs.set(world, new Map()); // every class is rebuilt on demand
    world.routingDirty = false;
  }
}

function graphOf(world: World, key: GraphKey): RoutingGraph {
  ensureRouting(world);
  const cache = graphs.get(world) as Map<GraphKey, RoutingGraph>;
  let graph = cache.get(key);
  if (!graph) cache.set(key, (graph = buildGraph(world, key)));
  return graph;
}

/** True when a is the better of two candidate nodes: cheaper, then closer to home. */
function better(a: Node, b: Node): boolean {
  if (Math.abs(a.cost - b.cost) > EPSILON) return a.cost < b.cost;
  if (Math.abs(a.firstDist - b.firstDist) > EPSILON) return a.firstDist < b.firstDist;
  return (a.via?.id ?? 0) < (b.via?.id ?? 0);
}

function stateKey(node: Node): string {
  return `${node.floor}|${node.via?.id ?? 0}|${node.stairFloors}`;
}

function legsFor(node: Node, toX: number): Leg[] {
  const chain: Node[] = [];
  for (let n: Node | null = node; n && n.via; n = n.parent) chain.push(n);
  chain.reverse();

  const legs: Leg[] = [];
  for (const hop of chain) {
    const via = hop.via as Connector;
    legs.push({ kind: 'walk', toX: via.x });
    if (via.kind === 'shaft') {
      legs.push({ kind: 'ride', shaftId: via.id, fromFloor: hop.fromFloor, toFloor: hop.floor });
    } else {
      legs.push({ kind: 'stairs', roomId: via.id, toFloor: hop.floor });
    }
  }
  legs.push({ kind: 'walk', toX });
  return legs;
}

export function findRoute(
  world: World,
  from: { floor: number; x: number },
  to: { floor: number; x: number },
  opts?: { staff?: boolean; riderClass?: RiderClass },
): Leg[] | null {
  // No class named means the class blind graph: ask whether the floors connect at all.
  const graph = graphOf(world, opts?.riderClass ?? 'all');
  if (from.floor === to.floor) return [{ kind: 'walk', toX: to.x }];

  const staff = opts?.staff === true;
  const start: Node = {
    floor: from.floor,
    x: from.x,
    stairFloors: 0,
    cost: 0,
    firstDist: 0,
    via: null,
    fromFloor: from.floor,
    parent: null,
  };

  // Dijkstra to exhaustion over a small graph: the walk to the destination tile is
  // only known once a node on the destination floor is settled, so every reachable
  // node is expanded and the goal is picked afterwards.
  const best = new Map<string, Node>([[stateKey(start), start]]);
  const queue: Node[] = [start];
  const settled = new Set<string>();

  while (queue.length > 0) {
    let pick = 0;
    for (let i = 1; i < queue.length; i++) {
      if (better(queue[i] as Node, queue[pick] as Node)) pick = i;
    }
    const node = queue.splice(pick, 1)[0] as Node;
    const key = stateKey(node);
    if (settled.has(key)) continue;
    if (best.get(key) !== node) continue; // superseded by a better node with the same key
    settled.add(key);

    for (const via of graph.byFloor.get(node.floor) ?? []) {
      if (via.staffOnly && !staff) continue;
      if (via.kind === 'shaft' && via.id === node.via?.id) continue; // no point reboarding
      for (const floor of via.floors) {
        if (floor === node.floor) continue;
        const stairFloors = via.kind === 'stairs' ? Math.abs(floor - node.floor) : 0;
        const totalStairs = node.stairFloors + stairFloors;
        if (totalStairs > LIMITS.stairsMaxClimbFloors) continue;
        const cost =
          node.cost +
          walkCost(via.x - node.x) +
          (via.kind === 'shaft' ? TRANSFER_COST : 0) +
          stairFloors * STAIR_FLOOR_COST;
        const next: Node = {
          floor,
          x: via.x,
          stairFloors: totalStairs,
          cost,
          firstDist: node.via === null ? Math.abs(via.x - from.x) : node.firstDist,
          via,
          fromFloor: node.floor,
          parent: node,
        };
        const nextKey = stateKey(next);
        if (settled.has(nextKey)) continue;
        const known = best.get(nextKey);
        if (known && !better(next, known)) continue;
        best.set(nextKey, next);
        queue.push(next);
      }
    }
  }

  let goal: Node | null = null;
  let goalCost = 0;
  for (const node of best.values()) {
    if (node.floor !== to.floor || node.via === null) continue;
    const total = node.cost + walkCost(to.x - node.x);
    const candidate: Node = { ...node, cost: total };
    if (goal === null || better(candidate, { ...goal, cost: goalCost })) {
      goal = node;
      goalCost = total;
    }
  }
  if (goal === null) return null;
  return legsFor(goal, to.x);
}

export function isReachableFromLobby(world: World, floor: number, x: number): boolean {
  const lobbies = roomsOnFloor(world, 1).filter((r) => r.kind === 'lobby');
  if (lobbies.length === 0) return false;
  const left = Math.min(...lobbies.map((r) => r.x));
  return findRoute(world, { floor: 1, x: left }, { floor, x }) !== null;
}

export function entrances(world: World): { floor: number; x: number }[] {
  const out: { floor: number; x: number }[] = [];
  const lobbies = roomsOnFloor(world, 1).filter((r) => r.kind === 'lobby');
  if (lobbies.length > 0) {
    const left = Math.min(...lobbies.map((r) => r.x));
    const right = Math.max(...lobbies.map((r) => r.x + r.width - 1));
    out.push({ floor: 1, x: left });
    if (right !== left) out.push({ floor: 1, x: right });
  }
  const metro = roomsOfKind(world, 'metro')[0];
  if (metro) out.push({ floor: metro.floor, x: metro.x + Math.floor(metro.width / 2) });
  return out;
}
