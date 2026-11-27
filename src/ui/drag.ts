import { store, set, moveJob, applyMove, problem, week, locate, type CellRef } from './store';
import { evalWeek, type Flag } from '../model/cost';

/**
 * Pointer-driven drag for job cards, one system for mouse, pen and touch.
 * Mouse: drag starts after a few pixels of movement.
 * Touch: press and hold to pick the card up; moving early scrolls the page as usual.
 */

interface Pending {
  id: string;
  x0: number;
  y0: number;
  pid: number;
  type: string;
  rect: DOMRect;
  timer: number;
}

let pending: Pending | null = null;
let active = false;
let lastX = 0;
let lastY = 0;
let suppressUntil = 0;
let raf = 0;
let tabTimer: { day: number; t: number } | null = null;

const HOLD_MS = 320;

export function clickSuppressed() {
  return performance.now() < suppressUntil;
}

export function isDragging() {
  return active;
}

export function cardPointerDown(e: PointerEvent, id: string) {
  const s = store.state;
  if (s.planning || s.attract || e.button !== 0) return;
  if ((e.target as HTMLElement).closest('button, input, a')) return;
  const el = e.currentTarget as HTMLElement;
  lastX = e.clientX;
  lastY = e.clientY;
  pending = {
    id,
    x0: e.clientX,
    y0: e.clientY,
    pid: e.pointerId,
    type: e.pointerType,
    rect: el.getBoundingClientRect(),
    timer: 0,
  };
  if (e.pointerType !== 'mouse') {
    pending.timer = window.setTimeout(() => begin(), HOLD_MS);
  }
  window.addEventListener('pointermove', onMove);
  window.addEventListener('pointerup', onUp);
  window.addEventListener('pointercancel', onCancel);
}

function cleanup() {
  if (pending) clearTimeout(pending.timer);
  pending = null;
  active = false;
  cancelAnimationFrame(raf);
  if (tabTimer) clearTimeout(tabTimer.t);
  tabTimer = null;
  window.removeEventListener('pointermove', onMove);
  window.removeEventListener('pointerup', onUp);
  window.removeEventListener('pointercancel', onCancel);
  document.documentElement.classList.remove('dragging');
}

function begin() {
  const p = pending;
  if (!p) return;
  active = true;
  document.documentElement.classList.add('dragging');
  const from = locate(store.state.plan, p.id);
  set({
    drag: {
      id: p.id,
      x: lastX,
      y: lastY,
      dx: p.x0 - p.rect.left,
      dy: p.y0 - p.rect.top,
      w: p.rect.width,
      target: from,
    },
    job: p.id,
    sheet: null,
  });
  update();
  autoScroll();
}

function onMove(e: PointerEvent) {
  if (!pending || e.pointerId !== pending.pid) return;
  lastX = e.clientX;
  lastY = e.clientY;
  if (!active) {
    const dist = Math.hypot(lastX - pending.x0, lastY - pending.y0);
    if (pending.type === 'mouse' && dist > 4) begin();
    else if (pending.type !== 'mouse' && dist > 8) cleanup();
    return;
  }
  update();
}

function onUp(e: PointerEvent) {
  if (!pending || e.pointerId !== pending.pid) return;
  if (active) {
    const d = store.state.drag;
    const id = pending.id;
    suppressUntil = performance.now() + 80;
    cleanup();
    set({ drag: null });
    if (d?.target) moveJob(id, d.target.cell, d.target.index);
  } else cleanup();
}

function onCancel(e: PointerEvent) {
  if (!pending || e.pointerId !== pending.pid) return;
  const wasActive = active;
  cleanup();
  if (wasActive) set({ drag: null });
}

/** Works out the drop cell and position under the pointer. */
export function targetAt(x: number, y: number, id: string): { cell: CellRef; index: number } | null {
  const el = document.elementFromPoint(x, y) as HTMLElement | null;
  const cellEl = el?.closest<HTMLElement>('[data-cell]');
  if (!cellEl) return null;
  const raw = cellEl.dataset.cell!;
  const cell: CellRef = raw === 'backlog' ? 'backlog' : Number(raw);
  const cards = Array.from(cellEl.querySelectorAll<HTMLElement>('[data-job]')).filter((c) => c.dataset.job !== id);
  const row = cellEl.dataset.flow === 'row';
  let index = cards.length;
  for (let i = 0; i < cards.length; i++) {
    const r = cards[i].getBoundingClientRect();
    const before = row ? y < r.top || (y <= r.bottom && x < r.left + r.width / 2) : y < r.top + r.height / 2;
    if (before) {
      index = i;
      break;
    }
  }
  return { cell, index };
}

function update() {
  const d = store.state.drag;
  if (!d) return;
  const el = document.elementFromPoint(lastX, lastY) as HTMLElement | null;
  const tab = el?.closest<HTMLElement>('[data-daytab]');
  if (tab) {
    const day = Number(tab.dataset.daytab);
    if (day !== store.state.day && tabTimer?.day !== day) {
      if (tabTimer) clearTimeout(tabTimer.t);
      tabTimer = {
        day,
        t: window.setTimeout(() => {
          set({ day });
          tabTimer = null;
        }, 420),
      };
    }
  } else if (tabTimer) {
    clearTimeout(tabTimer.t);
    tabTimer = null;
  }
  const target = targetAt(lastX, lastY, d.id);
  set({ drag: { ...d, x: lastX, y: lastY, target } });
}

function autoScroll() {
  cancelAnimationFrame(raf);
  const step = () => {
    if (!active) return;
    const edge = 72;
    const scroller = document.querySelector<HTMLElement>('[data-scroll]');
    const box = scroller && scroller.scrollHeight > scroller.clientHeight + 2 ? scroller.getBoundingClientRect() : null;
    const top = box ? box.top : 0;
    const bottom = box ? box.bottom : innerHeight;
    let v = 0;
    if (lastY < top + edge) v = -Math.ceil(((top + edge - lastY) / edge) * 14);
    else if (lastY > bottom - edge - 60) v = Math.ceil(((lastY - (bottom - edge - 60)) / edge) * 14);
    if (v) {
      if (box && scroller) scroller.scrollTop += v;
      else window.scrollBy(0, v);
      update();
    }
    raf = requestAnimationFrame(step);
  };
  raf = requestAnimationFrame(step);
}

// Stop the page from scrolling under a card that has been picked up by touch.
document.addEventListener(
  'touchmove',
  (e) => {
    if (active) e.preventDefault();
  },
  { passive: false },
);

export interface DropPreview {
  delta: number;
  flags: Flag[];
  over: number;
  same: boolean;
}

let previewKey = '';
let previewPlan: unknown = null;
let previewVal: DropPreview | null = null;

/** What the week would look like if the dragged card were dropped where it is now. */
export function dropPreview(): DropPreview | null {
  const d = store.state.drag;
  if (!d || !d.target) return null;
  const key = `${d.id}|${d.target.cell}|${d.target.index}`;
  const plan = store.state.plan;
  if (key === previewKey && plan === previewPlan && previewVal) return previewVal;
  previewPlan = plan;
  const next = applyMove(plan, d.id, d.target.cell, d.target.index);
  const before = week();
  const after = evalWeek(problem(), next);
  const same = JSON.stringify(next) === JSON.stringify(plan);
  const cell = d.target.cell;
  const over = cell === 'backlog' ? 0 : after.cells[cell].overtime - before.cells[cell].overtime;
  previewVal = {
    delta: after.totals.drive - before.totals.drive,
    flags: after.flagsById.get(d.id) ?? [],
    over,
    same,
  };
  previewKey = key;
  return previewVal;
}
