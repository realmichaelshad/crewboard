import { describe, expect, it } from 'vitest';
import { buildTown } from '../../src/model/town';
import { CREW_COUNT, DAY_COUNT, generateJobs, phoneOrderPlan, type Job } from '../../src/model/jobs';
import {
  buildProblem,
  evalWeek,
  fromIntPlan,
  isFeasible,
  planCost,
  routeStats,
  toIntPlan,
  type IntPlan,
  type Problem,
} from '../../src/model/cost';
import { construct, optimize, repair, seedFor } from '../../src/model/optimizer';
import { destinations } from '../../src/model/moves';
import { mulberry32, shuffle } from '../../src/model/rng';

const town = buildTown();
const jobs = generateJobs(town);
const p = buildProblem(town, jobs);
const CELLS = CREW_COUNT * DAY_COUNT;
const ITER = 60000;

function expectValid(prob: Problem, ip: IntPlan) {
  const all = [...ip.routes.flat(), ...ip.backlog];
  expect(all.length).toBe(prob.n);
  expect(new Set(all).size).toBe(prob.n);
  ip.routes.forEach((r, c) => expect(isFeasible(routeStats(prob, c, r))).toBe(true));
}

/** A scrambled week: jobs dealt at random into cells, some left in the backlog. */
function randomPlan(seed: number): IntPlan {
  const rng = mulberry32(seed);
  const order = shuffle(
    rng,
    Array.from({ length: p.n }, (_, k) => k),
  );
  const routes: number[][] = Array.from({ length: CELLS }, () => []);
  const backlog: number[] = [];
  for (const j of order) {
    if (rng() < 0.08) backlog.push(j);
    else routes[Math.floor(rng() * CELLS)].push(j);
  }
  return { routes, backlog };
}

describe('optimizer', () => {
  const input = toIntPlan(p, phoneOrderPlan(jobs));
  const res = optimize(p, input, { iterations: ITER, seed: seedFor(input) });

  it('never produces an invalid plan on the seeded week', () => {
    expectValid(p, res.plan);
  });

  it('places every job and clears every flag on the seeded week', () => {
    const t = evalWeek(p, fromIntPlan(p, res.plan)).totals;
    expect(t.unscheduled).toBe(0);
    expect(t.flags).toBe(0);
    expect(t.overtime).toBe(0);
  });

  it('cuts drive time by a large margin on the seeded week', () => {
    const before = evalWeek(p, fromIntPlan(p, input)).totals.drive;
    const after = evalWeek(p, fromIntPlan(p, res.plan)).totals.drive;
    expect(after).toBeLessThan(before * 0.7);
  });

  it('is deterministic for a given state', () => {
    const again = optimize(p, input, { iterations: ITER, seed: seedFor(input) });
    expect(again.plan).toEqual(res.plan);
    expect(again.cost).toBe(res.cost);
  });

  it('never returns a week that is worse than its input', () => {
    // Feeding its own result back in must not make it worse.
    const second = optimize(p, res.plan, { iterations: ITER, seed: seedFor(res.plan) });
    expect(second.cost).toBeLessThanOrEqual(res.cost);
    expectValid(p, second.plan);
    for (const seed of [1, 2, 3, 4, 5]) {
      const start = randomPlan(seed);
      const out = optimize(p, start, { iterations: 20000, seed });
      expect(out.cost).toBeLessThanOrEqual(planCost(p, start));
      expectValid(p, out.plan);
    }
  });

  it('streams only improving, valid plans', () => {
    const costs: number[] = [];
    optimize(p, input, {
      iterations: 30000,
      seed: 9,
      progressEvery: 500,
      onProgress: (plan, cost) => {
        expectValid(p, plan);
        expect(planCost(p, plan)).toBeCloseTo(cost, 6);
        costs.push(cost);
      },
    });
    expect(costs.length).toBeGreaterThan(2);
    for (let k = 1; k < costs.length; k++) expect(costs[k]).toBeLessThan(costs[k - 1]);
  });

  it('keeps a job it cannot place in the backlog instead of breaking a rule', () => {
    const impossible: Job = {
      id: 'Z1',
      type: 'irrigation',
      customer: 'Test Customer',
      address: '1 Test Street',
      district: 0,
      node: jobs[0].node,
      dur: 300,
      window: 'am',
      days: null,
    };
    const prob = buildProblem(town, [...jobs, impossible]);
    const start = toIntPlan(prob, { ...phoneOrderPlan(jobs), backlog: [...phoneOrderPlan(jobs).backlog, 'Z1'] });
    const out = optimize(prob, start, { iterations: 20000, seed: 3 });
    expectValid(prob, out.plan);
    expect(out.plan.backlog).toContain(prob.n - 1);
  });

  it('builds valid starting points', () => {
    expectValid(p, construct(p, CELLS));
    expectValid(p, repair(p, input));
    expectValid(p, repair(p, randomPlan(11)));
  });
});

describe('move destinations', () => {
  const plan = phoneOrderPlan(jobs);
  it('lists valid spots whose drive change matches the real change', () => {
    const before = evalWeek(p, plan).totals.drive;
    for (const id of ['J01', 'J17', 'J33', 'J58']) {
      const ds = destinations(p, plan, id);
      expect(ds.length).toBe(CELLS - (plan.backlog.includes(id) ? 0 : 1));
      for (const d of ds.filter((x) => x.valid).slice(0, 5)) {
        const routes = plan.routes.map((r) => r.filter((x) => x !== id));
        routes[d.cell].splice(d.index, 0, id);
        const next = { routes, backlog: plan.backlog.filter((x) => x !== id) };
        const w = evalWeek(p, next);
        expect(w.totals.drive - before).toBe(d.delta);
        expect(w.flagsById.get(id)).toBeUndefined();
      }
    }
  });
});
