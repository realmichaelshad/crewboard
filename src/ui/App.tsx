import { useEffect, useLayoutEffect, useReducer, useRef, useState } from 'preact/hooks';
import { CREWS, DAYS, JOB_TYPES, cellIndex, cellCrew } from '../model/jobs';
import { fmtDur, fmtOvertime, fmtClock } from '../model/format';
import { getTown } from '../model/town';
import { Backlog, DayTabs, DeskBoard, DropChip, PhoneLanes, Totals } from './Board';
import { Badges, FlagRow } from './Card';
import { CrewView } from './CrewView';
import { MapView } from './MapView';
import { Sheets } from './Sheets';
import { CrewMark, Dur } from './parts';
import { flip } from './flip';
import { planWeek } from './planner';
import { store, set, subscribe, undo, week, jobById, locate, fitIn, select } from './store';

const town = getTown();

function useStore() {
  const [, force] = useReducer((x: number, _a: number) => x + 1, 0);
  useEffect(() => subscribe(() => force(1)), []);
}

function useDesk() {
  const q = '(min-width: 1100px) and (min-height: 560px)';
  const [desk, setDesk] = useState(() => window.matchMedia(q).matches);
  useEffect(() => {
    const m = window.matchMedia(q);
    const on = () => setDesk(m.matches);
    m.addEventListener('change', on);
    return () => m.removeEventListener('change', on);
  }, []);
  return desk;
}

function Logo() {
  // Four crew routes leaving one yard.
  return (
    <svg class="logo" viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">
      <rect x="9" y="9" width="6" height="6" fill="var(--ink)" />
      <path d="M12 9V2.5h7" stroke="#d64b2a" stroke-width="2" fill="none" />
      <path d="M15 12h6.5v7" stroke="#2a57c9" stroke-width="2" fill="none" />
      <path d="M12 15v6.5H5" stroke="#1f7a4d" stroke-width="2" fill="none" />
      <path d="M9 12H2.5V5" stroke="#7a3e9d" stroke-width="2" fill="none" />
    </svg>
  );
}

function PlanButton({ big }: { big?: boolean }) {
  const s = store.state;
  const busy = !!s.planning;
  return (
    <button
      class={`primary plan-btn${big ? ' big' : ''}${busy ? ' busy' : ''}`}
      data-plan
      onClick={() => planWeek()}
      disabled={busy || !!s.drag}
      aria-busy={busy}
    >
      {busy && <span class="plan-progress" style={{ transform: `scaleX(${s.planning!.progress})` }} />}
      <span class="plan-label">{busy ? 'Planning the week' : 'Plan the week'}</span>
    </button>
  );
}

function ViewSwitch() {
  const v = store.state.view;
  return (
    <div class="view-switch" role="tablist" aria-label="View">
      <button role="tab" aria-selected={v === 'board'} class={v === 'board' ? 'on' : ''} onClick={() => set({ view: 'board' })}>
        Board
      </button>
      <button
        role="tab"
        aria-selected={v === 'crew'}
        class={v === 'crew' ? 'on' : ''}
        onClick={() => set({ view: 'crew', crew: store.state.crew ?? 0 })}
      >
        Crew view
      </button>
    </div>
  );
}

export function resultSentence(): string | null {
  const r = store.state.result;
  if (!r) return null;
  if (r.keptInput) return 'This week is already as good as the planner can make it. Nothing changed.';
  const { before: b, after: a } = r;
  const parts: string[] = [];
  parts.push(`Drive time ${fmtDur(b.drive)}, now ${fmtDur(a.drive)}.`);
  if (b.overtime || a.overtime) parts.push(`Overtime ${fmtOvertime(b.overtime)}, now ${fmtOvertime(a.overtime)}.`);
  if (b.windowsMissed || a.windowsMissed) parts.push(`Windows missed ${b.windowsMissed}, now ${a.windowsMissed}.`);
  if (b.skillGaps || a.skillGaps) parts.push(`Wrong crew ${b.skillGaps}, now ${a.skillGaps}.`);
  if (b.unscheduled !== a.unscheduled) parts.push(`Unscheduled ${b.unscheduled}, now ${a.unscheduled}.`);
  return parts.join(' ');
}

