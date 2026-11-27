import {
  CREWS,
  CREW_COUNT,
  DAY_COUNT,
  DAY_MIN,
  DAYS,
  JOB_TYPES,
  SKILL_NEED,
  WINDOWS,
  cellCrew,
  cellDay,
  type Job,
  type Plan,
  type Skill,
} from './jobs';
import type { Town } from './town';
import { fmtClock, fmtDur } from './format';

export const SKILL_BIT: Record<Skill, number> = { tree: 1, irrigation: 2, stone: 4 };
const ALL_DAYS = (1 << DAY_COUNT) - 1;
const NO_END = 1 << 28;

/** Weights of the planning objective. Drive time is what we minimise; the rest are penalties. */
export const W_WAIT = 0.25;
export const W_OT = 30;
export const W_VIOL = 3000;
export const W_UNSCHED = 1500;

/** Compact numeric form of a week, shared by the interface and the optimizer worker. */
export interface Problem {
  jobs: Job[];
  index: Map<string, number>;
  n: number;
  node: Int32Array;
  dur: Int32Array;
  need: Int32Array;
  days: Int32Array;
  wStart: Int32Array;
  wEnd: Int32Array;
  crewSkill: Int32Array;
  depot: number;
  tt: Int32Array;
  nn: number;
}

export interface IntPlan {
  routes: number[][];
  backlog: number[];
}

export function buildProblem(town: Town, jobs: Job[]): Problem {
  const n = jobs.length;
  const p: Problem = {
    jobs,
    index: new Map(jobs.map((j, k) => [j.id, k])),
    n,
    node: new Int32Array(n),
    dur: new Int32Array(n),
    need: new Int32Array(n),
    days: new Int32Array(n),
    wStart: new Int32Array(n),
    wEnd: new Int32Array(n),
    crewSkill: new Int32Array(CREW_COUNT),
    depot: town.depot,
    tt: town.tt,
    nn: town.n,
  };
  jobs.forEach((j, k) => {
    p.node[k] = j.node;
    p.dur[k] = j.dur;
    const skill = JOB_TYPES[j.type].skill;
    p.need[k] = skill ? SKILL_BIT[skill] : 0;
    p.days[k] = j.days ? j.days.reduce((m, d) => m | (1 << d), 0) : ALL_DAYS;
    p.wStart[k] = j.window ? WINDOWS[j.window].start : 0;
    p.wEnd[k] = j.window ? WINDOWS[j.window].end : NO_END;
  });
  CREWS.forEach((c, k) => {
    p.crewSkill[k] = c.skills.reduce((m, s) => m | SKILL_BIT[s], 0);
  });
  return p;
}

export function toIntPlan(p: Problem, plan: Plan): IntPlan {
  const conv = (ids: string[]) => ids.map((id) => p.index.get(id)!).filter((k) => k !== undefined);
  return { routes: plan.routes.map(conv), backlog: conv(plan.backlog) };
}

export function fromIntPlan(p: Problem, ip: IntPlan): Plan {
  return {
    routes: ip.routes.map((r) => r.map((k) => p.jobs[k].id)),
    backlog: ip.backlog.map((k) => p.jobs[k].id),
  };
}

export interface RouteStats {
  drive: number;
  wait: number;
  work: number;
  end: number;
  overtime: number;
  viol: number;
}

/** Simulates one crew's day. Waiting for an afternoon window counts toward the day's length. */
export function routeStats(p: Problem, cell: number, route: readonly number[]): RouteStats {
  const crew = cellCrew(cell);
  const dayBit = 1 << cellDay(cell);
  const skills = p.crewSkill[crew];
  const nn = p.nn;
  let pos = p.depot;
  let t = 0;
  let drive = 0;
  let wait = 0;
  let work = 0;
  let viol = 0;
  for (let k = 0; k < route.length; k++) {
    const j = route[k];
    const leg = p.tt[pos * nn + p.node[j]];
    drive += leg;
    t += leg;
    if (t < p.wStart[j]) {
      wait += p.wStart[j] - t;
      t = p.wStart[j];
    }
    t += p.dur[j];
    work += p.dur[j];
    if (t > p.wEnd[j]) viol++;
    if ((p.need[j] & skills) !== p.need[j]) viol++;
    if ((p.days[j] & dayBit) === 0) viol++;
    pos = p.node[j];
  }
  if (route.length) {
    const back = p.tt[pos * nn + p.depot];
    drive += back;
    t += back;
  }
  return { drive, wait, work, end: t, overtime: Math.max(0, t - DAY_MIN), viol };
}

export function costOf(s: RouteStats): number {
  return s.drive + W_WAIT * s.wait + W_OT * s.overtime + W_VIOL * s.viol;
}

