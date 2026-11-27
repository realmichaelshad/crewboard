import { useEffect, useRef, useState } from 'preact/hooks';
import type { ComponentChildren } from 'preact';
import {
  CREWS,
  DAYS,
  DAYS_SHORT,
  JOB_TYPES,
  JOB_TYPE_ORDER,
  SKILL_LABEL,
  WINDOWS,
  type JobType,
  type TimeWindow,
} from '../model/jobs';
import { destinations } from '../model/moves';
import { getTown, TOWN_NAME } from '../model/town';
import { CrewMark, Dur } from './parts';
import { store, set, problem, jobById, locate, moveJob, addJob, resetDemo, suggestCustomer, toast } from './store';

const town = getTown();

function Sheet({
  title,
  children,
  onClose,
  wide,
}: {
  title: string;
  children: ComponentChildren;
  onClose: () => void;
  wide?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    ref.current?.querySelector<HTMLElement>('[data-autofocus], button, input, select')?.focus({ preventScroll: true });
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      prev?.focus?.({ preventScroll: true });
    };
  }, []);
  return (
    <div class="scrim" onClick={onClose}>
      <div
        class={`sheet${wide ? ' wide' : ''}`}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        ref={ref}
        onClick={(e) => e.stopPropagation()}
      >
        <header class="sheet-head">
          <h2>{title}</h2>
          <button class="ghost close" onClick={onClose}>
            Close
          </button>
        </header>
        <div class="sheet-body">{children}</div>
      </div>
    </div>
  );
}

const close = () => set({ sheet: null });

