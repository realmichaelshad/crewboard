import { CREWS, JOB_TYPES, SKILL_LABEL, WINDOWS, daysShort, type Job } from '../model/jobs';
import type { Flag, StopInfo } from '../model/cost';
import { getTown } from '../model/town';
import { Dur, WarnIcon } from './parts';
import { cardPointerDown, clickSuppressed } from './drag';
import { store, set, fitIn, select } from './store';

const town = getTown();

export function Badges({ job }: { job: Job }) {
  const skill = JOB_TYPES[job.type].skill;
  const days = daysShort(job.days);
  if (!skill && !job.window && !days) return null;
  return (
    <div class="badges">
      {job.window && <span class="badge">{WINDOWS[job.window].short}</span>}
      {days && <span class="badge">{days}</span>}
      {skill && <span class="badge">{SKILL_LABEL[skill]}</span>}
    </div>
  );
}

export function FlagRow({ flag }: { flag: Flag }) {
  return (
    <div class="flag">
      <WarnIcon />
      <span>{flag.text}</span>
    </div>
  );
}

interface CardProps {
  job: Job;
  crew: number | null;
  stop?: StopInfo;
  index?: number;
  flags: Flag[];
  touch: boolean;
}

export function Card({ job, crew, stop, index, flags, touch }: CardProps) {
  const s = store.state;
  const selected = s.job === job.id;
  const dragging = s.drag?.id === job.id;
  const backlog = crew === null;
  const color = crew === null ? 'var(--ink-3)' : CREWS[crew].color;
  const showMove = touch || selected;
  const onClick = () => {
    if (clickSuppressed() || s.attract) return;
    select({ job: selected ? null : job.id });
  };
  const longWait = stop && stop.wait >= 30;
  return (
    <div
      class={`card${selected ? ' selected' : ''}${dragging ? ' lifted' : ''}${backlog ? ' backlog' : ''}${job.added ? ' added' : ''}`}
      data-job={job.id}
      style={{ '--crew': color }}
      role="button"
      tabIndex={0}
      aria-pressed={selected}
      aria-label={`${JOB_TYPES[job.type].label} for ${job.customer}`}
      onPointerDown={(e) => cardPointerDown(e as PointerEvent, job.id)}
      onClick={onClick}
      onKeyDown={(e) => {
        if ((e.key === 'Enter' || e.key === ' ') && e.target === e.currentTarget) {
          e.preventDefault();
          onClick();
        }
      }}
      onContextMenu={(e) => e.preventDefault()}
    >
      {index !== undefined ? (
        <span class="magnet" aria-label={`Stop ${index + 1}`}>
          {index + 1}
        </span>
      ) : (
        <span class="magnet hollow" aria-hidden="true" />
      )}
      <div class="c-top">
        <span class="c-type">{JOB_TYPES[job.type].label}</span>
        <span class="c-dur">
          <Dur min={job.dur} compact />
        </span>
      </div>
      <div class="c-sub">
        <span class="c-cust">{job.customer}</span>
        <span class="c-dist">{town.districts[job.district].name}</span>
      </div>
      <Badges job={job} />
      {flags.map((f) => (
        <FlagRow flag={f} key={f.text} />
      ))}
      {longWait && (
        <div class="c-wait">
          Waits <Dur min={stop!.wait} /> for the window
        </div>
      )}
      {(showMove || backlog) && (
        <div class="c-actions">
          {showMove && (
            <button
              class="mini"
              onClick={(e) => {
                e.stopPropagation();
                set({ sheet: { kind: 'move', job: job.id }, job: job.id });
              }}
            >
              Move
            </button>
          )}
          {backlog && (
            <button
              class="mini strong"
              onClick={(e) => {
                e.stopPropagation();
                fitIn(job.id);
              }}
            >
              Fit it in
            </button>
          )}
        </div>
      )}
    </div>
  );
}
