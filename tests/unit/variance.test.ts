import { expect, test } from 'vitest';
import { buildTown } from '../../src/model/town';
import { generateJobs, phoneOrderPlan } from '../../src/model/jobs';
import { buildProblem, evalWeek, fromIntPlan, isFeasible, routeStats, toIntPlan, type IntPlan } from '../../src/model/cost';
import { optimize, seedFor } from '../../src/model/optimizer';
import { mulberry32 } from '../../src/model/rng';

/**
 * The seeded week after one random manual move, as a visitor might leave it before pressing
 * Plan the week. Every result must be valid and land close to the others.
 */
test('plans of slightly different weeks land within a few percent of each other', () => {
  const town = buildTown();
  const jobs = generateJobs(town);
  const p = buildProblem(town, jobs);
  const base = toIntPlan(p, phoneOrderPlan(jobs));
  const drives: number[] = [];
  for (let s = 0; s < 4; s++) {
    const rng = mulberry32(100 + s);
    const ip: IntPlan = { routes: base.routes.map((r) => r.slice()), backlog: base.backlog.slice() };
    const r1 = Math.floor(rng() * 20);
    const r2 = Math.floor(rng() * 20);
    if (ip.routes[r1].length) ip.routes[r2].push(ip.routes[r1].splice(0, 1)[0]);
    const res = optimize(p, ip, { seed: seedFor(ip) });
    res.plan.routes.forEach((r, c) => expect(isFeasible(routeStats(p, c, r))).toBe(true));
    const t = evalWeek(p, fromIntPlan(p, res.plan)).totals;
    expect(t.unscheduled).toBe(0);
    expect(t.flags).toBe(0);
    drives.push(t.drive);
  }
  const lo = Math.min(...drives);
  const hi = Math.max(...drives);
  console.log('drive minutes after planning:', drives.join(', '));
  expect(hi / lo).toBeLessThan(1.08);
}, 60000);
