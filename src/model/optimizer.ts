import { mulberry32 } from './rng';
import { W_UNSCHED, costOf, isFeasible, planCost, routeStats, type IntPlan, type Problem } from './cost';

/**
 * Week optimizer.
 * 1. Two starting points: cheapest insertion from an empty week, and the current week repaired
 *    (jobs that break a rule or push a day past 8 hours are lifted out and re-inserted).
 * 2. Simulated annealing over relocate, swap, 2-opt and or-opt moves, within and between cells.
 *    Only plans that keep every rule are ever accepted, so the result is always valid.
 * Determinism: the move sequence comes from a seeded generator and the budget is an iteration
 * count, so the same week always gives the same plan.
 */

export interface OptimizeOptions {
  iterations?: number;
  seed?: number;
  /** Called with each improving plan, at most once per `progressEvery` iterations. */
  onProgress?: (plan: IntPlan, cost: number, iteration: number) => void;
  progressEvery?: number;
  /** Annealing temperature at the start and end of each round, and the number of rounds. */
  t0?: number;
  t1?: number;
  rounds?: number;
}

export interface OptimizeResult {
  plan: IntPlan;
  cost: number;
  inputCost: number;
  iterations: number;
  ms: number;
  keptInput: boolean;
}

export const DEFAULT_ITERATIONS = 300000;

function clone(ip: IntPlan): IntPlan {
  return { routes: ip.routes.map((r) => r.slice()), backlog: ip.backlog.slice() };
}

interface Insert {
  route: number;
  pos: number;
  delta: number;
}

/** Cheapest position to insert job j into a single route, keeping the route valid. */
function bestPosInRoute(
  p: Problem,
  cell: number,
  route: number[],
  baseCost: number,
  j: number,
): { pos: number; delta: number } | null {
  let best: { pos: number; delta: number } | null = null;
  const tmp = route.slice();
  tmp.splice(0, 0, j);
  for (let pos = 0; pos <= route.length; pos++) {
    if (pos > 0) {
      tmp[pos - 1] = route[pos - 1];
      tmp[pos] = j;
    }
    const s = routeStats(p, cell, tmp);
    if (!isFeasible(s)) continue;
    const delta = costOf(s) - baseCost;
    if (!best || delta < best.delta) best = { pos, delta };
  }
  return best;
}

export function bestInsertion(p: Problem, routes: number[][], costs: number[], j: number): Insert | null {
  let best: Insert | null = null;
  for (let r = 0; r < routes.length; r++) {
    const b = bestPosInRoute(p, r, routes[r], costs[r], j);
    if (b && (!best || b.delta < best.delta)) best = { route: r, pos: b.pos, delta: b.delta };
  }
  return best;
}

function popcount(x: number) {
  let c = 0;
  while (x) {
    c += x & 1;
    x >>= 1;
  }
  return c;
}

/** Hardest jobs first: skills, few allowed days, time windows, long jobs. */
function difficultyOrder(p: Problem, list: number[]): number[] {
  const score = (j: number) =>
    (p.need[j] ? 3 : 0) + (5 - popcount(p.days[j])) * 2 + (p.wEnd[j] < 100000 || p.wStart[j] > 0 ? 2 : 0) + p.dur[j] / 90;
  return list.slice().sort((a, b) => score(b) - score(a) || a - b);
}

function insertAll(p: Problem, routes: number[][], pending: number[]): number[] {
  const costs = routes.map((r, k) => costOf(routeStats(p, k, r)));
  const left: number[] = [];
  for (const j of difficultyOrder(p, pending)) {
    const ins = bestInsertion(p, routes, costs, j);
    if (!ins) {
      left.push(j);
      continue;
    }
    routes[ins.route].splice(ins.pos, 0, j);
    costs[ins.route] += ins.delta;
  }
  return left;
}

export function construct(p: Problem, cells: number): IntPlan {
  const routes: number[][] = Array.from({ length: cells }, () => []);
  const all = Array.from({ length: p.n }, (_, k) => k);
  const backlog = insertAll(p, routes, all);
  return { routes, backlog };
}

/** Lift out whatever breaks a rule or runs past 8 hours, then insert it again where it fits. */
export function repair(p: Problem, input: IntPlan): IntPlan {
  const routes = input.routes.map((r) => r.slice());
  const pending = input.backlog.slice();
  for (let r = 0; r < routes.length; r++) {
    let s = routeStats(p, r, routes[r]);
    while (!isFeasible(s) && routes[r].length) {
      let bestK = 0;
      let bestCost = Infinity;
      for (let k = 0; k < routes[r].length; k++) {
        const t = routes[r].slice();
        t.splice(k, 1);
        const c = costOf(routeStats(p, r, t));
        if (c < bestCost) {
          bestCost = c;
          bestK = k;
        }
      }
      pending.push(routes[r][bestK]);
      routes[r].splice(bestK, 1);
      s = routeStats(p, r, routes[r]);
    }
  }
  const backlog = insertAll(p, routes, pending);
  return { routes, backlog };
}

