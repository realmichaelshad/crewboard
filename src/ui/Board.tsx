import { Fragment } from 'preact';
import { CREWS, DAYS, DAYS_SHORT, DAY_COUNT, SKILL_LABEL, cellIndex } from '../model/jobs';
import type { CellInfo } from '../model/cost';
import { Card } from './Card';
import { CrewMark, Dur, TDur, TNum, WarnIcon } from './parts';
import { dropPreview } from './drag';
import { store, set, week, jobById, select, type CellRef } from './store';

export function Totals({ compact }: { compact: boolean }) {
  const t = week().totals;
  const items = [
    {
      key: 'drive',
      value: t.drive,
      label: compact ? 'Drive' : 'Drive time',
      node: <TDur min={t.drive} compact={compact} />,
      warn: false,
    },
    {
      key: 'ot',
      value: t.overtime,
      label: 'Overtime',
      node: <TDur min={t.overtime} compact={compact} zero="0" />,
      warn: t.overtime > 0,
    },
    { key: 'un', value: t.unscheduled, label: 'Unscheduled', node: <TNum value={t.unscheduled} />, warn: false },
    {
      key: 'win',
      value: t.windowsMissed,
      label: 'Windows missed',
      node: <TNum value={t.windowsMissed} />,
      warn: t.windowsMissed > 0,
    },
  ];
  return (
    <div class="totals" aria-live="polite">
      {items.map((it) => (
        <div class={`total${it.warn ? ' warn' : ''}`} key={it.key} data-total={it.key} data-value={it.value}>
          <span class="t-label">{it.label}</span>
          <span class="t-val">
            {it.warn && <WarnIcon />}
            {it.node}
          </span>
        </div>
      ))}
    </div>
  );
}

function Indicator() {
  return <div class="drop-ind" />;
}

export function DropChip() {
  const p = dropPreview();
  if (!p) return null;
  let text = 'No change in driving';
  if (p.same) text = 'Same place';
  else if (p.delta > 0) text = `+${p.delta} min driving`;
  else if (p.delta < 0) text = `${-p.delta} min less driving`;
  return (
    <span class={`drop-chip${p.flags.length || p.over > 0 ? ' bad' : ''}`}>
      <span class="n">{text}</span>
      {p.flags.map((f) => (
        <span class="drop-flag" key={f.text}>
          <WarnIcon /> {f.text}
        </span>
      ))}
      {p.over > 0 && (
        <span class="drop-flag">
          <WarnIcon /> Adds <Dur min={p.over} /> of overtime
        </span>
      )}
    </span>
  );
}

/** Cards of one cell, with the drop indicator slotted in where the dragged card would land. */
function CellCards({ ids, cell, info, touch }: { ids: string[]; cell: CellRef; info: CellInfo | null; touch: boolean }) {
  const s = store.state;
  const w = week();
  const drag = s.drag;
  const target = drag?.target && drag.target.cell === cell ? drag.target : null;
  const out = [];
  let k = 0;
  ids.forEach((id, i) => {
    const job = jobById(id);
    if (!job) return;
    if (id !== drag?.id) {
      if (target && target.index === k) out.push(<Indicator key="ind" />);
      k++;
    }
    out.push(
      <Card
        key={id}
        job={job}
        crew={cell === 'backlog' ? null : Math.floor(cell / DAY_COUNT)}
        stop={info?.stops[i]}
        index={cell === 'backlog' ? undefined : i}
        flags={w.flagsById.get(id) ?? []}
        touch={touch}
      />,
    );
  });
  if (target && target.index >= k) out.push(<Indicator key="ind" />);
  return <>{out}</>;
}

function Over({ min }: { min: number }) {
  return (
    <span class="over">
      <WarnIcon /> Over 8 h by <Dur min={min} />
    </span>
  );
}

