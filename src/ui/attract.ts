import { store, set, loadFreshSilently, moveJob, applyMove, week, problem } from './store';
import { evalWeek } from '../model/cost';
import { planWeek, cancelPlanning } from './planner';
import { targetAt } from './drag';

/**
 * Attract mode: the bad week, one manual drag that makes a number worse, then Plan the week
 * reorganizes the board while the totals count down and the map redraws. Hold, reset, repeat.
 * Any real input hands control to the visitor.
 */

let timers: number[] = [];
let raf = 0;
let loop = 0;
let stopped = false;

const wait = (ms: number) =>
  new Promise<void>((resolve) => {
    timers.push(window.setTimeout(resolve, ms));
  });

const ease = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);

/** Top and bottom of the area not covered by pinned bars. */
function clearArea() {
  const top = document.querySelector('.p-top')?.getBoundingClientRect().bottom ?? 60;
  const bar = document.querySelector('.p-bar')?.getBoundingClientRect().top ?? innerHeight - 40;
  return { top: top + 6, bottom: bar - 8 };
}

function visible(r: DOMRect) {
  const a = clearArea();
  return r.top >= a.top && r.bottom <= a.bottom && r.left >= 0 && r.right <= innerWidth;
}

/** Picks one move between spots on screen that adds a moderate amount of driving. */
function chooseDrag(): { id: string; from: DOMRect; to: { x: number; y: number } } | null {
  const plan = store.state.plan;
  const base = week().totals;
  const p = problem();
  let best: { id: string; from: DOMRect; to: { x: number; y: number }; score: number } | null = null;
  const cells = Array.from(document.querySelectorAll<HTMLElement>('[data-cell]')).filter((el) => el.dataset.cell !== 'backlog');
  for (const src of cells) {
    for (const card of Array.from(src.querySelectorAll<HTMLElement>('[data-job]'))) {
      const fr = card.getBoundingClientRect();
      if (!visible(fr)) continue;
      const id = card.dataset.job!;
      for (const dst of cells) {
        const cell = Number(dst.dataset.cell);
        const others = Array.from(dst.querySelectorAll<HTMLElement>('[data-job]')).filter((c) => c.dataset.job !== id);
        for (let index = 0; index <= others.length; index++) {
          const r = others[Math.min(index, others.length - 1)]?.getBoundingClientRect();
          const head = dst.getBoundingClientRect();
          const y = !r ? head.top + 44 : index < others.length ? r.top + 6 : r.bottom + 10;
          const x = r ? r.left + r.width / 2 : head.left + head.width / 2;
          const area = clearArea();
          if (y > area.bottom - 30 || y < area.top + 10) continue;
          const t = targetAt(x, y, id);
          if (!t || t.cell !== cell || t.index !== index) continue;
          const next = applyMove(plan, id, cell, index);
          if (JSON.stringify(next) === JSON.stringify(plan)) continue;
          const after = evalWeek(p, next).totals;
          const delta = after.drive - base.drive;
          const newFlags = after.flags - base.flags;
          // The manual move has to make a number visibly worse. Best: more driving. Then: a small
          // increase. Last resort (a small phone shows few spots): a new broken rule.
          const tier = delta >= 4 ? 0 : delta >= 1 ? 1 : newFlags > 0 ? 2 : -1;
          if (tier < 0) continue;
          const dist = Math.hypot(x - fr.left, y - fr.top);
          const score =
            tier * 1000 +
            Math.abs(delta - 14) +
            (dst === src ? 8 : 0) +
            (dist > 460 ? 20 : 0) +
            (dist < 90 ? 12 : 0) -
            (newFlags > 0 ? 3 : 0);
          if (!best || score < best.score) best = { id, from: fr, to: { x, y }, score };
        }
      }
    }
  }
  return best;
}

function animateDrag(id: string, from: DOMRect, to: { x: number; y: number }, ms: number): Promise<void> {
  return new Promise((resolve) => {
    const sx = from.left + from.width * 0.4;
    const sy = from.top + from.height * 0.5;
    const t0 = performance.now();
    const base = { id, dx: sx - from.left, dy: sy - from.top, w: from.width };
    set({ drag: { ...base, x: sx, y: sy, target: null }, job: id });
    const step = (now: number) => {
      if (stopped) return resolve();
      const k = Math.min(1, (now - t0) / ms);
      const e = ease(k);
      const x = sx + (to.x - sx) * e;
      const y = sy + (to.y - sy) * e - Math.sin(Math.PI * k) * 18;
      set({ drag: { ...base, x, y, target: targetAt(x, y, id) } });
      if (k < 1) raf = requestAnimationFrame(step);
      else resolve();
    };
    raf = requestAnimationFrame(step);
  });
}

async function runOnce() {
  const n = ++loop;
  document.documentElement.dataset.attractLoop = String(n);
  document.documentElement.dataset.attractStart = String(performance.timeOrigin + performance.now());
  const phone = !window.matchMedia('(min-width: 1100px) and (min-height: 560px)').matches;
  loadFreshSilently();
  set({ day: 0, crew: null, job: null, mapOpen: !phone, sheet: null });
  window.scrollTo(0, 0);
  await wait(phone ? 700 : 1100);
  if (stopped) return;
  if (phone) {
    // Bring the second crew's lane into view so the card can travel between two crews.
    const lane = document.querySelectorAll<HTMLElement>('.lane')[1];
    if (lane) window.scrollTo({ top: window.scrollY + lane.getBoundingClientRect().top - innerHeight * 0.5, behavior: 'smooth' });
    await wait(650);
    if (stopped) return;
  }
  const pick = chooseDrag();
  document.documentElement.dataset.attractPick = pick ? pick.id : 'none';
  if (pick) {
    await animateDrag(pick.id, pick.from, pick.to, 1250);
    if (stopped) return;
    const t = store.state.drag?.target;
    set({ drag: null });
    if (t) moveJob(pick.id, t.cell, t.index);
    set({ job: null });
  }
  await wait(1300);
  if (stopped) return;
  const btn = document.querySelector<HTMLElement>('[data-plan]');
  btn?.classList.add('pressed');
  await wait(180);
  btn?.classList.remove('pressed');
  await new Promise<void>((resolve) => planWeek(resolve));
  if (stopped) return;
  if (phone) {
    // On a phone the map opens once the board has settled, and draws the new routes.
    await wait(600);
    window.scrollTo({ top: 0, behavior: 'smooth' });
    set({ mapOpen: true });
    await wait(3600);
  } else await wait(4300);
  if (stopped) return;
  loadFreshSilently();
  set({ mapOpen: !phone });
  window.scrollTo(0, 0);
  await wait(700);
}

export async function startAttract() {
  stopped = false;
  const exit = (e: Event) => {
    if (!e.isTrusted) return;
    stopAttract();
  };
  for (const ev of ['pointerdown', 'keydown', 'wheel', 'touchstart'])
    window.addEventListener(ev, exit, { once: true, capture: true });
  while (!stopped) {
    await runOnce();
  }
}

export function stopAttract() {
  if (stopped) return;
  stopped = true;
  timers.forEach(clearTimeout);
  timers = [];
  cancelAnimationFrame(raf);
  cancelPlanning();
  set({ drag: null, attract: false });
  loadFreshSilently();
  set({ history: [] });
  try {
    const url = new URL(location.href);
    url.searchParams.delete('attract');
    history.replaceState(null, '', url.toString());
  } catch {
    /* ignore */
  }
}
