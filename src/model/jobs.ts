import { mulberry32, pick, shuffle } from './rng';
import type { Town } from './town';

export const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'];
export const DAYS_SHORT = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'];
export const DAY_COUNT = 5;
/** Length of a crew day in minutes, from 8:00 to 16:00, driving included. */
export const DAY_MIN = 480;
export const DAY_START_HOUR = 8;

export type Skill = 'tree' | 'irrigation' | 'stone';
export type Shape = 'circle' | 'square' | 'diamond' | 'triangle';

export interface Crew {
  id: number;
  lead: string;
  color: string;
  colorName: string;
  shape: Shape;
  skills: Skill[];
}

export const CREWS: Crew[] = [
  { id: 0, lead: 'Marta', color: '#d64b2a', colorName: 'vermilion', shape: 'circle', skills: ['tree', 'stone'] },
  { id: 1, lead: 'Owen', color: '#2a57c9', colorName: 'cobalt', shape: 'square', skills: ['irrigation'] },
  { id: 2, lead: 'Tomás', color: '#1f7a4d', colorName: 'pine', shape: 'diamond', skills: ['irrigation', 'stone'] },
  { id: 3, lead: 'Priya', color: '#7a3e9d', colorName: 'plum', shape: 'triangle', skills: ['tree'] },
];
export const CREW_COUNT = CREWS.length;

export const SKILL_LABEL: Record<Skill, string> = {
  tree: 'Tree crew',
  irrigation: 'Irrigation crew',
  stone: 'Stonework crew',
};
export const SKILL_NEED: Record<Skill, string> = {
  tree: 'Needs a tree crew',
  irrigation: 'Needs an irrigation crew',
  stone: 'Needs a stonework crew',
};

export type JobType = 'mowing' | 'hedge' | 'cleanup' | 'planting' | 'tree' | 'irrigation' | 'patio';

export const JOB_TYPES: Record<JobType, { label: string; min: number; max: number; skill: Skill | null }> = {
  mowing: { label: 'Mowing', min: 45, max: 90, skill: null },
  hedge: { label: 'Hedge trimming', min: 60, max: 135, skill: null },
  cleanup: { label: 'Garden cleanup', min: 60, max: 120, skill: null },
  planting: { label: 'Planting', min: 60, max: 165, skill: null },
  tree: { label: 'Tree work', min: 105, max: 210, skill: 'tree' },
  irrigation: { label: 'Irrigation repair', min: 60, max: 135, skill: 'irrigation' },
  patio: { label: 'Stonework', min: 165, max: 270, skill: 'stone' },
};
export const JOB_TYPE_ORDER: JobType[] = ['mowing', 'hedge', 'cleanup', 'planting', 'tree', 'irrigation', 'patio'];

export type TimeWindow = 'am' | 'pm';
/** Minutes after 8:00. A morning job must be finished by 12:00; an afternoon job starts at 13:00 or later. */
export const WINDOWS: Record<TimeWindow, { start: number; end: number; label: string; short: string }> = {
  am: { start: 0, end: 240, label: 'Mornings only', short: 'Mornings' },
  pm: { start: 300, end: 100000, label: 'Afternoons only', short: 'Afternoons' },
};

export interface Job {
  id: string;
  type: JobType;
  customer: string;
  node: number;
  address: string;
  district: number;
  dur: number;
  window: TimeWindow | null;
  /** Allowed weekdays (0 is Monday), or null for any day. */
  days: number[] | null;
  added?: boolean;
}

export interface Plan {
  /** routes[crew * DAY_COUNT + day] is that crew's ordered list of job ids for that day. */
  routes: string[][];
  backlog: string[];
}

export const cellIndex = (crew: number, day: number) => crew * DAY_COUNT + day;
export const cellCrew = (cell: number) => Math.floor(cell / DAY_COUNT);
export const cellDay = (cell: number) => cell % DAY_COUNT;

export function daysLabel(days: number[] | null): string | null {
  if (!days || days.length >= DAY_COUNT) return null;
  if (days.length === 1) return `${DAYS[days[0]]} only`;
  if (days.length === DAY_COUNT - 1) {
    const missing = [0, 1, 2, 3, 4].find((d) => !days.includes(d))!;
    return `Not ${DAYS[missing]}`;
  }
  if (days.length === 2) return `${DAYS[days[0]]} or ${DAYS[days[1]]}`;
  return days.map((d) => DAYS_SHORT[d]).join(', ');
}

export function daysShort(days: number[] | null): string | null {
  if (!days || days.length >= DAY_COUNT) return null;
  if (days.length === 1) return `${DAYS_SHORT[days[0]]} only`;
  if (days.length === DAY_COUNT - 1) {
    const missing = [0, 1, 2, 3, 4].find((d) => !days.includes(d))!;
    return `Not ${DAYS_SHORT[missing]}`;
  }
  return days.map((d) => DAYS_SHORT[d]).join(' or ');
}

