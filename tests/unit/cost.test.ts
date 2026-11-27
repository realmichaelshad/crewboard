import { describe, expect, it } from 'vitest';
import { buildTown } from '../../src/model/town';
import { cellIndex, generateJobs, phoneOrderPlan, type Job } from '../../src/model/jobs';
import { buildProblem, evalCell, evalWeek, isFeasible, planCost, routeStats, toIntPlan, W_UNSCHED } from '../../src/model/cost';

const town = buildTown();
const tt = (a: number, b: number) => town.tt[a * town.n + b];

function job(over: Partial<Job> & { id: string; node: number }): Job {
  return {
    type: 'mowing',
    customer: 'Test Customer',
    address: '1 Test Street',
    district: 0,
    dur: 60,
    window: null,
    days: null,
    ...over,
  };
}

// Three distinct non-depot nodes.
const nodes = [5, 40, 120].map((k) => (k === town.depot ? k + 1 : k));

describe('route cost', () => {
  const jobs = [
    job({ id: 'A', node: nodes[0], dur: 90 }),
    job({ id: 'B', node: nodes[1], dur: 60 }),
    job({ id: 'C', node: nodes[2], dur: 45 }),
  ];
  const p = buildProblem(town, jobs);

  it('adds up drive legs from the yard, between stops and back', () => {
    const s = routeStats(p, cellIndex(0, 0), [0, 1, 2]);
    const drive = tt(town.depot, nodes[0]) + tt(nodes[0], nodes[1]) + tt(nodes[1], nodes[2]) + tt(nodes[2], town.depot);
    expect(s.drive).toBe(drive);
    expect(s.work).toBe(195);
    expect(s.end).toBe(drive + 195);
    expect(s.viol).toBe(0);
    expect(s.overtime).toBe(0);
  });

  it('is zero for an empty day', () => {
    const s = routeStats(p, 0, []);
    expect(s).toEqual({ drive: 0, wait: 0, work: 0, end: 0, overtime: 0, viol: 0 });
  });

  it('agrees with the detailed evaluation the interface uses', () => {
    const cell = cellIndex(2, 3);
    const lean = routeStats(p, cell, [2, 0, 1]);
    const full = evalCell(p, cell, ['C', 'A', 'B']);
    expect(full.drive).toBe(lean.drive);
    expect(full.end).toBe(lean.end);
    expect(full.overtime).toBe(lean.overtime);
    expect(full.stops.map((s) => s.driveIn).reduce((a, b) => a + b, 0) + full.driveBack).toBe(lean.drive);
  });

  it('counts overtime past an 8 hour day', () => {
    const long = buildProblem(town, [job({ id: 'L', node: nodes[0], dur: 470 })]);
    const s = routeStats(long, 0, [0]);
    expect(s.overtime).toBe(s.end - 480);
    expect(s.overtime).toBeGreaterThan(0);
    expect(isFeasible(s)).toBe(false);
  });
});

describe('constraint checks', () => {
  it('flags a job that needs a skill the crew lacks, in plain words', () => {
    const p = buildProblem(town, [job({ id: 'I', node: nodes[0], type: 'irrigation' })]);
    // Marta (crew 0) has tree and stone skills; Owen (crew 1) does irrigation.
    expect(routeStats(p, cellIndex(0, 0), [0]).viol).toBe(1);
    expect(routeStats(p, cellIndex(1, 0), [0]).viol).toBe(0);
    expect(evalCell(p, cellIndex(0, 0), ['I']).stops[0].flags).toEqual([{ kind: 'skill', text: 'Needs an irrigation crew' }]);
  });

  it('flags a morning job that finishes after noon', () => {
    const p = buildProblem(town, [
      job({ id: 'X', node: nodes[0], dur: 200 }),
      job({ id: 'M', node: nodes[1], dur: 60, window: 'am' }),
    ]);
    expect(routeStats(p, 0, [1, 0]).viol).toBe(0);
    expect(routeStats(p, 0, [0, 1]).viol).toBe(1);
    const flag = evalCell(p, 0, ['X', 'M']).stops[1].flags[0];
    expect(flag.kind).toBe('window');
    expect(flag.text).toMatch(/^Mornings only, finishes \d\d:\d\d$/);
  });

  it('waits for an afternoon window instead of breaking it', () => {
    const p = buildProblem(town, [job({ id: 'P', node: nodes[0], dur: 60, window: 'pm' })]);
    const s = routeStats(p, 0, [0]);
    expect(s.viol).toBe(0);
    expect(s.wait).toBe(300 - tt(town.depot, nodes[0]));
    expect(s.end).toBe(300 + 60 + tt(nodes[0], town.depot));
  });

  it('flags a job booked on a day the customer cannot do', () => {
    const p = buildProblem(town, [job({ id: 'D', node: nodes[0], days: [3, 4] })]);
    expect(routeStats(p, cellIndex(0, 0), [0]).viol).toBe(1);
    expect(routeStats(p, cellIndex(0, 3), [0]).viol).toBe(0);
    expect(evalCell(p, cellIndex(0, 0), ['D']).stops[0].flags[0].text).toBe('Customer asked for Thursday or Friday');
  });
});

describe('the seeded week', () => {
  const jobs = generateJobs(town);
  const plan = phoneOrderPlan(jobs);
  const p = buildProblem(town, jobs);

  it('has 60 jobs, each placed once', () => {
    expect(jobs.length).toBe(60);
    const all = [...plan.routes.flat(), ...plan.backlog];
    expect(new Set(all).size).toBe(60);
  });

  it('starts badly planned on purpose', () => {
    const t = evalWeek(p, plan).totals;
    expect(t.overtime).toBeGreaterThan(0);
    expect(t.windowsMissed).toBeGreaterThan(0);
    expect(t.skillGaps).toBeGreaterThan(0);
    expect(t.unscheduled).toBe(3);
  });

  it('has week totals that are the sum of its cells', () => {
    const w = evalWeek(p, plan);
    expect(w.totals.drive).toBe(w.cells.reduce((a, c) => a + c.drive, 0));
    expect(w.totals.overtime).toBe(w.cells.reduce((a, c) => a + c.overtime, 0));
    expect(w.totals.flags).toBe(w.cells.reduce((a, c) => a + c.flagCount, 0));
    const ip = toIntPlan(p, plan);
    const lean = ip.routes.reduce((a, r, c) => a + routeStats(p, c, r).drive, 0);
    expect(lean).toBe(w.totals.drive);
    expect(planCost(p, ip)).toBeGreaterThan(W_UNSCHED * 3);
  });
});
