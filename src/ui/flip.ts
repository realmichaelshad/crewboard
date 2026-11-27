/**
 * FLIP for job cards: record where every card is, let the board re-render (cards may land in a
 * different cell, so they are new DOM nodes), then animate each card from its old spot to the new one.
 */
const reduced = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

let snapshot: Map<string, DOMRect> | null = null;
let duration = 220;

export const flip = {
  capture(ms = 220) {
    duration = ms;
    if (reduced()) return;
    snapshot = new Map();
    document.querySelectorAll<HTMLElement>('[data-job]').forEach((el) => {
      if (el.offsetParent !== null) snapshot!.set(el.dataset.job!, el.getBoundingClientRect());
    });
  },
  play() {
    const prev = snapshot;
    snapshot = null;
    if (!prev) return;
    document.querySelectorAll<HTMLElement>('[data-job]').forEach((el) => {
      const before = prev.get(el.dataset.job!);
      if (!before || el.offsetParent === null) return;
      const now = el.getBoundingClientRect();
      const dx = before.left - now.left;
      const dy = before.top - now.top;
      if (Math.abs(dx) < 1 && Math.abs(dy) < 1) return;
      // Cards far off screen in both places do not need to move.
      if ((now.bottom < 0 || now.top > innerHeight) && (before.bottom < 0 || before.top > innerHeight)) return;
      el.animate([{ transform: `translate(${dx}px, ${dy}px)` }, { transform: 'translate(0, 0)' }], {
        duration,
        easing: 'cubic-bezier(.2,.7,.2,1)',
      });
    });
  },
};