const FIRST = [
  'Ana',
  'Ben',
  'Carla',
  'Dmitri',
  'Elena',
  'Farid',
  'Grace',
  'Hiro',
  'Imani',
  'Jonas',
  'Kofi',
  'Lena',
  'Mateo',
  'Nadia',
  'Oscar',
  'Pia',
  'Rafael',
  'Sana',
  'Theo',
  'Uma',
  'Victor',
  'Wren',
  'Yusuf',
  'Zoe',
  'Agnes',
  'Bruno',
  'Celine',
  'Esther',
  'Felix',
  'Greta',
  'Hamid',
  'Iris',
  'Joel',
  'Keiko',
  'Leon',
  'Mira',
  'Nils',
  'Olu',
  'Paula',
  'Ruth',
  'Samir',
  'Tess',
  'Ingrid',
  'Arjun',
  'Bea',
  'Colm',
  'Delia',
  'Emil',
  'Fiona',
  'Gus',
  'Hana',
  'Ivo',
];
const LAST = [
  'Abbott',
  'Brennan',
  'Castillo',
  'Dimitrov',
  'Eklund',
  'Ferreira',
  'Gallagher',
  'Haddad',
  'Ibarra',
  'Jansen',
  'Kowalski',
  'Lindqvist',
  'Moreau',
  'Nakamura',
  'Okafor',
  'Petrov',
  'Rasmussen',
  'Szabo',
  'Tanaka',
  'Uddin',
  'Varga',
  'Whitlock',
  'Yilmaz',
  'Zielinski',
  'Achebe',
  'Bianchi',
  'Corrigan',
  'Engel',
  'Fitzroy',
  'Gruber',
  'Holm',
  'Iqbal',
  'Jovanovic',
  'Keane',
  'Larsen',
  'Mbeki',
  'Novak',
  'Oyelaran',
  'Pereira',
  'Quint',
  'Rossi',
  'Sorensen',
  'Takahashi',
  'Ueda',
  'Vance',
  'Weller',
  'Amari',
  'Barros',
  'Crane',
  'Dunmore',
  'Ellery',
  'Ferro',
];

export const JOB_SEED = 7311;
export const JOB_COUNT = 60;

const TYPE_BAG: Array<[JobType, number]> = [
  ['mowing', 16],
  ['hedge', 9],
  ['cleanup', 7],
  ['planting', 8],
  ['tree', 7],
  ['irrigation', 7],
  ['patio', 6],
];

const DAY_PATTERNS: number[][] = [[3, 4], [0, 1], [0, 1, 2, 3], [2], [1, 3], [3, 4], [1, 2, 3, 4], [0, 2], [4], [2, 3]];

export function addressFor(town: Town, node: number, rng: () => number): string {
  const p = town.nodes[node];
  const num = 12 + p.i * 40 + Math.floor(rng() * 18) * 2 + (p.j % 2);
  return `${num} ${town.rowNames[p.j]}`;
}

export function makeCustomer(rng: () => number, used: Set<string>): string {
  for (let k = 0; k < 200; k++) {
    const name = `${pick(rng, FIRST)} ${pick(rng, LAST)}`;
    if (!used.has(name)) {
      used.add(name);
      return name;
    }
  }
  return `${pick(rng, FIRST)} ${pick(rng, LAST)}`;
}

function roundTo(x: number, step: number) {
  return Math.round(x / step) * step;
}

/** The seeded week: 60 jobs listed in the order the phone rang. */
export function generateJobs(town: Town, seed = JOB_SEED): Job[] {
  const rng = mulberry32(seed);
  const types: JobType[] = [];
  for (const [t, c] of TYPE_BAG) for (let k = 0; k < c; k++) types.push(t);
  shuffle(rng, types);

  // Job sites: distinct nodes spread over the town, never at the yard.
  const candidates = town.nodes.map((_, k) => k).filter((k) => k !== town.depot);
  shuffle(rng, candidates);
  const usedNames = new Set<string>();
  const jobs: Job[] = [];
  for (let k = 0; k < JOB_COUNT; k++) {
    const type = types[k];
    const spec = JOB_TYPES[type];
    const node = candidates[k];
    const dur = roundTo(spec.min + rng() * (spec.max - spec.min), 15);
    jobs.push({
      id: `J${String(k + 1).padStart(2, '0')}`,
      type,
      customer: makeCustomer(rng, usedNames),
      node,
      address: addressFor(town, node, rng),
      district: town.nodes[node].district,
      dur,
      window: null,
      days: null,
    });
  }

  // Constraints: some time windows, some day restrictions.
  const order = shuffle(
    rng,
    jobs.map((_, k) => k),
  );
  let am = 0;
  let pm = 0;
  let dayed = 0;
  for (const k of order) {
    const j = jobs[k];
    if (am < 8 && j.dur <= 165) {
      j.window = 'am';
      am++;
    } else if (pm < 5 && j.dur <= 120) {
      j.window = 'pm';
      pm++;
    } else if (dayed < DAY_PATTERNS.length) {
      j.days = DAY_PATTERNS[dayed].slice();
      dayed++;
    }
    if (am >= 8 && pm >= 5 && dayed >= DAY_PATTERNS.length) break;
  }
  return jobs;
}

export const INITIAL_BACKLOG = 3;

/**
 * The week as it would look if every job went onto the board in the order the phone rang:
 * crews take turns, the days fill up from Monday, and the last few calls are not placed yet.
 */
export function phoneOrderPlan(jobs: Job[]): Plan {
  const routes: string[][] = Array.from({ length: CREW_COUNT * DAY_COUNT }, () => []);
  const placed = jobs.length - INITIAL_BACKLOG;
  const perDay = placed / DAY_COUNT;
  for (let k = 0; k < placed; k++) {
    const day = Math.min(DAY_COUNT - 1, Math.floor(k / perDay));
    routes[cellIndex(k % CREW_COUNT, day)].push(jobs[k].id);
  }
  return { routes, backlog: jobs.slice(placed).map((j) => j.id) };
}

export function clonePlan(p: Plan): Plan {
  return { routes: p.routes.map((r) => r.slice()), backlog: p.backlog.slice() };
}
