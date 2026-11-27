import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { getTown, shortestPath, TOWN_NAME, UNIT_M, type Town } from '../model/town';
import { CREWS, cellCrew } from '../model/jobs';
import { shapePath } from './parts';
import { store, select, problem, jobById } from './store';

const town = getTown();

function useSize(ref: { current: HTMLElement | null }) {
  const [size, setSize] = useState({ w: 0, h: 0 });
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      const r = el.getBoundingClientRect();
      setSize({ w: Math.round(r.width), h: Math.round(r.height) });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return size;
}

function riverPaths(t: Town) {
  const top: string[] = [];
  const bot: string[] = [];
  const mid: string[] = [];
  for (let x = -20; x <= t.W + 20; x += 10) {
    const y = t.riverY(x);
    top.push(`${x},${(y - t.riverWidth / 2).toFixed(1)}`);
    bot.push(`${x},${(y + t.riverWidth / 2).toFixed(1)}`);
    mid.push(`${x},${y.toFixed(1)}`);
  }
  return { area: `M${top.join(' L')} L${bot.reverse().join(' L')} Z`, line: `M${mid.join(' L')}` };
}

const RIVER = riverPaths(town);
const STREETS = town.edges
  .filter((e) => e.kind === 'street')
  .map((e) => `M${town.nodes[e.a].x} ${town.nodes[e.a].y}L${town.nodes[e.b].x} ${town.nodes[e.b].y}`)
  .join('');
const AVENUES = town.edges
  .filter((e) => e.kind === 'avenue')
  .map((e) => `M${town.nodes[e.a].x} ${town.nodes[e.a].y}L${town.nodes[e.b].x} ${town.nodes[e.b].y}`)
  .join('');