export function routeCost(p: Problem, cell: number, route: readonly number[]): number {
  return costOf(routeStats(p, cell, route));
}

export function isFeasible(s: RouteStats): boolean {
  return s.viol === 0 && s.end <= DAY_MIN;
}

export function planCost(p: Problem, ip: IntPlan): number {
  let c = W_UNSCHED * ip.backlog.length;
  for (let r = 0; r < ip.routes.length; r++) c += routeCost(p, r, ip.routes[r]);
  return c;
}

// ---- Detailed evaluation for the interface ----

export type FlagKind = 'skill' | 'window' | 'day';
export interface Flag {
  kind: FlagKind;
  text: string;
}

export interface StopInfo {
  id: string;
  driveIn: number;
  arrive: number;
  start: number;
  end: number;
  wait: number;
  flags: Flag[];
}

export interface CellInfo {
  stops: StopInfo[];
  drive: number;
  driveBack: number;
  work: number;
  wait: number;
  end: number;
  overtime: number;
  flagCount: number;
}

export function dayFlagText(days: number[]): string {
  if (days.length === 1) return `Customer asked for ${DAYS[days[0]]}`;
  if (days.length === DAY_COUNT - 1) {
    const missing = [0, 1, 2, 3, 4].find((d) => !days.includes(d))!;
    return `Customer can't do ${DAYS[missing]}`;
  }
  return `Customer asked for ${days.map((d) => DAYS[d]).join(' or ')}`;
}

export function evalCell(p: Problem, cell: number, ids: readonly string[]): CellInfo {
  const crew = CREWS[cellCrew(cell)];
  const day = cellDay(cell);
  const nn = p.nn;
  let pos = p.depot;
  let t = 0;
  let drive = 0;
  let wait = 0;
  let work = 0;
  let flagCount = 0;
  const stops: StopInfo[] = [];
  for (const id of ids) {
    const k = p.index.get(id);
    if (k === undefined) continue;
    const job = p.jobs[k];
    const leg = p.tt[pos * nn + p.node[k]];
    drive += leg;
    t += leg;
    const arrive = t;
    let w = 0;
    if (t < p.wStart[k]) {
      w = p.wStart[k] - t;
      t = p.wStart[k];
    }
    wait += w;
    const start = t;
    t += p.dur[k];
    work += p.dur[k];
    const flags: Flag[] = [];
    const skill = JOB_TYPES[job.type].skill;
    if (skill && !crew.skills.includes(skill)) flags.push({ kind: 'skill', text: SKILL_NEED[skill] });
    if (job.days && !job.days.includes(day)) flags.push({ kind: 'day', text: dayFlagText(job.days) });
    if (t > p.wEnd[k] && job.window) {
      flags.push({ kind: 'window', text: `${WINDOWS[job.window].label}, finishes ${fmtClock(t)}` });
    }
    flagCount += flags.length;
    stops.push({ id, driveIn: leg, arrive, start, end: t, wait: w, flags });
    pos = p.node[k];
  }
  let driveBack = 0;
  if (stops.length) {
    driveBack = p.tt[pos * nn + p.depot];
    drive += driveBack;
    t += driveBack;
  }
  return { stops, drive, driveBack, work, wait, end: t, overtime: Math.max(0, t - DAY_MIN), flagCount };
}

export interface Totals {
  drive: number;
  overtime: number;
  unscheduled: number;
  windowsMissed: number;
  skillGaps: number;
  flags: number;
  work: number;
  wait: number;
}

export interface WeekEval {
  cells: CellInfo[];
  totals: Totals;
  /** Flags per job id. */
  flagsById: Map<string, Flag[]>;
}

export function evalWeek(p: Problem, plan: Plan): WeekEval {
  const cells = plan.routes.map((ids, cell) => evalCell(p, cell, ids));
  const totals: Totals = {
    drive: 0,
    overtime: 0,
    unscheduled: plan.backlog.length,
    windowsMissed: 0,
    skillGaps: 0,
    flags: 0,
    work: 0,
    wait: 0,
  };
  const flagsById = new Map<string, Flag[]>();
  for (const c of cells) {
    totals.drive += c.drive;
    totals.overtime += c.overtime;
    totals.work += c.work;
    totals.wait += c.wait;
    for (const s of c.stops) {
      if (s.flags.length) flagsById.set(s.id, s.flags);
      for (const f of s.flags) {
        totals.flags++;
        if (f.kind === 'skill') totals.skillGaps++;
        else totals.windowsMissed++;
      }
    }
  }
  return { cells, totals, flagsById };
}

export function overText(overtime: number): string {
  return `Over 8 h by ${fmtDur(overtime)}`;
}