function ResultLine() {
  const text = resultSentence();
  if (!text) return null;
  return (
    <div class="result" role="status" data-result>
      <p>
        {text.split(/(\d+)/).map((part, i) =>
          i % 2 ? (
            <b class="n" key={i}>
              {part}
            </b>
          ) : (
            part
          ),
        )}
      </p>
      {!store.state.attract && (
        <div class="result-actions">
          <button class="ghost" onClick={() => set({ result: null })}>
            Dismiss
          </button>
        </div>
      )}
    </div>
  );
}

function DragGhost() {
  const d = store.state.drag;
  if (!d) return null;
  const job = jobById(d.id);
  if (!job) return null;
  const from = locate(store.state.plan, d.id);
  const color = from && from.cell !== 'backlog' ? CREWS[cellCrew(from.cell)].color : 'var(--ink-3)';
  return (
    <>
      <div
        class="ghost-card"
        style={{ width: `${d.w}px`, transform: `translate(${d.x - d.dx}px, ${d.y - d.dy}px)`, '--crew': color }}
        aria-hidden="true"
      >
        <span class="magnet" />
        <div class="c-top">
          <span class="c-type">{JOB_TYPES[job.type].label}</span>
          <span class="c-dur">
            <Dur min={job.dur} compact />
          </span>
        </div>
        <div class="c-sub">
          <span class="c-cust">{job.customer}</span>
        </div>
        <DropChip />
      </div>
      {store.state.attract && <div class="touch-dot" style={{ transform: `translate(${d.x}px, ${d.y}px)` }} />}
    </>
  );
}

function Toast() {
  const t = store.state.toast;
  if (!t) return null;
  return (
    <div class="toast" role="status" key={t.id}>
      {t.text}
    </div>
  );
}

function DemoNote() {
  return <p class="demo-note">Demo data. The town, crews and customers are fictional.</p>;
}

/** Details of the selected job, or the day's crews, under the desktop map. */
function SidePanel() {
  const s = store.state;
  const w = week();
  const job = s.job ? jobById(s.job) : undefined;
  return (
    <>
      {job && <JobDetail id={job.id} />}
      <Legend />
      <Backlog touch={false} />
    </>
  );
}

function JobDetail({ id }: { id: string }) {
  const s = store.state;
  const w = week();
  const job = jobById(id)!;
  const at = locate(s.plan, job.id);
  const cell = at && at.cell !== 'backlog' ? at.cell : null;
  const stop = cell !== null ? w.cells[cell].stops[at!.index] : null;
  return (
    <div class="detail">
      <div class="detail-head">
        <h3>{JOB_TYPES[job.type].label}</h3>
        <span class="c-dur">
          <Dur min={job.dur} />
        </span>
      </div>
      <p class="detail-who">
        {job.customer}, {job.address}, {town.districts[job.district].name}
      </p>
      <p class="detail-when">
        {cell !== null && stop ? (
          <>
            {CREWS[cellCrew(cell)].lead}, {DAYS[cell % 5]}, stop <b class="n">{at!.index + 1}</b>. Arrives{' '}
            <b class="n">{fmtClock(stop.arrive)}</b>, works <b class="n">{fmtClock(stop.start)}</b> to{' '}
            <b class="n">{fmtClock(stop.end)}</b> after <Dur min={stop.driveIn} /> of driving.
          </>
        ) : (
          'In the backlog, not on the board yet.'
        )}
      </p>
      <Badges job={job} />
      {(w.flagsById.get(job.id) ?? []).map((f) => (
        <FlagRow flag={f} key={f.text} />
      ))}
      <div class="detail-actions">
        <button class="ghost" onClick={() => set({ sheet: { kind: 'move', job: job.id } })}>
          Move
        </button>
        <button class="ghost" onClick={() => fitIn(job.id)}>
          Fit it in
        </button>
      </div>
    </div>
  );
}

