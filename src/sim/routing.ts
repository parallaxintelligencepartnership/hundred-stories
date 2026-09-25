// Floor connectivity: which floors can a sim reach, and by which legs.
//
// The graph is tiny (floors as nodes, shafts and stairs as edges) so it is rebuilt
// from scratch whenever world.routingDirty is set and cached on a module level
// WeakMap keyed by the world, together with the searches run against it.
// Nothing here mutates the world except clearing that flag, and no number is
// invented: costs come from the module constants below and the stair limit from LIMITS.

import { LIMITS } from './rules';
import { carRangeOf, floorDistance, spanTop } from './types';
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
 * A settled search, with its arrival states grouped by floor so a trip reads only its
 * destination floor. Each floor's list keeps the order the states have in `best` (the
 * order their keys were first reached), the order the old full scan walked, so the first
 * of equal goals still wins. The bench hashes are the proof that goals did not move.
 */
interface Search {
  best: Map<number, Node>;
  /** States that arrived on a floor by a connector (via not null), per floor. */
  byFloor: Map<number, Node[]>;
}

/**
 * Everything derived from the tower's shape, thrown away together when it changes.
 * `searches` holds settled Dijkstra runs, one per origin floor and first connector: past
 * the walk to its first connector a trip's expansion depends on the graph, the staff
 * flag and that connector, never on the exact tile it starts from or where it ends. So
 * every trip leaving a floor reuses the same few searches for as long as the graph
 * stands, adds its own walk to each first connector, and picks its goal out of them.
 * Keyed this way the cache is bounded by floors times connectors, not by tiles.
 */
interface RoutingCache {
  graphs: Map<GraphKey, RoutingGraph>;
  searches: Map<string, { first: Connector; search: Search }[]>;
  /** Ends of the ground lobby, and the entrances derived from them. */
  lobby: { left: number; right: number } | null | undefined;
  entrances: { floor: number; x: number }[] | undefined;
  /** Which floors the ground lobby reaches at all, by the class blind graph. */
  reachable: Map<number, boolean>;
}

const caches = new WeakMap<World, RoutingCache>();

function newCache(): RoutingCache {
  return { graphs: new Map(), searches: new Map(), lobby: undefined, entrances: undefined, reachable: new Map() };
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
      floors: [room.floor, spanTop(room.floor, 2)], // B1 to the ground skips floor 0
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
    caches.set(world, newCache()); // every class is rebuilt on demand
    world.routingDirty = false;
  }
}

/**
 * Invariant that makes the search cache exact: runSearch reads only the
 * graph (rooms, shafts, each car's floor range and rider setting), the origin floor and
 * the first connector. It never reads a car's position, its door state, a hall call or
 * a queue length, and the sim's own tile enters only as the walk to that first
 * connector, which chooseGoal adds afterwards (it is the same for every state reached
 * through that connector, so it shifts costs without reordering them). So a settled
 * search stays correct for as long as the graph stands, and every build command
 * that changes the graph sets world.routingDirty, which throws the whole cache away.
 * Searches therefore live exactly as long as the graphs they were run on, with no clear
 * on the minute change (the graphs never had one, so dropping it for searches adds no
 * staleness a missed routingDirty would not already cause). If the search ever starts
 * reading car positions or calls, this cache must go.
 */
function cacheOf(world: World): RoutingCache {
  ensureRouting(world);
  return caches.get(world) as RoutingCache;
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

/**
 * Binary min-heap for the search's open set. `less(a, b)` is the primary order; items
 * neither less than the other pop in the order they were pushed (a rising sequence
 * number is the secondary key). That is exactly the pick the old linear scan made: it
 * kept the first queued item among equals, and its queue stayed in push order.
 */
export class SeqHeap<T> {
  private items: T[] = [];
  private seqs: number[] = [];
  private nextSeq = 0;

  constructor(private readonly less: (a: T, b: T) => boolean) {}

  get size(): number {
    return this.items.length;
  }

  push(item: T): void {
    this.items.push(item);
    this.seqs.push(this.nextSeq++);
    this.up(this.items.length - 1);
  }

  pop(): T | undefined {
    const items = this.items;
    if (items.length === 0) return undefined;
    const top = items[0] as T;
    const lastItem = items.pop() as T;
    const lastSeq = this.seqs.pop() as number;
    if (items.length > 0) {
      items[0] = lastItem;
      this.seqs[0] = lastSeq;
      this.down(0);
    }
    return top;
  }

  private before(i: number, j: number): boolean {
    const a = this.items[i] as T;
    const b = this.items[j] as T;
    if (this.less(a, b)) return true;
    if (this.less(b, a)) return false;
    return (this.seqs[i] as number) < (this.seqs[j] as number);
  }

  private swap(i: number, j: number): void {
    const items = this.items;
    const seqs = this.seqs;
    const t = items[i] as T;
    items[i] = items[j] as T;
    items[j] = t;
    const q = seqs[i] as number;
    seqs[i] = seqs[j] as number;
    seqs[j] = q;
  }

  private up(i: number): void {
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (!this.before(i, parent)) return;
      this.swap(i, parent);
      i = parent;
    }
  }

  private down(i: number): void {
    const n = this.items.length;
    for (;;) {
      const l = 2 * i + 1;
      const r = l + 1;
      let m = i;
      if (l < n && this.before(l, m)) m = l;
      if (r < n && this.before(r, m)) m = r;
      if (m === i) return;
      this.swap(i, m);
      i = m;
    }
  }
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
  const goal = chooseGoal(world, graph, opts?.riderClass ?? 'all', staff, from, to);
  if (goal === null) return null;
  return legsFor(goal, to.x);
}