/** The printed base map. It only changes when the drawing scale changes. */
function BaseMap({ k }: { k: number }) {
  const px = (v: number) => v / k;
  const showSmall = k > 0.36;
  const bar = 1000 / UNIT_M; // one kilometre in map units
  return (
    <g>
      <rect x={-50} y={-50} width={town.W + 100} height={town.H + 100} fill="var(--land)" />
      {town.parks.map((p) => (
        <rect
          key={p.name}
          x={p.x + px(2)}
          y={p.y + px(2)}
          width={p.w - px(4)}
          height={p.h - px(4)}
          rx={px(3)}
          fill="var(--park)"
        />
      ))}
      <path d={RIVER.area} fill="var(--river)" stroke="var(--river-edge)" stroke-width={px(1)} />
      <path id="river-line" d={RIVER.line} fill="none" />
      {/* Atlas rail: dark line with white dashes. */}
      <line x1={town.rail.x1} y1={town.rail.y1} x2={town.rail.x2} y2={town.rail.y2} stroke="#4b5257" stroke-width={px(3.4)} />
      <line
        x1={town.rail.x1}
        y1={town.rail.y1}
        x2={town.rail.x2}
        y2={town.rail.y2}
        stroke="#fff"
        stroke-width={px(1.6)}
        stroke-dasharray={`${px(6)} ${px(6)}`}
      />
      {/* Roads: casings first, then fills, so junctions merge cleanly. */}
      <path d={STREETS} stroke="var(--road-case)" stroke-width={px(3.6)} fill="none" stroke-linecap="round" />
      <path d={AVENUES} stroke="var(--main-case)" stroke-width={px(5.4)} fill="none" stroke-linecap="round" />
      {town.bridges.map((b) => {
        const e = town.edges[b.edge];
        const A = town.nodes[e.a];
        const B = town.nodes[e.b];
        return <line key={b.name} x1={A.x} y1={A.y} x2={B.x} y2={B.y} stroke="var(--ink)" stroke-width={px(6.6)} />;
      })}
      <path d={STREETS} stroke="var(--road)" stroke-width={px(2.2)} fill="none" stroke-linecap="round" />
      <path d={AVENUES} stroke="var(--main)" stroke-width={px(3.6)} fill="none" stroke-linecap="round" />
      {town.bridges.map((b) => {
        const e = town.edges[b.edge];
        const A = town.nodes[e.a];
        const B = town.nodes[e.b];
        return (
          <g key={b.name}>
            <line x1={A.x} y1={A.y} x2={B.x} y2={B.y} stroke="var(--road)" stroke-width={px(4)} />
            {showSmall && (
              <text class="m-small" x={b.x + px(8)} y={b.y + px(3)} font-size={px(9)}>
                {b.name}
              </text>
            )}
          </g>
        );
      })}
      {showSmall && (
        <text class="m-river" font-size={px(10)}>
          <textPath href="#river-line" startOffset="7%">
            River Wren
          </textPath>
        </text>
      )}
      {showSmall &&
        town.parks.map((p) => (
          <text key={p.name} class="m-park" x={p.x + p.w / 2} y={p.y + p.h / 2 + px(3)} font-size={px(9)} text-anchor="middle">
            {p.name}
          </text>
        ))}
      {town.districts.map((d) => (
        <text key={d.name} class="m-district" x={d.x} y={d.y} font-size={px(k > 0.4 ? 10.5 : 9)} text-anchor="middle">
          {d.name}
        </text>
      ))}
      {showSmall && (
        <g>
          <rect
            x={town.station.x - px(4)}
            y={town.station.y - px(4)}
            width={px(8)}
            height={px(8)}
            fill="#fff"
            stroke="#4b5257"
            stroke-width={px(1.6)}
          />
          <text class="m-small" x={town.station.x + px(7)} y={town.station.y - px(7)} font-size={px(9)}>
            Station
          </text>
        </g>
      )}
      <g transform={`translate(${px(14)} ${px(20)})`}>
        <rect x={0} y={-px(3)} width={bar / 2} height={px(3)} fill="var(--ink)" />
        <rect x={bar / 2} y={-px(3)} width={bar / 2} height={px(3)} fill="#fff" stroke="var(--ink)" stroke-width={px(0.8)} />
        <text class="m-small n" x={bar + px(5)} y={0} font-size={px(9)}>
          1 km
        </text>
      </g>
      <text class="m-title" x={town.W - px(12)} y={px(24)} font-size={px(12)} text-anchor="end">
        {TOWN_NAME}
      </text>
    </g>
  );
}

function routePoints(nodes: number[], dx: number, dy: number): string {
  const pts: string[] = [];
  for (let i = 0; i < nodes.length - 1; i++) {
    const path = shortestPath(town, nodes[i], nodes[i + 1]);
    for (let k = i === 0 ? 0 : 1; k < path.length; k++) {
      const n = town.nodes[path[k]];
      pts.push(`${(n.x + dx).toFixed(1)},${(n.y + dy).toFixed(1)}`);
    }
  }
  return pts.join(' ');
}

interface MapProps {
  cells: number[];
  focus: number | null;
  job: string | null;
  checks?: Record<string, boolean>;
  label?: string;
}

