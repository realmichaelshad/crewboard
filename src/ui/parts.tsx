import { useEffect, useRef, useState } from 'preact/hooks';
import type { Shape } from '../model/jobs';

const reduced = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

/** Rolls a displayed number toward its target. */
export function useTween(target: number, ms = 420): number {
  const [v, setV] = useState(target);
  const r = useRef({ from: target, to: target, cur: target, t0: 0, raf: 0 });
  useEffect(() => {
    const s = r.current;
    if (target === s.to) return;
    cancelAnimationFrame(s.raf);
    if (reduced()) {
      s.cur = s.to = target;
      setV(target);
      return;
    }
    s.from = s.cur;
    s.to = target;
    s.t0 = performance.now();
    const step = (now: number) => {
      const k = Math.min(1, (now - s.t0) / ms);
      const e = 1 - (1 - k) ** 3;
      s.cur = s.from + (s.to - s.from) * e;
      setV(s.cur);
      if (k < 1) s.raf = requestAnimationFrame(step);
    };
    s.raf = requestAnimationFrame(step);
  }, [target]);
  useEffect(() => () => cancelAnimationFrame(r.current.raf), []);
  return v;
}

const pad2 = (n: number) => String(n).padStart(2, '0');

/** A duration with figures in the mono face and units in the text face. */
export function Dur({ min, compact = false, zero }: { min: number; compact?: boolean; zero?: string }) {
  const m = Math.max(0, Math.round(min));
  if (m === 0 && zero !== undefined)
    return (
      <span class="dur">
        <b class="n">{zero}</b>
      </span>
    );
  if (m < 60)
    return (
      <span class="dur">
        <b class="n">{m}</b>
        <i>{compact ? 'm' : 'min'}</i>
      </span>
    );
  const h = Math.floor(m / 60);
  const rest = m % 60;
  return (
    <span class="dur">
      <b class="n">{h}</b>
      <i>h</i>
      {rest > 0 && (
        <>
          <b class="n">{pad2(rest)}</b>
          {!compact && <i>min</i>}
        </>
      )}
    </span>
  );
}

export function TDur(props: { min: number; compact?: boolean; zero?: string; ms?: number }) {
  const v = useTween(props.min, props.ms);
  return <Dur min={v} compact={props.compact} zero={props.zero} />;
}

export function TNum({ value, ms }: { value: number; ms?: number }) {
  const v = useTween(value, ms);
  return <b class="n">{Math.round(v)}</b>;
}

export function WarnIcon() {
  return (
    <svg class="warn-icon" viewBox="0 0 16 16" width="13" height="13" aria-hidden="true">
      <path d="M8 1.5 15 14H1z" fill="#b7791f" />
      <path d="M8 6v4" stroke="#fff" stroke-width="1.7" stroke-linecap="round" />
      <circle cx="8" cy="12" r="0.95" fill="#fff" />
    </svg>
  );
}

export function CheckIcon() {
  return (
    <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
      <path
        d="M3 8.5 6.5 12 13 4.5"
        fill="none"
        stroke="currentColor"
        stroke-width="2"
        stroke-linecap="round"
        stroke-linejoin="round"
      />
    </svg>
  );
}

/** Each crew has a shape as well as a colour, so crews stay distinct without colour vision. */
export function shapePath(shape: Shape, r: number): string {
  switch (shape) {
    case 'circle':
      return `M ${-r} 0 a ${r} ${r} 0 1 0 ${2 * r} 0 a ${r} ${r} 0 1 0 ${-2 * r} 0`;
    case 'square':
      return `M ${-r * 0.88} ${-r * 0.88} h ${r * 1.76} v ${r * 1.76} h ${-r * 1.76} z`;
    case 'diamond':
      return `M 0 ${-r * 1.18} L ${r * 1.18} 0 L 0 ${r * 1.18} L ${-r * 1.18} 0 z`;
    case 'triangle':
      return `M 0 ${-r * 1.22} L ${r * 1.15} ${r * 0.85} L ${-r * 1.15} ${r * 0.85} z`;
  }
}

export function CrewMark({ shape, color, size = 12 }: { shape: Shape; color: string; size?: number }) {
  return (
    <svg class="crew-mark" viewBox="-7 -7 14 14" width={size} height={size} aria-hidden="true">
      <path d={shapePath(shape, 5.4)} fill={color} />
    </svg>
  );
}