/**
 * The best arrival on the destination floor, over the searches of every first connector
 * the trip could walk to. Costs, first walk and connector id are compared exactly as a
 * single search from the tile would compare them: the walk from the tile to the first
 * connector is added to each state's cost, and that walk is the state's first distance.
 */
function chooseGoal(
  world: World,
  graph: RoutingGraph,
  key: GraphKey,
  staff: boolean,
  from: { floor: number; x: number },
  to: { floor: number; x: number },
): Node | null {
  let goal: Node | null = null;
  let goalCost = 0;
  let goalFirstDist = 0;
  for (const { first, search } of searchesFrom(world, graph, key, staff, from.floor)) {
    const firstDist = Math.abs(first.x - from.x);
    const offset = walkCost(first.x - from.x);
    for (const node of search.byFloor.get(to.floor) ?? []) {
      const total = offset + node.cost + walkCost(to.x - node.x);
      const viaId = (node.via as Connector).id;
      if (goal === null || betterThan(total, firstDist, viaId, goalCost, goalFirstDist, (goal.via as Connector).id)) {
        goal = node;
        goalCost = total;
        goalFirstDist = firstDist;
      }
    }
  }
  return goal;
}

/**
 * The cheapest arrival among candidate states once the walk to the destination tile is
 * priced in. The first of equal candidates wins, so the order of `nodes` decides ties.
 */
function pickGoal(nodes: Iterable<Node>, to: { floor: number; x: number }): Node | null {
  let goal: Node | null = null;
  let goalCost = 0;
  for (const node of nodes) {
    if (node.floor !== to.floor || node.via === null) continue;
    const total = node.cost + walkCost(to.x - node.x);
    if (goal === null || betterThan(total, node.firstDist, node.via.id, goalCost, goal.firstDist, (goal.via as Connector).id)) {
      goal = node;
      goalCost = total;
    }
  }
  return goal;
}

/** Groups a settled search's arrival states by floor, in `best` order. */
function indexByFloor(best: Map<number, Node>): Map<number, Node[]> {
  const byFloor = new Map<number, Node[]>();
  for (const node of best.values()) {
    if (node.via === null) continue;
    let list = byFloor.get(node.floor);
    if (!list) byFloor.set(node.floor, (list = []));
    list.push(node);
  }
  return byFloor;
}

/**
 * Test hook: the route findRoute builds, next to the route a brute force scan of every
 * state in a fresh, uncached search from the exact tile would build. `candidates` is how
 * many arrival states that scan saw on the destination floor. The two must always match.
 */
export function goalScanCheck(
  world: World,
  from: { floor: number; x: number },
  to: { floor: number; x: number },
  opts?: { staff?: boolean; riderClass?: RiderClass },
): { indexed: Leg[] | null; bruteForce: Leg[] | null; candidates: number } {
  const graph = graphOf(world, opts?.riderClass ?? 'all');
  const best = runSearch(graph, opts?.staff === true, from);
  const bruteForce = pickGoal(best.values(), to);
  let candidates = 0;
  for (const node of best.values()) if (node.floor === to.floor && node.via !== null) candidates++;
  return {
    indexed: findRoute(world, from, to, opts),
    bruteForce: bruteForce && legsFor(bruteForce, to.x),
    candidates,
  };
}

/**
 * The settled searches from one floor, one per connector a trip on it may board first,
 * cached until the graph changes. Each starts standing at its connector's tile, so
 * its costs leave out the walk there; chooseGoal adds that per trip. Where a trip starts
 * on the floor or where it ends never touches the expansion, so every trip leaving the
 * floor for the same rider shares this work.
 */
function searchesFrom(
  world: World,
  graph: RoutingGraph,
  key: GraphKey,
  staff: boolean,
  floor: number,
): { first: Connector; search: Search }[] {
  const cache = cacheOf(world);
  const cacheKey = `${key}|${staff ? 1 : 0}|${floor}`;
  let searches = cache.searches.get(cacheKey);
  if (!searches) {
    searches = [];
    for (const first of graph.byFloor.get(floor) ?? []) {
      if (first.staffOnly && !staff) continue;
      const best = runSearch(graph, staff, { floor, x: first.x }, first);
      searches.push({ first, search: { best, byFloor: indexByFloor(best) } });
    }
    cache.searches.set(cacheKey, searches);
  }
  return searches;
}

/**
 * Dijkstra from a tile. With `first` given, the opening hop may only board that
 * connector (from its own tile), which is how searchesFrom splits a trip by first move.
 */
function runSearch(
  graph: RoutingGraph,
  staff: boolean,
  from: { floor: number; x: number },
  first?: Connector,
): Map<number, Node> {
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
  const queue = new SeqHeap<Node>(better);
  queue.push(start);
  const settled = new Set<number>();

  while (queue.size > 0) {
    const node = queue.pop() as Node;
    const key = stateKey(graph, node.floor, node.via?.id ?? 0, node.stairFloors);
    if (settled.has(key)) continue;
    if (best.get(key) !== node) continue; // superseded by a better node with the same key
    settled.add(key);

    const firstDistOfNext = node.via === null ? -1 : node.firstDist;
    for (const via of graph.byFloor.get(node.floor) ?? []) {
      if (via.staffOnly && !staff) continue;
      if (first !== undefined && node === start && via !== first) continue;
      if (via.kind === 'shaft' && via.id === node.via?.id) continue; // no point reboarding
      const isStairs = via.kind === 'stairs';
      const stepCost = node.cost + walkCost(via.x - node.x) + (isStairs ? 0 : TRANSFER_COST);
      const firstDist = firstDistOfNext === -1 ? Math.abs(via.x - from.x) : firstDistOfNext;
      for (const floor of via.floors) {
        if (floor === node.floor) continue;
        const stairFloors = isStairs ? floorDistance(floor, node.floor) : 0;
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
