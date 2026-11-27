import { getTown } from '../model/town';
import {
  CREWS,
  DAYS,
  JOB_TYPES,
  addressFor,
  cellCrew,
  cellDay,
  clonePlan,
  generateJobs,
  makeCustomer,
  phoneOrderPlan,
  type Job,
  type JobType,
  type Plan,
  type TimeWindow,
} from '../model/jobs';
import { buildProblem, evalWeek, toIntPlan, routeStats, costOf, type Problem, type Totals, type WeekEval } from '../model/cost';
import { bestInsertion } from '../model/optimizer';
import { mulberry32 } from '../model/rng';
import { fmtDur } from '../model/format';
import { flip } from './flip';

export type Sheet = null | { kind: 'move'; job: string } | { kind: 'add' } | { kind: 'info' };
export type CellRef = number | 'backlog';

export interface DragState {
  id: string;
  x: number;
  y: number;
  dx: number;
  dy: number;
  w: number;
  target: { cell: CellRef; index: number } | null;
}

export interface PlanResult {
  before: Totals;
  after: Totals;
  ms: number;
  keptInput: boolean;
}

interface Snapshot {
  jobs: Job[];
  plan: Plan;
}

export interface State {
  jobs: Job[];
  plan: Plan;
  history: Snapshot[];
  checks: Record<string, boolean>;
  added: number;
  // interface only
  day: number;
  crew: number | null;
  job: string | null;
  view: 'board' | 'crew';
  mapOpen: boolean;
  sheet: Sheet;
  toast: { text: string; id: number } | null;
  result: PlanResult | null;
  planning: { progress: number } | null;
  drag: DragState | null;
  attract: boolean;
  lastMove: { id: string; delta: number } | null;
}

const KEY = 'crewboard:v1';
const town = getTown();

function freshWeek(): Snapshot {
  const jobs = generateJobs(town);
  return { jobs, plan: phoneOrderPlan(jobs) };
}

