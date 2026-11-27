import { expect, test } from 'vitest';
import { buildTown } from '../../src/model/town';
import { generateJobs, phoneOrderPlan } from '../../src/model/jobs';
import { buildProblem, evalWeek, fromIntPlan, toIntPlan } from '../../src/model/cost';
import { optimize, seedFor, DEFAULT_ITERATIONS } from '../../src/model/optimizer';
import { fmtDur, fmtOvertime } from '../../src/model/format';

/** Prints the real before and after numbers for the seeded week, with the production iteration budget. */
test('seeded week report', () => {
  const town = buildTown();
  const jobs = generateJobs(town);
  const plan = phoneOrderPlan(jobs);
  const p = buildProblem(town, jobs);
  const before = evalWeek(p, plan).totals;
  const ip = toIntPlan(p, plan);
  const res = optimize(p, ip, { seed: seedFor(ip) });
  const after = evalWeek(p, fromIntPlan(p, res.plan)).totals;
  console.log(
    [
      `Town: ${town.n} junctions, ${town.edges.length} street segments, ${town.bridges.length} bridges`,
      `Before: drive ${fmtDur(before.drive)}, overtime ${fmtOvertime(before.overtime)}, windows missed ${before.windowsMissed}, wrong crew ${before.skillGaps}, unscheduled ${before.unscheduled}`,
      `After:  drive ${fmtDur(after.drive)}, overtime ${fmtOvertime(after.overtime)}, windows missed ${after.windowsMissed}, wrong crew ${after.skillGaps}, unscheduled ${after.unscheduled}`,
      `Optimizer: ${DEFAULT_ITERATIONS} iterations in ${res.ms.toFixed(0)} ms (Node, no throttling)`,
    ].join('\n'),
  );
  expect(after.drive).toBeLessThan(before.drive);
});