function Legend() {
  const s = store.state;
  const w = week();
  return (
    <ul class="legend">
      {CREWS.map((c) => {
        const info = w.cells[cellIndex(c.id, s.day)];
        const on = s.crew === c.id;
        return (
          <li key={c.id}>
            <button
              class={`legend-row${on ? ' on' : ''}`}
              onClick={() => select({ crew: on ? null : c.id, job: null })}
              aria-pressed={on}
            >
              <CrewMark shape={c.shape} color={c.color} size={13} />
              <span class="lg-name">{c.lead}</span>
              <span class="lg-stat">
                <b class="n">{info.stops.length}</b> stops
              </span>
              <span class="lg-stat">
                <Dur min={info.drive} compact /> drive
              </span>
              <span class={`lg-stat${info.overtime ? ' late' : ''}`}>
                back <b class="n">{info.stops.length ? fmtClock(info.end) : '--'}</b>
              </span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}

function mapCells(): { cells: number[]; focus: number | null } {
  const s = store.state;
  const cells = CREWS.map((c) => cellIndex(c.id, s.day));
  return { cells, focus: s.crew === null ? null : cellIndex(s.crew, s.day) };
}

function Desk() {
  const s = store.state;
  const { cells, focus } = mapCells();
  return (
    <div class="desk">
      <header class="top">
        <div class="brand">
          <Logo />
          <div>
            <h1>Crewboard</h1>
            <DemoNote />
          </div>
        </div>
        <Totals compact={false} />
        <div class="top-actions">
          <ViewSwitch />
          <button class="ghost chrome" onClick={undo} disabled={!s.history.length || !!s.planning}>
            Undo
          </button>
          <PlanButton />
          <button class="ghost chrome" onClick={() => set({ sheet: { kind: 'info' } })}>
            About
          </button>
        </div>
      </header>
      <ResultLine />
      {s.view === 'board' ? (
        <main class="desk-main">
          <DeskBoard />
          <aside class="side">
            <div class="side-head">
              <h2>
                {DAYS[s.day]}
                {s.crew !== null && <span class="muted">, {CREWS[s.crew].lead}</span>}
              </h2>
              <p class="muted small">
                {s.crew === null ? 'All four crews. Pick a cell or a card to focus.' : 'Pick the crew again to see all four.'}
              </p>
            </div>
            <MapView cells={cells} focus={focus} job={s.job} label={`Routes for ${DAYS[s.day]}`} />
            <SidePanel />
          </aside>
        </main>
      ) : (
        <main class="desk-main crew-main">
          <CrewView />
        </main>
      )}
    </div>
  );
}

function Phone() {
  const s = store.state;
  const { cells, focus } = mapCells();
  const bar = useRef<HTMLElement>(null);
  useLayoutEffect(() => {
    const el = bar.current;
    if (!el) return;
    const ro = new ResizeObserver(() =>
      document.documentElement.style.setProperty('--bar-h', `${Math.ceil(el.getBoundingClientRect().height)}px`),
    );
    ro.observe(el);
    return () => {
      ro.disconnect();
      document.documentElement.style.removeProperty('--bar-h');
    };
  }, []);
  return (
    <div class="phone">
      <header class="p-top">
        <div class="p-row">
          <h1 class="wordmark">
            <Logo />
            Crewboard
          </h1>
          <ViewSwitch />
          <button class="ghost chrome icon-btn" onClick={() => set({ sheet: { kind: 'info' } })}>
            About
          </button>
        </div>
        <Totals compact />
        {s.view === 'board' && <DayTabs />}
      </header>
      {s.view === 'board' ? (
        <main class="p-main">
          <section class={`p-map${s.mapOpen ? ' open' : ''}`}>
            <button class="p-map-toggle" onClick={() => set({ mapOpen: !s.mapOpen })} aria-expanded={s.mapOpen}>
              <span>
                Map, {DAYS[s.day]}
                {s.crew !== null && `, ${CREWS[s.crew].lead}`}
              </span>
              <span class="muted">{s.mapOpen ? 'Hide' : 'Show'}</span>
            </button>
            {s.mapOpen && <MapView cells={cells} focus={focus} job={s.job} label={`Routes for ${DAYS[s.day]}`} />}
          </section>
          <PhoneLanes />
          <Backlog touch />
        </main>
      ) : (
        <main class="p-main">
          <CrewView />
        </main>
      )}
      <footer class="p-bar" ref={bar}>
        <ResultLine />
        <DemoNote />
        <div class="p-bar-row">
          <button class="ghost chrome" onClick={undo} disabled={!s.history.length || !!s.planning}>
            Undo
          </button>
          <PlanButton big />
          <button class="ghost chrome" onClick={() => set({ sheet: { kind: 'add' } })}>
            Add job
          </button>
        </div>
      </footer>
    </div>
  );
}

export function App() {
  useStore();
  const desk = useDesk();
  useLayoutEffect(() => flip.play());
  const s = store.state;
  return (
    <div class={`app${s.attract ? ' attract' : ''}${s.drag ? ' has-drag' : ''}`}>
      {desk ? <Desk /> : <Phone />}
      <DragGhost />
      <Sheets />
      <Toast />
    </div>
  );
}