function MoveSheet({ id }: { id: string }) {
  const job = jobById(id);
  if (!job) return null;
  const plan = store.state.plan;
  const all = destinations(problem(), plan, id);
  const valid = all.filter((d) => d.valid);
  const from = locate(plan, id);
  const where =
    !from || from.cell === 'backlog'
      ? 'In the backlog'
      : `Now with ${CREWS[Math.floor(from.cell / 5)].lead} on ${DAYS[from.cell % 5]}, stop ${from.index + 1}`;
  const go = (cell: number | 'backlog', index: number, delta?: number) => {
    set({ sheet: null });
    moveJob(id, cell, index);
    if (cell !== 'backlog' && delta !== undefined) {
      const c = CREWS[Math.floor(cell / 5)];
      toast(
        `Moved to ${c.lead} on ${DAYS[cell % 5]}. ${delta > 0 ? `${delta} min more driving` : delta < 0 ? `${-delta} min less driving` : 'Driving unchanged'} this week.`,
      );
    }
  };
  return (
    <Sheet title={`Move ${JOB_TYPES[job.type].label.toLowerCase()}`} onClose={close}>
      <p class="sheet-lede">
        {job.customer}, {job.address}. {where}.
      </p>
      {valid.length > 0 ? (
        <ul class="dests">
          {valid.map((d) => (
            <li key={d.cell}>
              <button class="dest" onClick={() => go(d.cell, d.index, d.delta)} style={{ '--crew': CREWS[d.crew].color }}>
                <span class="d-who">
                  <CrewMark shape={CREWS[d.crew].shape} color={CREWS[d.crew].color} size={13} />
                  {CREWS[d.crew].lead}
                </span>
                <span class="d-day">{DAYS[d.day]}</span>
                <span class="d-pos">
                  stop <b class="n">{d.index + 1}</b>
                </span>
                <span class={`d-delta n${d.delta > 0 ? ' up' : d.delta < 0 ? ' down' : ''}`}>
                  {d.delta > 0 ? `+${d.delta} min` : d.delta < 0 ? `${-d.delta} min less` : 'no change'}
                </span>
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p class="sheet-note">No crew has room for this job without breaking a rule or running past 8 hours.</p>
      )}
      <p class="sheet-note">
        Drive minutes are the change for the whole week.{' '}
        {all.length - valid.length > 0 &&
          `${all.length - valid.length} other ${all.length - valid.length === 1 ? 'spot' : 'spots'} would break a rule or add overtime, so they are not listed.`}
      </p>
      {from && from.cell !== 'backlog' && (
        <button class="ghost wide-btn" onClick={() => go('backlog', store.state.plan.backlog.length)}>
          Take it off the board
        </button>
      )}
    </Sheet>
  );
}

function AddSheet() {
  const [type, setType] = useState<JobType>('hedge');
  const [dur, setDur] = useState(90);
  const [district, setDistrict] = useState(0);
  const [customer, setCustomer] = useState(() => suggestCustomer());
  const [win, setWin] = useState<TimeWindow | ''>('');
  const [days, setDays] = useState<number[]>([0, 1, 2, 3, 4]);
  const skill = JOB_TYPES[type].skill;
  const durations: number[] = [];
  for (let m = 30; m <= 300; m += 15) durations.push(m);
  const submit = (e: Event) => {
    e.preventDefault();
    if (!days.length) return;
    addJob({ type, dur, district, customer, window: win || null, days });
  };
  return (
    <Sheet title="Add a job" onClose={close}>
      <form class="form" onSubmit={submit}>
        <label class="field">
          <span>Job</span>
          <select
            value={type}
            onChange={(e) => {
              const t = (e.target as HTMLSelectElement).value as JobType;
              setType(t);
              const spec = JOB_TYPES[t];
              setDur(Math.round((spec.min + spec.max) / 2 / 15) * 15);
            }}
          >
            {JOB_TYPE_ORDER.map((t) => (
              <option value={t} key={t}>
                {JOB_TYPES[t].label}
              </option>
            ))}
          </select>
        </label>
        <div class="field-row">
          <label class="field">
            <span>Length</span>
            <select value={dur} onChange={(e) => setDur(Number((e.target as HTMLSelectElement).value))}>
              {durations.map((m) => (
                <option value={m} key={m}>
                  {m < 60 ? `${m} min` : `${Math.floor(m / 60)} h${m % 60 ? ` ${m % 60} min` : ''}`}
                </option>
              ))}
            </select>
          </label>
          <label class="field">
            <span>District</span>
            <select value={district} onChange={(e) => setDistrict(Number((e.target as HTMLSelectElement).value))}>
              {town.districts.map((d, k) => (
                <option value={k} key={d.name}>
                  {d.name}
                </option>
              ))}
            </select>
          </label>
        </div>
        <label class="field">
          <span>Customer</span>
          <input value={customer} maxLength={40} onInput={(e) => setCustomer((e.target as HTMLInputElement).value)} />
        </label>
        <fieldset class="field">
          <legend>Time of day</legend>
          <div class="seg">
            {(['', 'am', 'pm'] as const).map((w) => (
              <label key={w || 'any'} class={`seg-opt${win === w ? ' on' : ''}`}>
                <input type="radio" name="win" checked={win === w} onChange={() => setWin(w)} />
                {w ? WINDOWS[w].label : 'Any time'}
              </label>
            ))}
          </div>
        </fieldset>
        <fieldset class="field">
          <legend>Days the customer can do</legend>
          <div class="seg">
            {DAYS_SHORT.map((d, k) => (
              <label key={d} class={`seg-opt${days.includes(k) ? ' on' : ''}`}>
                <input
                  type="checkbox"
                  checked={days.includes(k)}
                  onChange={() => setDays(days.includes(k) ? days.filter((x) => x !== k) : [...days, k].sort())}
                />
                {d}
              </label>
            ))}
          </div>
        </fieldset>
        <p class="sheet-note">
          {skill
            ? `${JOB_TYPES[type].label} needs a ${SKILL_LABEL[skill].toLowerCase()}: ${CREWS.filter((c) =>
                c.skills.includes(skill),
              )
                .map((c) => c.lead)
                .join(' or ')}.`
            : 'Any crew can do this job.'}{' '}
          The address is a free street corner in the district you pick.
        </p>
        <button class="primary wide-btn" type="submit" disabled={!days.length}>
          Add to backlog
        </button>
      </form>
    </Sheet>
  );
}

function InfoSheet() {
  return (
    <Sheet title="About Crewboard" onClose={close}>
      <p class="sheet-lede">
        A week planner for a four-crew grounds company. Drag jobs between crews and days and every number updates: drive time,
        overtime, missed time windows, jobs that need a skill the crew lacks.
      </p>
      <p>
        Plan the week rebuilds the whole board with cheapest insertion, then improves it with route moves inside and between days.
        It keeps every rule and the 8 hour day, and never returns a week that is worse than the one you gave it.
      </p>
      <p>
        Drive times are shortest paths on the street graph of {TOWN_NAME}, so the river can only be crossed at its two bridges.
      </p>
      <p class="sheet-note">
        Concept project. Crewboard is a fictional product. {TOWN_NAME}, its crews and its customers are demo data, and your
        changes stay in this browser.
      </p>
      <button
        class="ghost wide-btn"
        onClick={() => {
          resetDemo();
          toast('The original week is back. Undo brings your plan back.');
        }}
      >
        Reset demo data
      </button>
      <p class="credit">
        Design and build:{' '}
        <a href="https://michaelshadpour.com" target="_blank" rel="noopener">
          Michael Shadpour
        </a>
      </p>
    </Sheet>
  );
}

export function Sheets() {
  const sheet = store.state.sheet;
  if (!sheet) return null;
  if (sheet.kind === 'move') return <MoveSheet id={sheet.job} key={sheet.job} />;
  if (sheet.kind === 'add') return <AddSheet />;
  return <InfoSheet />;
}
