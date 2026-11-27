import { DAY_MIN, cellCrew, cellDay, type Plan } from './jobs';
import { evalCell, type Flag, type Problem } from './cost';

export interface Destination {
  cell: number;
  crew: number;
  day: number;
  /** Position in the destination route, counted after the job is taken out of its current cell. */
  index: number;
  /** Change in the week's drive minutes if the job moves here. */
  delta: number;
  valid: boolean;
  flags: Flag[];
  /** Minutes the destination day would run past 8 hours, added by this move. */
  addedOver: number;
}

/**
 * Every cell the job could move to, at its cheapest position. A destination is valid when the job
 * keeps all of its rules there and the day does not run further past 8 hours than it already does.
 */
export function destinations(p: Problem, plan: Plan, id: string): Destination[] {
  let fromCell = -1;
  let srcDelta = 0;
  for (let c = 0; c < plan.routes.length; c++) {
    const i = plan.routes[c].indexOf(id);
    if (i >= 0) {
      fromCell = c;
      const without = plan.routes[c].filter((x) => x !== id);
      srcDelta = evalCell(p, c, without).drive - evalCell(p, c, plan.routes[c]).drive;
    }
  }
  const out: Destination[] = [];
  for (let c = 0; c < plan.routes.length; c++) {
    if (c === fromCell) continue;
    const route = plan.routes[c];
    const base = evalCell(p, c, route);
    const baseOver = base.overtime;
    let best: Destination | null = null;
    for (let pos = 0; pos <= route.length; pos++) {
      const next = route.slice(0, pos).concat(id, route.slice(pos));
      const ev = evalCell(p, c, next);
      const stop = ev.stops.find((s) => s.id === id)!;
      // Breaking another stop's window counts too.
      const otherFlags = ev.flagCount - stop.flags.length - base.flagCount;
      const addedOver = Math.max(0, ev.overtime - baseOver);
      const valid = stop.flags.length === 0 && otherFlags <= 0 && (addedOver === 0 || ev.end <= DAY_MIN);
      const delta = ev.drive - base.drive + srcDelta;
      const cand: Destination = {
        cell: c,
        crew: cellCrew(c),
        day: cellDay(c),
        index: pos,
        delta,
        valid,
        flags: stop.flags,
        addedOver,
      };
      if (
        !best ||
        (cand.valid && !best.valid) ||
        (cand.valid === best.valid &&
          (cand.addedOver < best.addedOver || (cand.addedOver === best.addedOver && cand.delta < best.delta)))
      )
        best = cand;
    }
    if (best) out.push(best);
  }
  return out.sort(
    (a, b) => Number(b.valid) - Number(a.valid) || a.addedOver - b.addedOver || a.delta - b.delta || a.cell - b.cell,
  );
}
