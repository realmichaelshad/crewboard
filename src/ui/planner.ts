import { store, set, week, problem } from './store';
import { evalWeek } from '../model/cost';
import { DEFAULT_ITERATIONS } from '../model/optimizer';
import type { Plan } from '../model/jobs';
import type { PlanMessage } from '../worker';

/**
 * Runs the optimizer in a Web Worker and plays its improving plans back at a readable pace:
 * the construction first, then later improvements, so the board visibly reorganizes in steps
 * while the totals count down. Every plan shown is a real intermediate result.
 */

let worker: Worker | null = null;
let timer = 0;
let runId = 0;

const reduced = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

export interface PlanRunInfo {
  ms: number;
  iterations: number;
}

export let lastRun: PlanRunInfo | null = null;

export function cancelPlanning() {
  runId++;
  clearTimeout(timer);
  if (worker) {
    worker.terminate();
    worker = null;
  }
  if (store.state.planning) set({ planning: null });
}

export function planWeek(onFinish?: () => void) {
  const s = store.state;
  if (s.planning) return;
  const id = ++runId;
  const before = week().totals;
  const history = [...s.history, { jobs: s.jobs, plan: s.plan }].slice(-20);
  const snaps: Array<{ plan: Plan; iter: number }> = [];
  let done: Extract<PlanMessage, { type: 'done' }> | null = null;
  let shownIter = -1;
  let step = 0;
  const total = DEFAULT_ITERATIONS;
  const STEPS = 6;
  const GAP = reduced() ? 120 : 430;

  set({ planning: { progress: 0 }, history, result: null, sheet: null, drag: null, lastMove: null });
  if (!worker) worker = new Worker(new URL('../worker.ts', import.meta.url), { type: 'module' });
  worker.onmessage = (e: MessageEvent<PlanMessage>) => {
    if (id !== runId) return;
    if (e.data.type === 'progress') snaps.push({ plan: e.data.plan, iter: e.data.iter });
    else done = e.data;
  };
  worker.postMessage({ jobs: s.jobs, plan: s.plan });

  const finish = () => {
    const d = done!;
    const after = evalWeek(problem(), d.plan).totals;
    lastRun = { ms: d.ms, iterations: d.iterations };
    // Exposed for the performance check script.
    document.documentElement.dataset.planMs = d.ms.toFixed(0);
    set(
      {
        plan: d.plan,
        planning: null,
        result: { before, after, ms: d.ms, keptInput: d.keptInput },
      },
      { animate: true },
    );
    onFinish?.();
  };

  const tick = () => {
    if (id !== runId) return;
    step++;
    if (step >= STEPS && done) {
      finish();
      return;
    }
    // Early steps show early solutions; improvements come quickly at first, so the schedule is quadratic.
    const f = Math.min(1, (step - 1) / (STEPS - 1));
    const limit = total * f * f;
    let pick: { plan: Plan; iter: number } | undefined;
    for (const sn of snaps) if (sn.iter <= limit) pick = sn;
    if (!pick && snaps.length) pick = snaps[snaps.length - 1];
    if (pick && pick.iter !== shownIter) {
      shownIter = pick.iter;
      set({ plan: pick.plan, planning: { progress: Math.min(0.95, step / STEPS) } }, { animate: true });
    } else {
      set({ planning: { progress: Math.min(0.95, step / STEPS) } });
    }
    timer = window.setTimeout(tick, GAP);
  };
  timer = window.setTimeout(tick, 160);
}