export function MapView({ cells, focus, job, checks, label }: MapProps) {
  const ref = useRef<HTMLDivElement>(null);
  const { w, h } = useSize(ref);
  const k = w > 4 && h > 4 ? Math.min(w / town.W, h / town.H) : 0.4;
  const kr = Math.max(0.05, Math.round(k * 100) / 100);
  const base = useMemo(() => <BaseMap k={kr} />, [kr]);
  const px = (v: number) => v / kr;
  const plan = store.state.plan;
  const p = problem();
  const depot = town.nodes[town.depot];

  const routes = cells.map((cell) => {
    const ids = plan.routes[cell];
    const crew = cellCrew(cell);
    const nodes = [town.depot, ...ids.map((id) => p.node[p.index.get(id)!]), town.depot];
    const off = (crew - 1.5) * px(2.2);
    return { cell, crew, ids, sig: `${cell}:${ids.join(',')}`, pts: ids.length ? routePoints(nodes, off, off) : '' };
  });
  const ordered = [...routes].sort((a, b) => Number(a.cell === focus) - Number(b.cell === focus));
  const selJob = job ? jobById(job) : undefined;
  const selInRoutes = !!(job && routes.some((r) => r.ids.includes(job)));
  const r = px(7.2);

  return (
    <div class="map" ref={ref}>
      {w > 4 && h > 4 && (
        <svg
          viewBox={`0 0 ${town.W} ${town.H}`}
          preserveAspectRatio="xMidYMid meet"
          role="img"
          aria-label={label ?? 'Map of routes'}
          style={{ '--u': 1 / kr }}
        >
          {base}
          {ordered.map((rt) => {
            const dim = focus !== null && rt.cell !== focus;
            return (
              rt.pts && (
                <g key={rt.sig} class={`route-g${dim ? ' dim' : ''}`}>
                  <polyline
                    class="route-case"
                    points={rt.pts}
                    pathLength={1}
                    fill="none"
                    stroke="#fff"
                    stroke-width={px(dim ? 3.4 : 5.6)}
                    stroke-linejoin="round"
                    stroke-linecap="round"
                  />
                  <polyline
                    class="route"
                    points={rt.pts}
                    pathLength={1}
                    fill="none"
                    stroke={CREWS[rt.crew].color}
                    stroke-width={px(dim ? 2 : 3)}
                    stroke-linejoin="round"
                    stroke-linecap="round"
                  />
                </g>
              )
            );
          })}
          <g class="depot">
            <rect x={depot.x - px(6)} y={depot.y - px(6)} width={px(12)} height={px(12)} fill="var(--ink)" />
            <rect x={depot.x - px(2.2)} y={depot.y - px(2.2)} width={px(4.4)} height={px(4.4)} fill="#fff" />
            <text class="m-yard" x={depot.x + px(10)} y={depot.y - px(8)} font-size={px(9.5)}>
              Yard
            </text>
          </g>
          {ordered.map((rt) => {
            const dim = focus !== null && rt.cell !== focus;
            const crew = CREWS[rt.crew];
            return rt.ids.map((id, i) => {
              const n = town.nodes[p.node[p.index.get(id)!]];
              const done = checks?.[id];
              const sel = id === job;
              return (
                <g
                  key={`${rt.cell}-${id}`}
                  class={`stop${dim ? ' dim' : ''}`}
                  transform={`translate(${n.x} ${n.y})`}
                  onClick={() => !store.state.attract && select({ job: id })}
                >
                  {sel && <circle r={r * 1.9} fill="none" stroke="var(--ink)" stroke-width={px(2)} />}
                  <path
                    d={shapePath(crew.shape, r)}
                    fill={done ? 'var(--paper)' : crew.color}
                    stroke={done ? crew.color : 'var(--paper)'}
                    stroke-width={px(done ? 2 : 1.2)}
                  />
                  <text
                    class="m-stop n"
                    y={px(crew.shape === 'triangle' ? 3.6 : 3)}
                    font-size={px(8.5)}
                    text-anchor="middle"
                    fill={done ? crew.color : '#fff'}
                  >
                    {i + 1}
                  </text>
                </g>
              );
            });
          })}
          {selJob && !selInRoutes && (
            <g transform={`translate(${town.nodes[selJob.node].x} ${town.nodes[selJob.node].y})`} class="pin">
              <circle r={r * 1.9} fill="none" stroke="var(--ink)" stroke-width={px(2)} />
              <circle r={r * 0.8} fill="var(--paper)" stroke="var(--ink)" stroke-width={px(2)} />
              <text class="m-small" x={r * 2.4} y={px(3)} font-size={px(9)}>
                {selJob.customer}
              </text>
            </g>
          )}
        </svg>
      )}
    </div>
  );
}
