import { mulberry32 } from './rng';

/**
 * The town of Wrenford: a street grid with two diagonal avenues, a river crossed by two bridges,
 * parks that interrupt the grid, a rail line and named districts. Everything is generated from a
 * seed, so it is identical on every load. Travel times are shortest paths on the road graph.
 */

export const TOWN_NAME = 'Wrenford';
export const TOWN_SEED = 20261121;
/** Metres per map unit. */
export const UNIT_M = 8;

const COLS = 20;
const ROWS = 13;
const S = 60;
const PAD = 30;
export const W = PAD * 2 + (COLS - 1) * S;
export const H = PAD * 2 + (ROWS - 1) * S;
const RIVER_W = 36;
/** Rows that run unbroken across each bank as faster main roads. */
const MAIN_ROWS = [4, 9];

const STREET_SPEED = 500; // metres per minute, about 30 km/h
const AVENUE_SPEED = 720; // about 43 km/h
const NODE_DELAY = 0.3; // minutes lost at each junction

export type EdgeKind = 'street' | 'avenue' | 'bridge';

export interface TNode {
  x: number;
  y: number;
  i: number;
  j: number;
  district: number;
}

export interface TEdge {
  a: number;
  b: number;
  len: number;
  time: number;
  kind: EdgeKind;
}

export interface Park {
  x: number;
  y: number;
  w: number;
  h: number;
  name: string;
}

export interface Bridge {
  edge: number;
  name: string;
  x: number;
  y: number;
}

export interface District {
  name: string;
  x: number;
  y: number;
}

export interface Town {
  W: number;
  H: number;
  nodes: TNode[];
  edges: TEdge[];
  adj: number[][]; // edge indices per node
  riverY: (x: number) => number;
  riverWidth: number;
  bridges: Bridge[];
  parks: Park[];
  rail: { x1: number; y1: number; x2: number; y2: number };
  station: { x: number; y: number };
  districts: District[];
  depot: number;
  rowNames: string[];
  n: number;
  /** Exact shortest travel time in minutes, n by n. */
  exact: Float64Array;
  /** Rounded whole-minute travel times used everywhere on screen. */
  tt: Int32Array;
  /** prev[s * n + t] is the node before t on the shortest path from s. */
  prev: Int32Array;
}

const ROW_NAMES = [
  'Alder Street',
  'Birch Street',
  'Copper Street',
  'Dove Street',
  'High Street',
  'Fern Street',
  'Garnet Street',
  'Hazel Street',
  'Ivy Street',
  'Market Street',
  'Kestrel Street',
  'Linden Street',
  'Maple Street',
];

// name, seed (fraction of the map), label position (map units, clear of parks and water)
const DISTRICT_SEEDS: Array<[string, number, number, number, number]> = [
  ['Old Town', 0.47, 0.3, 455, 243],
  ['North Hill', 0.17, 0.24, 215, 108],
  ['Larkfield', 0.8, 0.2, 975, 150],
  ['Foundry Row', 0.86, 0.5, 1065, 322],
  ['Millbrook', 0.12, 0.55, 118, 398],
  ['Wharfside', 0.52, 0.76, 505, 668],
  ['Ashgrove', 0.2, 0.84, 112, 716],
  ['Southmead', 0.82, 0.84, 1075, 728],
];

const PARK_RECTS: Array<[string, number, number, number, number]> = [
  ['Hollis Park', 2, 2, 4, 4],
  ['The Commons', 9, 1, 12, 3],
  ['Beck Gardens', 14, 9, 16, 11],
  ['Quarry Green', 3, 9, 5, 11],
];

export function riverY(x: number): number {
  return H * 0.55 + 46 * Math.sin((2 * Math.PI * x) / 1100 + 0.5) + 14 * Math.sin((2 * Math.PI * x) / 420 + 1.9);
}

function gx(i: number) {
  return PAD + i * S;
}
function gy(j: number) {
  return PAD + j * S;
}

function inRiver(x: number, y: number, margin = 5) {
  return Math.abs(y - riverY(x)) < RIVER_W / 2 + margin;
}
function riverSide(x: number, y: number) {
  return y < riverY(x) ? -1 : 1;
}