export function optimize(p: Problem, input: IntPlan, opts: OptimizeOptions = {}): OptimizeResult {
  const t0 = typeof performance !== 'undefined' ? performance.now() : Date.now();
  const N = opts.iterations ?? DEFAULT_ITERATIONS;
  const every = opts.progressEvery ?? 2000;
  const rng = mulberry32(opts.seed ?? 1);
  const cells = input.routes.length;
  const inputCost = planCost(p, input);

  const a = construct(p, cells);
  const b = repair(p, input);
  const start = planCost(p, a) <= planCost(p, b) ? a : b;

  let routes = start.routes.map((r) => r.slice());
  let backlog = start.backlog.slice();
  let costs = routes.map((r, k) => costOf(routeStats(p, k, r)));
  let total = costs.reduce((x, y) => x + y, 0) + W_UNSCHED * backlog.length;
  let best: IntPlan = clone({ routes, backlog });
  let bestCost = total;
  let lastEmit = 0;
  let pendingEmit = false;
  opts.onProgress?.(clone(best), bestCost, 0);

  // Each round cools from T0 to T1, then the next round reheats from the best plan so far.
  const T0 = opts.t0 ?? 6;
  const T1 = opts.t1 ?? 0.02;
  const rounds = Math.max(1, opts.rounds ?? 1);
  const roundLen = Math.ceil(N / rounds);
  const decay = Math.log(T1 / T0);

  const tryRoute = (cell: number, r: number[]): number | null => {
    const s = routeStats(p, cell, r);
    return isFeasible(s) ? costOf(s) : null;
  };
  const randomFilled = (): number => {
    for (let k = 0; k < 40; k++) {
      const r = Math.floor(rng() * cells);
      if (routes[r].length) return r;
    }
    for (let r = 0; r < cells; r++) if (routes[r].length) return r;
    return -1;
  };

  for (let it = 1; it <= N; it++) {
    const phase = (it - 1) % roundLen;
    if (phase === 0 && it > 1) {
      routes = best.routes.map((r) => r.slice());
      backlog = best.backlog.slice();
      costs = routes.map((r, k) => costOf(routeStats(p, k, r)));
      total = bestCost;
    }
    const T = T0 * Math.exp((decay * phase) / roundLen);
    const accept = (delta: number) => delta <= 0 || rng() < Math.exp(-delta / T);
    const m = rng();

    if (backlog.length && m < 0.06) {
      // Place a waiting job wherever it fits best.
      const bi = Math.floor(rng() * backlog.length);
      const ins = bestInsertion(p, routes, costs, backlog[bi]);
      if (ins) {
        routes[ins.route].splice(ins.pos, 0, backlog[bi]);
        costs[ins.route] += ins.delta;
        total += ins.delta - W_UNSCHED;
        backlog.splice(bi, 1);
      } else if (rng() < 0.5) {
        // Make room: swap the waiting job with a scheduled one at the same spot.
        const r = randomFilled();
        if (r >= 0) {
          const i = Math.floor(rng() * routes[r].length);
          const nr = routes[r].slice();
          const out = nr[i];
          nr[i] = backlog[bi];
          const c = tryRoute(r, nr);
          if (c !== null && accept(c - costs[r])) {
            total += c - costs[r];
            routes[r] = nr;
            costs[r] = c;
            backlog[bi] = out;
          }
        }
      }
    } else if (m < 0.42) {
      // Relocate one job to the best spot in a random cell.
      const r1 = randomFilled();
      if (r1 < 0) continue;
      const i = Math.floor(rng() * routes[r1].length);
      const j = routes[r1][i];
      const r2 = Math.floor(rng() * cells);
      const from = routes[r1].slice();
      from.splice(i, 1);
      const cFrom = tryRoute(r1, from);
      if (cFrom === null) continue;
      if (r2 === r1) {
        const ins = bestPosInRoute(p, r1, from, cFrom, j);
        if (!ins) continue;
        const delta = cFrom + ins.delta - costs[r1];
        if (accept(delta)) {
          from.splice(ins.pos, 0, j);
          routes[r1] = from;
          costs[r1] = cFrom + ins.delta;
          total += delta;
        }
      } else {
        const ins = bestPosInRoute(p, r2, routes[r2], costs[r2], j);
        if (!ins) continue;
        const delta = cFrom - costs[r1] + ins.delta;
        if (accept(delta)) {
          routes[r1] = from;
          costs[r1] = cFrom;
          const to = routes[r2].slice();
          to.splice(ins.pos, 0, j);
          routes[r2] = to;
          costs[r2] += ins.delta;
          total += delta;
        }
      }
    } else if (m < 0.64) {
      // Swap two jobs, in the same cell or in two cells.
      const r1 = randomFilled();
      const r2 = randomFilled();
      if (r1 < 0 || r2 < 0) continue;
      const i = Math.floor(rng() * routes[r1].length);
      const k = Math.floor(rng() * routes[r2].length);
      if (r1 === r2) {
        if (i === k) continue;
        const nr = routes[r1].slice();
        [nr[i], nr[k]] = [nr[k], nr[i]];
        const c = tryRoute(r1, nr);
        if (c === null) continue;
        const delta = c - costs[r1];
        if (accept(delta)) {
          routes[r1] = nr;
          costs[r1] = c;
          total += delta;
        }
      } else {
        const n1 = routes[r1].slice();
        const n2 = routes[r2].slice();
        const tmp = n1[i];
        n1[i] = n2[k];
        n2[k] = tmp;
        const c1 = tryRoute(r1, n1);
        if (c1 === null) continue;
        const c2 = tryRoute(r2, n2);
        if (c2 === null) continue;
        const delta = c1 + c2 - costs[r1] - costs[r2];
        if (accept(delta)) {
          routes[r1] = n1;
          routes[r2] = n2;
          costs[r1] = c1;
          costs[r2] = c2;
          total += delta;
        }
      }
    } else if (m < 0.8) {
      // 2-opt: reverse a stretch of one route.
      const r = randomFilled();
      if (r < 0 || routes[r].length < 2) continue;
      const len = routes[r].length;
      let i = Math.floor(rng() * len);
      let k = Math.floor(rng() * len);
      if (i === k) continue;
      if (i > k) [i, k] = [k, i];
      const nr = routes[r].slice(0, i).concat(routes[r].slice(i, k + 1).reverse(), routes[r].slice(k + 1));
      const c = tryRoute(r, nr);
      if (c === null) continue;
      const delta = c - costs[r];
      if (accept(delta)) {
        routes[r] = nr;
        costs[r] = c;
        total += delta;
      }
    } else {
      // Or-opt: move a run of two or three consecutive stops, forwards or reversed.
      const r1 = randomFilled();
      if (r1 < 0 || routes[r1].length < 2) continue;
      const L = Math.min(routes[r1].length, rng() < 0.6 ? 2 : 3);
      const i = Math.floor(rng() * (routes[r1].length - L + 1));
      const seg = routes[r1].slice(i, i + L);
      if (rng() < 0.5) seg.reverse();
      const from = routes[r1].slice(0, i).concat(routes[r1].slice(i + L));
      const r2 = Math.floor(rng() * cells);
      const target = r2 === r1 ? from : routes[r2];
      let bestPos = -1;
      let bestC = Infinity;
      for (let pos = 0; pos <= target.length; pos++) {
        const nr = target.slice(0, pos).concat(seg, target.slice(pos));
        const c = tryRoute(r2, nr);
        if (c !== null && c < bestC) {
          bestC = c;
          bestPos = pos;
        }
      }
      if (bestPos < 0) continue;
      if (r2 === r1) {
        const delta = bestC - costs[r1];
        if (accept(delta)) {
          routes[r1] = from.slice(0, bestPos).concat(seg, from.slice(bestPos));
          costs[r1] = bestC;
          total += delta;
        }
      } else {
        const cFrom = tryRoute(r1, from);
        if (cFrom === null) continue;
        const delta = cFrom + bestC - costs[r1] - costs[r2];
        if (accept(delta)) {
          routes[r1] = from;
          routes[r2] = target.slice(0, bestPos).concat(seg, target.slice(bestPos));
          costs[r1] = cFrom;
          costs[r2] = bestC;
          total += delta;
        }
      }
    }

    if (total < bestCost - 1e-9) {
      bestCost = total;
      best = clone({ routes, backlog });
      pendingEmit = true;
    }
    if (pendingEmit && it - lastEmit >= every) {
      opts.onProgress?.(clone(best), bestCost, it);
      lastEmit = it;
      pendingEmit = false;
    }
  }

  // Recompute from scratch so drift in the running total can never matter.
  bestCost = planCost(p, best);
  let keptInput = false;
  if (inputCost <= bestCost) {
    best = clone(input);
    bestCost = inputCost;
    keptInput = true;
  }
  const t1 = typeof performance !== 'undefined' ? performance.now() : Date.now();
  return { plan: best, cost: bestCost, inputCost, iterations: N, ms: t1 - t0, keptInput };
}

/** Seed for the optimizer derived from the week itself, so a given state always gives the same plan. */
export function seedFor(ip: IntPlan): number {
  let h = 0x811c9dc5;
  const mix = (v: number) => {
    h ^= v + 1;
    h = Math.imul(h, 0x01000193);
  };
  ip.routes.forEach((r) => {
    r.forEach(mix);
    mix(-2);
  });
  ip.backlog.forEach(mix);
  return h >>> 0;
}
