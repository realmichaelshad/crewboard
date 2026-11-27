/// <reference lib="webworker" />
import { getTown } from './model/town';
import { buildProblem, fromIntPlan, toIntPlan } from './model/cost';
import { optimize, seedFor, DEFAULT_ITERATIONS } from './model/optimizer';
import type { Job, Plan } from './model/jobs';

export interface PlanRequest {
  jobs: Job[];
  plan: Plan;
  iterations?: number;
}

export type PlanMessage =
  | { type: 'progress'; plan: Plan; cost: number; iter: number; total: number }
  | { type: 'done'; plan: Plan; cost: number; inputCost: number; ms: number; iterations: number; keptInput: boolean };

const ctx = self as unknown as DedicatedWorkerGlobalScope;

ctx.onmessage = (e: MessageEvent<PlanRequest>) => {
  const town = getTown();
  const p = buildProblem(town, e.data.jobs);
  const ip = toIntPlan(p, e.data.plan);
  const total = e.data.iterations ?? DEFAULT_ITERATIONS;
  const res = optimize(p, ip, {
    iterations: total,
    seed: seedFor(ip),
    progressEvery: 3000,
    onProgress: (best, cost, iter) => {
      ctx.postMessage({ type: 'progress', plan: fromIntPlan(p, best), cost, iter, total } satisfies PlanMessage);
    },
  });
  ctx.postMessage({
    type: 'done',
    plan: fromIntPlan(p, res.plan),
    cost: res.cost,
    inputCost: res.inputCost,
    ms: res.ms,
    iterations: res.iterations,
    keptInput: res.keptInput,
  } satisfies PlanMessage);
};
