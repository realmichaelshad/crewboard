import { Fragment } from 'preact';
import { CREWS, DAYS, JOB_TYPES, cellIndex } from '../model/jobs';
import { fmtClock } from '../model/format';
import { getTown } from '../model/town';
import { Badges, FlagRow } from './Card';
import { DayTabs } from './Board';
import { MapView } from './MapView';
import { CheckIcon, CrewMark, Dur } from './parts';
import { store, set, week, jobById, toggleCheck, select } from './store';

const town = getTown();

export function CrewView() {
  const s = store.state;
  const crewId = s.crew ?? 0;
  const crew = CREWS[crewId];
  const cell = cellIndex(crewId, s.day);
  const info = week().cells[cell];
  const ids = s.plan.routes[cell];
  const doneCount = ids.filter((id) => s.checks[id]).length;
  return (
    <div class="crew-view" style={{ '--crew': crew.color }}>
      <div class="cv-controls">
        <div class="crew-pick" role="tablist" aria-label="Crew">
          {CREWS.map((c) => (
            <button
              key={c.id}
              role="tab"
              aria-selected={c.id === crewId}
              class={`crew-tab${c.id === crewId ? ' on' : ''}`}
              style={{ '--crew': c.color }}
              onClick={() => select({ crew: c.id, job: null })}
            >
              <CrewMark shape={c.shape} color={c.color} size={12} />
              {c.lead}
            </button>
          ))}
        </div>
        <DayTabs />
      </div>
      <div class="cv-body">
        <div class="cv-map">
          <MapView
            cells={[cell]}
            focus={cell}
            job={s.job && ids.includes(s.job) ? s.job : null}
            checks={s.checks}
            label={`Route for ${crew.lead} on ${DAYS[s.day]}`}
          />
        </div>
        <div class="cv-list">
          <div class="cv-summary">
            <h2>
              {crew.lead}, {DAYS[s.day]}
            </h2>
            {ids.length ? (
              <p>
                <b class="n">{ids.length}</b> stops <span class="sep" /> <Dur min={info.work} /> work <span class="sep" />{' '}
                <Dur min={info.drive} /> driving <span class="sep" /> done <b class="n">{doneCount}</b> of{' '}
                <b class="n">{ids.length}</b>
              </p>
            ) : (
              <p>No stops today.</p>
            )}
          </div>
          {ids.length > 0 && (
            <ol class="itinerary">
              <li class="it-end">
                <span class="it-time n">{fmtClock(0)}</span>
                <span>Leave the yard</span>
              </li>
              {info.stops.map((st, i) => {
                const job = jobById(st.id)!;
                const done = !!s.checks[st.id];
                return (
                  <Fragment key={st.id}>
                    <li class="it-leg">
                      <span class="it-rail" />
                      <span>
                        <Dur min={st.driveIn} /> drive
                        {st.wait > 0 && (
                          <>
                            , wait <Dur min={st.wait} />
                          </>
                        )}
                      </span>
                    </li>
                    <li class={`it-stop${done ? ' done' : ''}${s.job === st.id ? ' selected' : ''}`}>
                      <label class="check">
                        <input
                          type="checkbox"
                          checked={done}
                          onChange={() => toggleCheck(st.id)}
                          aria-label={`Done: ${job.customer}`}
                        />
                        <span class="box">
                          <CheckIcon />
                        </span>
                      </label>
                      <button class="it-main" onClick={() => set({ job: s.job === st.id ? null : st.id })}>
                        <span class="it-head">
                          <span class="magnet it-num">{i + 1}</span>
                          <span class="it-type">{JOB_TYPES[job.type].label}</span>
                          <span class="it-time n">
                            {fmtClock(st.start)} to {fmtClock(st.end)}
                          </span>
                        </span>
                        <span class="it-cust">{job.customer}</span>
                        <span class="it-addr">
                          {job.address}, {town.districts[job.district].name}
                        </span>
                      </button>
                      <div class="it-extra">
                        <Badges job={job} />
                        {st.flags.map((f) => (
                          <FlagRow flag={f} key={f.text} />
                        ))}
                      </div>
                    </li>
                  </Fragment>
                );
              })}
              <li class="it-leg">
                <span class="it-rail" />
                <span>
                  <Dur min={info.driveBack} /> drive
                </span>
              </li>
              <li class="it-end">
                <span class="it-time n">{fmtClock(info.end)}</span>
                <span>Back at the yard</span>
              </li>
            </ol>
          )}
        </div>
      </div>
    </div>
  );
}