function storage(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

const params = new URLSearchParams(location.search);
export const ATTRACT = params.get('attract') === '1';

function load(): Partial<State> | null {
  if (ATTRACT) return null;
  try {
    const raw = storage()?.getItem(KEY);
    if (!raw) return null;
    const d = JSON.parse(raw);
    if (!Array.isArray(d.jobs) || !d.plan || !Array.isArray(d.plan.routes) || d.plan.routes.length !== 20) return null;
    const ids = new Set(d.jobs.map((j: Job) => j.id));
    const seen = new Set<string>();
    for (const r of [...d.plan.routes, d.plan.backlog])
      for (const id of r) {
        if (!ids.has(id) || seen.has(id)) return null;
        seen.add(id);
      }
    if (seen.size !== ids.size) return null;
    return {
      jobs: d.jobs,
      plan: d.plan,
      history: Array.isArray(d.history) ? d.history.slice(-20) : [],
      checks: d.checks ?? {},
      added: d.added ?? 0,
      day: typeof d.day === 'number' ? d.day : 0,
    };
  } catch {
    return null;
  }
}

const fresh = freshWeek();
const restored = load();

export const store = {
  state: {
    jobs: fresh.jobs,
    plan: fresh.plan,
    history: [],
    checks: {},
    added: 0,
    day: 0,
    crew: null,
    job: null,
    view: 'board',
    mapOpen: true,
    sheet: null,
    toast: null,
    result: null,
    planning: null,
    drag: null,
    attract: ATTRACT,
    lastMove: null,
    ...restored,
  } as State,
  listeners: new Set<() => void>(),
};

let saveTimer = 0;
function persist() {
  if (store.state.attract) return;
  clearTimeout(saveTimer);
  saveTimer = window.setTimeout(() => {
    const s = store.state;
    try {
      storage()?.setItem(
        KEY,
        JSON.stringify({
          jobs: s.jobs,
          plan: s.plan,
          history: s.history.slice(-20),
          checks: s.checks,
          added: s.added,
          day: s.day,
        }),
      );
    } catch {
      /* storage may be full or blocked; the app keeps working */
    }
  }, 150);
}

export function set(patch: Partial<State>, opts: { animate?: boolean } = {}) {
  if (opts.animate) flip.capture();
  store.state = { ...store.state, ...patch };
  if ('jobs' in patch || 'plan' in patch || 'checks' in patch || 'day' in patch) persist();
  store.listeners.forEach((l) => l());
}

export function subscribe(fn: () => void) {
  store.listeners.add(fn);
  return () => store.listeners.delete(fn);
}

// ---- Derived values, cached by identity ----

let probKey: Job[] | null = null;
let probVal: Problem;
export function problem(): Problem {
  const jobs = store.state.jobs;
  if (jobs !== probKey) {
    probVal = buildProblem(town, jobs);
    probKey = jobs;
  }
  return probVal;
}

let weekKey: Plan | null = null;
let weekProb: Problem | null = null;
let weekVal: WeekEval;
export function week(): WeekEval {
  const p = problem();
  const plan = store.state.plan;
  if (plan !== weekKey || p !== weekProb) {
    weekVal = evalWeek(p, plan);
    weekKey = plan;
    weekProb = p;
  }
  return weekVal;
}

export function jobById(id: string): Job | undefined {
  const k = problem().index.get(id);
  return k === undefined ? undefined : store.state.jobs[k];
}

export function locate(plan: Plan, id: string): { cell: CellRef; index: number } | null {
  for (let c = 0; c < plan.routes.length; c++) {
    const i = plan.routes[c].indexOf(id);
    if (i >= 0) return { cell: c, index: i };
  }
  const b = plan.backlog.indexOf(id);
  return b >= 0 ? { cell: 'backlog', index: b } : null;
}

// ---- Actions ----

let toastId = 0;
export function toast(text: string) {
  const id = ++toastId;
  set({ toast: { text, id } });
  window.setTimeout(() => {
    if (store.state.toast?.id === id) set({ toast: null });
  }, 4200);
}

function pushHistory(): Snapshot[] {
  const s = store.state;
  return [...s.history, { jobs: s.jobs, plan: s.plan }].slice(-20);
}

export function applyMove(plan: Plan, id: string, cell: CellRef, index: number): Plan {
  const next = clonePlan(plan);
  const from = locate(next, id);
  if (!from) return plan;
  const src = from.cell === 'backlog' ? next.backlog : next.routes[from.cell];
  src.splice(from.index, 1);
  const dst = cell === 'backlog' ? next.backlog : next.routes[cell];
  // index counts positions in the destination after the job has been taken out.
  dst.splice(Math.max(0, Math.min(index, dst.length)), 0, id);
  return next;
}

export function moveJob(id: string, cell: CellRef, index: number) {
  const s = store.state;
  const from = locate(s.plan, id);
  if (!from) return;
  const plan = applyMove(s.plan, id, cell, index);
  if (JSON.stringify(plan) === JSON.stringify(s.plan)) return;
  const before = week().totals.drive;
  const after = evalWeek(problem(), plan).totals.drive;
  const patch: Partial<State> = { plan, history: pushHistory(), result: null, lastMove: { id, delta: after - before }, job: id };
  if (cell !== 'backlog') {
    patch.day = cellDay(cell);
    if (s.crew !== null) patch.crew = cellCrew(cell);
  }
  set(patch, { animate: true });
}

export function undo() {
  const s = store.state;
  const last = s.history[s.history.length - 1];
  if (!last) return;
  set({ jobs: last.jobs, plan: last.plan, history: s.history.slice(0, -1), result: null, lastMove: null }, { animate: true });
}

export function resetDemo() {
  const w = freshWeek();
  set(
    {
      jobs: w.jobs,
      plan: w.plan,
      history: pushHistory(),
      checks: {},
      added: 0,
      result: null,
      job: null,
      crew: null,
      day: 0,
      sheet: null,
      lastMove: null,
    },
    { animate: true },
  );
}

/** Restores the original week without touching history; used by attract mode. */
export function loadFreshSilently() {
  const w = freshWeek();
  set(
    { jobs: w.jobs, plan: w.plan, history: [], result: null, job: null, crew: null, day: 0, lastMove: null },
    { animate: true },
  );
}

export function select(patch: { day?: number; crew?: number | null; job?: string | null }) {
  set(patch);
}

export function toggleCheck(id: string) {
  const checks = { ...store.state.checks, [id]: !store.state.checks[id] };
  set({ checks });
}

export interface NewJob {
  type: JobType;
  dur: number;
  district: number;
  customer: string;
  window: TimeWindow | null;
  days: number[] | null;
}

/** A free street corner in the district, chosen the same way every time. */
export function siteFor(district: number, nth: number): number {
  const used = new Set(store.state.jobs.map((j) => j.node));
  const free = town.nodes
    .map((n, k) => ({ n, k }))
    .filter(({ n, k }) => n.district === district && !used.has(k) && k !== town.depot)
    .map(({ k }) => k);
  if (!free.length) return town.nodes.findIndex((n, k) => n.district === district && k !== town.depot);
  const rng = mulberry32(9001 + nth * 31 + district);
  return free[Math.floor(rng() * free.length)];
}

export function suggestCustomer(): string {
  const rng = mulberry32(4242 + store.state.added * 17);
  return makeCustomer(rng, new Set(store.state.jobs.map((j) => j.customer)));
}

export function addJob(input: NewJob) {
  const s = store.state;
  const nth = s.added + 1;
  const node = siteFor(input.district, nth);
  const rng = mulberry32(777 + nth);
  const id = `N${String(nth).padStart(2, '0')}`;
  const job: Job = {
    id,
    type: input.type,
    customer: input.customer.trim() || suggestCustomer(),
    node,
    address: addressFor(town, node, rng),
    district: town.nodes[node].district,
    dur: input.dur,
    window: input.window,
    days: input.days && input.days.length < 5 ? input.days.slice().sort() : null,
    added: true,
  };
  set(
    {
      jobs: [...s.jobs, job],
      plan: { routes: s.plan.routes, backlog: [...s.plan.backlog, id] },
      history: pushHistory(),
      added: nth,
      sheet: null,
      job: id,
      result: null,
    },
    { animate: true },
  );
  toast(`${JOB_TYPES[job.type].label} for ${job.customer} is in the backlog. Use Fit it in to place it.`);
}

/** Places one job at the cheapest spot that keeps every rule and the 8 hour day. */
export function fitIn(id: string) {
  const s = store.state;
  const p = problem();
  const k = p.index.get(id);
  if (k === undefined) return;
  const plan = clonePlan(s.plan);
  const from = locate(plan, id);
  if (!from) return;
  if (from.cell === 'backlog') plan.backlog.splice(from.index, 1);
  else plan.routes[from.cell].splice(from.index, 1);
  const ip = toIntPlan(p, plan);
  const costs = ip.routes.map((r, c) => costOf(routeStats(p, c, r)));
  const ins = bestInsertion(p, ip.routes, costs, k);
  if (!ins) {
    toast('No crew has room for this job without breaking a rule or running past 8 hours.');
    return;
  }
  const beforeDrive = routeStats(p, ins.route, ip.routes[ins.route]).drive;
  plan.routes[ins.route].splice(ins.pos, 0, id);
  const afterDrive = routeStats(p, ins.route, toIntPlan(p, plan).routes[ins.route]).drive;
  const added = afterDrive - beforeDrive;
  const crew = CREWS[cellCrew(ins.route)];
  set(
    { plan, history: pushHistory(), day: cellDay(ins.route), job: id, result: null, lastMove: { id, delta: added } },
    { animate: true },
  );
  toast(`Placed with ${crew.lead} on ${DAYS[cellDay(ins.route)]}, stop ${ins.pos + 1}. Adds ${fmtDur(added)} of driving.`);
}

export function commitPlan(plan: Plan, history: boolean) {
  const patch: Partial<State> = { plan };
  if (history) patch.history = pushHistory();
  set(patch, { animate: true });
}