export function DeskBoard() {
  const s = store.state;
  const w = week();
  return (
    <div class="board" data-scroll>
      <div class="grid">
        <div class="corner" />
        {DAYS.map((d, day) => {
          let drive = 0;
          for (let c = 0; c < CREWS.length; c++) drive += w.cells[cellIndex(c, day)].drive;
          return (
            <button
              key={d}
              class={`day-head${s.day === day ? ' on' : ''}`}
              data-daytab={day}
              onClick={() => select({ day, crew: null, job: null })}
              aria-pressed={s.day === day}
            >
              <span class="dh-name">{d}</span>
              <span class="dh-drive">
                <Dur min={drive} compact /> drive
              </span>
            </button>
          );
        })}
        {CREWS.map((crew) => (
          <Fragment key={crew.id}>
            <div class="lane-head" style={{ '--crew': crew.color }}>
              <span class="lh-name">
                <CrewMark shape={crew.shape} color={crew.color} size={13} />
                {crew.lead}
              </span>
              <span class="lh-skills">{crew.skills.map((k) => SKILL_LABEL[k].replace(' crew', '')).join(', ')}</span>
            </div>
            {DAYS.map((_, day) => {
              const cell = cellIndex(crew.id, day);
              const info = w.cells[cell];
              const on = s.day === day && (s.crew === null || s.crew === crew.id);
              const exact = s.day === day && s.crew === crew.id;
              const isTarget = s.drag?.target?.cell === cell;
              return (
                <div
                  key={cell}
                  class={`cell${on ? ' on' : ''}${exact ? ' exact' : ''}${isTarget ? ' target' : ''}${info.overtime > 0 ? ' late' : ''}`}
                  data-cell={cell}
                  style={{ '--crew': crew.color }}
                >
                  <button
                    class="cell-head"
                    onClick={() => select(exact ? { day, crew: null, job: null } : { day, crew: crew.id, job: null })}
                    aria-label={`${crew.lead}, ${DAYS[day]}`}
                  >
                    {info.stops.length ? (
                      <>
                        <span class="ch-work">
                          <Dur min={info.work} compact />
                        </span>
                        <span class="ch-drive">
                          <Dur min={info.drive} compact /> drive
                        </span>
                      </>
                    ) : (
                      <span class="ch-drive">Free</span>
                    )}
                  </button>
                  {info.overtime > 0 && <Over min={info.overtime} />}
                  <CellCards ids={s.plan.routes[cell]} cell={cell} info={info} touch={false} />
                </div>
              );
            })}
          </Fragment>
        ))}
      </div>
    </div>
  );
}

export function Backlog({ touch }: { touch: boolean }) {
  const s = store.state;
  const isTarget = s.drag?.target?.cell === 'backlog';
  return (
    <section class={`backlog-lane${isTarget ? ' target' : ''}`} data-cell="backlog" data-flow="col">
      <header class="bl-head">
        <h2>
          Backlog <span class="n">{s.plan.backlog.length}</span>
        </h2>
        <p class="bl-note">{s.plan.backlog.length ? 'Not on the board yet.' : 'Every job is on the board.'}</p>
        {!s.attract && (
          <button class="ghost" onClick={() => set({ sheet: { kind: 'add' } })}>
            Add a job
          </button>
        )}
      </header>
      <div class="bl-cards">
        <CellCards ids={s.plan.backlog} cell="backlog" info={null} touch={touch} />
      </div>
    </section>
  );
}

export function DayTabs() {
  const s = store.state;
  const w = week();
  return (
    <div class="day-tabs" role="tablist">
      {DAYS_SHORT.map((d, day) => {
        let flags = 0;
        let over = false;
        for (let c = 0; c < CREWS.length; c++) {
          const info = w.cells[cellIndex(c, day)];
          flags += info.flagCount;
          if (info.overtime > 0) over = true;
        }
        return (
          <button
            key={d}
            role="tab"
            aria-selected={s.day === day}
            class={`day-tab${s.day === day ? ' on' : ''}`}
            data-daytab={day}
            onClick={() => select({ day, job: null })}
          >
            <span>{d}</span>
            {(flags > 0 || over) && (
              <span class="tab-warn" aria-label="Has problems">
                <WarnIcon />
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}

export function PhoneLanes() {
  const s = store.state;
  const w = week();
  const day = s.day;
  return (
    <div class="lanes">
      {CREWS.map((crew) => {
        const cell = cellIndex(crew.id, day);
        const info = w.cells[cell];
        const exact = s.crew === crew.id;
        const isTarget = s.drag?.target?.cell === cell;
        return (
          <section
            key={crew.id}
            class={`lane${exact ? ' exact' : ''}${isTarget ? ' target' : ''}${info.overtime > 0 ? ' late' : ''}`}
            data-cell={cell}
            style={{ '--crew': crew.color }}
          >
            <button class="lane-bar" onClick={() => select({ crew: exact ? null : crew.id, job: null })} aria-pressed={exact}>
              <span class="lb-name">
                <CrewMark shape={crew.shape} color={crew.color} size={13} />
                {crew.lead}
                <span class="lb-skills">{crew.skills.map((k) => SKILL_LABEL[k].replace(' crew', '')).join(', ')}</span>
              </span>
              <span class="lb-stats">
                {info.stops.length ? (
                  <>
                    <Dur min={info.work} compact /> work <span class="sep" /> <Dur min={info.drive} compact /> drive
                  </>
                ) : (
                  'Free day'
                )}
              </span>
            </button>
            {info.overtime > 0 && <Over min={info.overtime} />}
            <CellCards ids={s.plan.routes[cell]} cell={cell} info={info} touch />
            {s.plan.routes[cell].length === 0 && <p class="empty">No stops on {DAYS[day]}. Drop a job here to add one.</p>}
          </section>
        );
      })}
    </div>
  );
}
