// Floor connectivity: which floors can a sim reach, and by which legs.
//
// The graph is tiny (floors as nodes, shafts and stairs as edges) so it is rebuilt
// from scratch whenever world.routingDirty is set and cached on a module level
// WeakMap keyed by the world, together with the searches run against it this minute.
// Nothing here mutates the world except clearing that flag, and no number is
// invented: costs come from the module constants below and the stair limit from LIMITS.

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
  /**
   * A dense number per connector id, so a search state can be a number instead of a
   * string. Connectors of one shaft share an id, exactly as the state key always did.
   */
  idIndex: Map<Id, number>;
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

/**
 * Everything derived from the tower's shape, thrown away together when it changes.
 * `searches` holds the settled Dijkstra of one game minute: the expansion depends on
 * the graph, the staff flag and where the trip starts, never on where it ends, so every
 * trip leaving the same tile in the same minute reuses one search and only picks its own
 * goal out of it. A morning rush asks for the same handful of origins thousands of times.
 */
interface RoutingCache {
  graphs: Map<GraphKey, RoutingGraph>;
  searches: Map<string, Map<number, Node>>;
  /** The game minute `searches` was filled for. */
  minute: number;
  /** Ends of the ground lobby, and the entrances derived from them. */
  lobby: { left: number; right: number } | null | undefined;
  entrances: { floor: number; x: number }[] | undefined;
  /** Which floors the ground lobby reaches at all, by the class blind graph. */
  reachable: Map<number, boolean>;
}

const caches = new WeakMap<World, RoutingCache>();

function newCache(minute: number): RoutingCache {
  return { graphs: new Map(), searches: new Map(), minute, lobby: undefined, entrances: undefined, reachable: new Map() };
}

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
  const idIndex = new Map<Id, number>();
  for (const list of byFloor.values()) {
    for (const connector of list) if (!idIndex.has(connector.id)) idIndex.set(connector.id, idIndex.size + 1);
  }
  return { byFloor, idIndex };
}

export function ensureRouting(world: World): void {
  if (world.routingDirty || !caches.has(world)) {
    caches.set(world, newCache(world.time.minute)); // every class is rebuilt on demand
    world.routingDirty = false;
  }
}

/**
 * Invariant that makes the per-minute search cache exact: runSearch reads only the
 * graph (rooms, shafts, each car's floor range and rider setting) and the origin tile.
 * It never reads a car's position, its door state, a hall call or a queue length. So a
 * settled search stays correct for as long as the graph stands, and every build command
 * that changes the graph sets world.routingDirty, which throws the whole cache away.
 * The clear on the minute change is belt and braces, not a correctness need. If the
 * search ever starts reading car positions or calls, this cache must go.
 */
function cacheOf(world: World): RoutingCache {
  ensureRouting(world);
  const cache = caches.get(world) as RoutingCache;
  // Searches are only good for the minute they were run in: cars move, and a route is
  // planned against the graph, not the cars, but nothing should outlive a tick anyway.
  if (cache.minute !== world.time.minute) {
    cache.searches.clear();
    cache.minute = world.time.minute;
  }
  return cache;
}

function graphOf(world: World, key: GraphKey): RoutingGraph {
  const cache = cacheOf(world);
  let graph = cache.graphs.get(key);
  if (!graph) cache.graphs.set(key, (graph = buildGraph(world, key)));
  return graph;
}

/** True when a is the better of two candidate nodes: cheaper, then closer to home. */
function better(a: Node, b: Node): boolean {
  return betterThan(a.cost, a.firstDist, a.via?.id ?? 0, b.cost, b.firstDist, b.via?.id ?? 0);
}

/** The same order as `better`, on loose numbers, so a candidate needs no object. */
function betterThan(
  aCost: number,
  aFirstDist: number,
  aViaId: number,
  bCost: number,
  bFirstDist: number,
  bViaId: number,
): boolean {
  if (Math.abs(aCost - bCost) > EPSILON) return aCost < bCost;
  if (Math.abs(aFirstDist - bFirstDist) > EPSILON) return aFirstDist < bFirstDist;
  return aViaId < bViaId;
}

/** Stair floors a state can carry: none up to the limit. */
const STAIR_STATES = LIMITS.stairsMaxClimbFloors + 1;
/** Shifts the lowest basement above zero so a floor can go into a numeric key. */
const FLOOR_OFFSET = 512;

/**
 * A search state as a number: floor, the connector id it arrived on, stair floors spent.
 * Same identity the string key had, including two cars of one shaft sharing a state.
 */
function stateKey(graph: RoutingGraph, floor: number, viaId: Id, stairFloors: number): number {
  const index = viaId === 0 ? 0 : (graph.idIndex.get(viaId) ?? 0);
  return ((floor + FLOOR_OFFSET) * (graph.idIndex.size + 1) + index) * STAIR_STATES + stairFloors;
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
  const best = searchFrom(world, graph, opts?.riderClass ?? 'all', staff, from);

  let goal: Node | null = null;
  let goalCost = 0;
  for (const node of best.values()) {
    if (node.floor !== to.floor || node.via === null) continue;
    const total = node.cost + walkCost(to.x - node.x);
    if (goal === null || betterThan(total, node.firstDist, node.via.id, goalCost, goal.firstDist, (goal.via as Connector).id)) {
      goal = node;
      goalCost = total;
    }
  }
  if (goal === null) return null;
  return legsFor(goal, to.x);
}