export function buildTown(seed = TOWN_SEED): Town {
  const rng = mulberry32(seed);
  const parks: Park[] = PARK_RECTS.map(([name, i0, j0, i1, j1]) => ({
    name,
    x: gx(i0),
    y: gy(j0),
    w: gx(i1) - gx(i0),
    h: gy(j1) - gy(j0),
  }));
  const inParkInterior = (x: number, y: number) =>
    parks.some((p) => x > p.x + 1 && x < p.x + p.w - 1 && y > p.y + 1 && y < p.y + p.h - 1);

  // 1. Grid nodes inside a rounded town outline, outside the river and park interiors.
  const grid: number[][] = [];
  const nodes: TNode[] = [];
  for (let i = 0; i < COLS; i++) {
    grid.push([]);
    for (let j = 0; j < ROWS; j++) {
      const x = gx(i);
      const y = gy(j);
      const ex = (x - W / 2) / (W / 2 - 12);
      const ey = (y - H / 2) / (H / 2 - 12);
      const outline = ex ** 4 + ey ** 4 + (rng() - 0.5) * 0.18;
      if (outline > 1 || inRiver(x, y) || inParkInterior(x, y)) {
        grid[i].push(-1);
        continue;
      }
      grid[i].push(nodes.length);
      nodes.push({ x, y, i, j, district: -1 });
    }
  }
  const at = (i: number, j: number) => (i >= 0 && j >= 0 && i < COLS && j < ROWS ? grid[i][j] : -1);

  // 2. Candidate edges: grid streets and two diagonal avenues.
  type Cand = { a: number; b: number; kind: EdgeKind };
  const cands: Cand[] = [];
  for (let i = 0; i < COLS; i++)
    for (let j = 0; j < ROWS; j++) {
      const a = at(i, j);
      if (a < 0) continue;
      const r = at(i + 1, j);
      const d = at(i, j + 1);
      if (r >= 0) cands.push({ a, b: r, kind: MAIN_ROWS.includes(j) ? 'avenue' : 'street' });
      if (d >= 0) cands.push({ a, b: d, kind: 'street' });
    }
  const diag = (i0: number, di: number) => {
    for (let k = 0; k < ROWS - 1; k++) {
      const a = at(i0 + di * k, k);
      const b = at(i0 + di * (k + 1), k + 1);
      if (a >= 0 && b >= 0) cands.push({ a, b, kind: 'avenue' });
    }
  };
  diag(1, 1);
  diag(COLS - 1, -1);

  const crossesWater = (a: TNode, b: TNode) => {
    if (riverSide(a.x, a.y) !== riverSide(b.x, b.y)) return true;
    for (let s = 1; s < 6; s++) {
      const t = s / 6;
      if (inRiver(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t, 4)) return true;
    }
    return false;
  };
  const crossesPark = (a: TNode, b: TNode) => inParkInterior((a.x + b.x) / 2, (a.y + b.y) / 2);

  let kept = cands.filter((c) => !crossesWater(nodes[c.a], nodes[c.b]) && !crossesPark(nodes[c.a], nodes[c.b]));

  // A few missing street segments so blocks are not perfectly regular.
  const degree = new Array(nodes.length).fill(0);
  for (const c of kept) {
    degree[c.a]++;
    degree[c.b]++;
  }
  kept = kept.filter((c) => {
    if (c.kind !== 'street') return true;
    if (rng() < 0.07 && degree[c.a] > 2 && degree[c.b] > 2) {
      degree[c.a]--;
      degree[c.b]--;
      return false;
    }
    return true;
  });

  // 3. Two bridges, each joining the closest nodes either side of the river in one column.
  const bridges: Array<{ a: number; b: number; name: string }> = [];
  const bridgeCols: Array<[number, string]> = [
    [6, 'Mill Bridge'],
    [14, 'Iron Bridge'],
  ];
  for (const [i, name] of bridgeCols) {
    let north = -1;
    let south = -1;
    for (let j = 0; j < ROWS; j++) {
      const id = at(i, j);
      if (id < 0) continue;
      const n = nodes[id];
      if (riverSide(n.x, n.y) < 0) north = id;
      else if (south < 0) south = id;
    }
    if (north < 0 || south < 0) throw new Error('bridge column has no banks');
    bridges.push({ a: north, b: south, name });
    kept.push({ a: north, b: south, kind: 'bridge' });
  }

  // 4. Keep the largest connected piece and renumber.
  const tmpAdj: number[][] = nodes.map(() => []);
  kept.forEach((c, k) => {
    tmpAdj[c.a].push(k);
    tmpAdj[c.b].push(k);
  });
  const comp = new Int32Array(nodes.length).fill(-1);
  let best = -1;
  let bestSize = 0;
  let compId = 0;
  for (let s = 0; s < nodes.length; s++) {
    if (comp[s] >= 0) continue;
    const stack = [s];
    comp[s] = compId;
    let size = 0;
    while (stack.length) {
      const u = stack.pop()!;
      size++;
      for (const k of tmpAdj[u]) {
        const v = kept[k].a === u ? kept[k].b : kept[k].a;
        if (comp[v] < 0) {
          comp[v] = compId;
          stack.push(v);
        }
      }
    }
    if (size > bestSize) {
      bestSize = size;
      best = compId;
    }
    compId++;
  }
  const remap = new Int32Array(nodes.length).fill(-1);
  const finalNodes: TNode[] = [];
  nodes.forEach((n, k) => {
    if (comp[k] === best) {
      remap[k] = finalNodes.length;
      finalNodes.push(n);
    }
  });
  const edges: TEdge[] = [];
  const bridgeOut: Bridge[] = [];
  for (const c of kept) {
    const a = remap[c.a];
    const b = remap[c.b];
    if (a < 0 || b < 0) continue;
    const na = finalNodes[a];
    const nb = finalNodes[b];
    const len = Math.hypot(na.x - nb.x, na.y - nb.y);
    const speed = c.kind === 'avenue' ? AVENUE_SPEED : STREET_SPEED;
    const time = (len * UNIT_M) / speed + NODE_DELAY;
    if (c.kind === 'bridge') {
      const br = bridges.find((x) => x.a === c.a && x.b === c.b)!;
      bridgeOut.push({ edge: edges.length, name: br.name, x: (na.x + nb.x) / 2, y: (na.y + nb.y) / 2 });
    }
    edges.push({ a, b, len, time, kind: c.kind });
  }
  const n = finalNodes.length;
  const adj: number[][] = finalNodes.map(() => []);
  edges.forEach((e, k) => {
    adj[e.a].push(k);
    adj[e.b].push(k);
  });

  // 5. Districts: nearest seed on the same side of the river.
  const districts: District[] = DISTRICT_SEEDS.map(([name, fx, fy]) => ({ name, x: fx * W, y: fy * H }));
  for (const node of finalNodes) {
    const side = riverSide(node.x, node.y);
    let bd = Infinity;
    let bi = 0;
    districts.forEach((d, k) => {
      if (riverSide(d.x, d.y) !== side) return;
      const dd = (d.x - node.x) ** 2 + (d.y - node.y) ** 2;
      if (dd < bd) {
        bd = dd;
        bi = k;
      }
    });
    node.district = bi;
  }
  districts.forEach((d, k) => {
    d.x = DISTRICT_SEEDS[k][3];
    d.y = DISTRICT_SEEDS[k][4];
  });

  // 6. Depot: the yard, near the middle of Old Town.
  let depot = 0;
  let bd = Infinity;
  finalNodes.forEach((node, k) => {
    const d = (node.x - W * 0.53) ** 2 + (node.y - H * 0.36) ** 2;
    if (d < bd && adj[k].length >= 3) {
      bd = d;
      depot = k;
    }
  });

  // 7. All-pairs shortest paths (Dijkstra from every node; the graph is small).
  const exact = new Float64Array(n * n);
  const prev = new Int32Array(n * n);
  const done = new Uint8Array(n);
  for (let s = 0; s < n; s++) {
    const base = s * n;
    exact.fill(Infinity, base, base + n);
    prev.fill(-1, base, base + n);
    done.fill(0);
    exact[base + s] = 0;
    for (let it = 0; it < n; it++) {
      let u = -1;
      let ud = Infinity;
      for (let v = 0; v < n; v++) {
        if (!done[v] && exact[base + v] < ud) {
          ud = exact[base + v];
          u = v;
        }
      }
      if (u < 0) break;
      done[u] = 1;
      for (const k of adj[u]) {
        const e = edges[k];
        const v = e.a === u ? e.b : e.a;
        const nd = ud + e.time;
        if (nd < exact[base + v]) {
          exact[base + v] = nd;
          prev[base + v] = u;
        }
      }
    }
  }
  const tt = new Int32Array(n * n);
  for (let k = 0; k < n * n; k++) tt[k] = exact[k] === 0 ? 0 : Math.max(1, Math.round(exact[k]));

  const rail = { x1: 0, y1: H * 0.16, x2: W, y2: H * 0.29 };
  const station = { x: W * 0.42, y: rail.y1 + (rail.y2 - rail.y1) * 0.42 };

  return {
    W,
    H,
    nodes: finalNodes,
    edges,
    adj,
    riverY,
    riverWidth: RIVER_W,
    bridges: bridgeOut,
    parks,
    rail,
    station,
    districts,
    depot,
    rowNames: ROW_NAMES,
    n,
    exact,
    tt,
    prev,
  };
}

/** Node sequence of the shortest path from s to t, both included. */
export function shortestPath(town: Town, s: number, t: number): number[] {
  if (s === t) return [s];
  const out = [t];
  let cur = t;
  const base = s * town.n;
  while (cur !== s) {
    cur = town.prev[base + cur];
    if (cur < 0) return [];
    out.push(cur);
  }
  return out.reverse();
}

export function riverSideOf(town: Town, node: number): number {
  const p = town.nodes[node];
  return riverSide(p.x, p.y);
}

let cached: Town | null = null;
export function getTown(): Town {
  if (!cached) cached = buildTown();
  return cached;
}