/**
 * The settled search from one tile, cached for the current game minute. Where a trip
 * ends never touches the expansion below, only the goal picked out of the result, so
 * every trip starting on the same tile for the same rider shares this work.
 */
function searchFrom(
  world: World,
  graph: RoutingGraph,
  key: GraphKey,
  staff: boolean,
  from: { floor: number; x: number },
): Map<number, Node> {
  const cache = cacheOf(world);
  const cacheKey = `${key}|${staff ? 1 : 0}|${from.floor}|${from.x}`;
  let best = cache.searches.get(cacheKey);
  if (!best) cache.searches.set(cacheKey, (best = runSearch(graph, staff, from)));
  return best;
}

function runSearch(graph: RoutingGraph, staff: boolean, from: { floor: number; x: number }): Map<number, Node> {
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
  const best = new Map<number, Node>([[stateKey(graph, start.floor, 0, 0), start]]);
  const queue: Node[] = [start];
  const settled = new Set<number>();

  while (queue.length > 0) {
    let pick = 0;
    for (let i = 1; i < queue.length; i++) {
      if (better(queue[i] as Node, queue[pick] as Node)) pick = i;
    }
    const node = queue.splice(pick, 1)[0] as Node;
    const key = stateKey(graph, node.floor, node.via?.id ?? 0, node.stairFloors);
    if (settled.has(key)) continue;
    if (best.get(key) !== node) continue; // superseded by a better node with the same key
    settled.add(key);

    const firstDistOfNext = node.via === null ? -1 : node.firstDist;
    for (const via of graph.byFloor.get(node.floor) ?? []) {
      if (via.staffOnly && !staff) continue;
      if (via.kind === 'shaft' && via.id === node.via?.id) continue; // no point reboarding
      const isStairs = via.kind === 'stairs';
      const stepCost = node.cost + walkCost(via.x - node.x) + (isStairs ? 0 : TRANSFER_COST);
      const firstDist = firstDistOfNext === -1 ? Math.abs(via.x - from.x) : firstDistOfNext;
      for (const floor of via.floors) {
        if (floor === node.floor) continue;
        const stairFloors = isStairs ? Math.abs(floor - node.floor) : 0;
        const totalStairs = node.stairFloors + stairFloors;
        if (totalStairs > LIMITS.stairsMaxClimbFloors) continue;
        const cost = stepCost + stairFloors * STAIR_FLOOR_COST;
        // Score the candidate before building it: most of them lose, and a losing
        // state that never becomes an object is the bulk of the work saved here.
        const nextKey = stateKey(graph, floor, via.id, totalStairs);
        if (settled.has(nextKey)) continue;
        const known = best.get(nextKey);
        if (known && !betterThan(cost, firstDist, via.id, known.cost, known.firstDist, known.via?.id ?? 0)) continue;
        const next: Node = {
          floor,
          x: via.x,
          stairFloors: totalStairs,
          cost,
          firstDist,
          via,
          fromFloor: node.floor,
          parent: node,
        };
        best.set(nextKey, next);
        queue.push(next);
      }
    }
  }
  return best;
}

/** Ends of the ground lobby, cached: a long lobby is hundreds of one tile rooms. */
function lobbyEnds(world: World): { left: number; right: number } | null {
  const cache = cacheOf(world);
  if (cache.lobby !== undefined) return cache.lobby;
  let left = Number.POSITIVE_INFINITY;
  let right = Number.NEGATIVE_INFINITY;
  for (const room of roomsOnFloor(world, 1)) {
    if (room.kind !== 'lobby') continue;
    if (room.x < left) left = room.x;
    if (room.x + room.width - 1 > right) right = room.x + room.width - 1;
  }
  const ends = left === Number.POSITIVE_INFINITY ? null : { left, right };
  cache.lobby = ends;
  return ends;
}

export function isReachableFromLobby(world: World, floor: number, x: number): boolean {
  const ends = lobbyEnds(world);
  if (!ends) return false;
  // The answer turns on the floor alone: the walk to x only prices a route, it never
  // decides whether one exists, so one search per floor answers for every tile on it.
  const cache = cacheOf(world);
  const known = cache.reachable.get(floor);
  if (known !== undefined) return known;
  const answer = findRoute(world, { floor: 1, x: ends.left }, { floor, x }) !== null;
  cache.reachable.set(floor, answer);
  return answer;
}

export function entrances(world: World): { floor: number; x: number }[] {
  const cache = cacheOf(world);
  let points = cache.entrances;
  if (!points) {
    points = [];
    const ends = lobbyEnds(world);
    if (ends) {
      points.push({ floor: 1, x: ends.left });
      if (ends.right !== ends.left) points.push({ floor: 1, x: ends.right });
    }
    const metro = roomsOfKind(world, 'metro')[0];
    if (metro) points.push({ floor: metro.floor, x: metro.x + Math.floor(metro.width / 2) });
    cache.entrances = points;
  }
  // A fresh copy every call: callers hold on to these points and some move them.
  return points.map((p) => ({ floor: p.floor, x: p.x }));
}
