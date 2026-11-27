import { describe, expect, it } from 'vitest';
import { buildTown, shortestPath, riverSideOf, UNIT_M } from '../../src/model/town';

const town = buildTown();
const n = town.n;

describe('road graph', () => {
  it('is identical on every build', () => {
    const again = buildTown();
    expect(again.n).toBe(n);
    expect(again.edges.length).toBe(town.edges.length);
    expect(Array.from(again.tt)).toEqual(Array.from(town.tt));
  });

  it('is one connected piece', () => {
    for (let t = 0; t < n; t++) expect(Number.isFinite(town.exact[t])).toBe(true);
  });

  it('has symmetric travel times because streets run both ways', () => {
    for (let a = 0; a < n; a += 7)
      for (let b = 0; b < n; b += 5) expect(town.exact[a * n + b]).toBeCloseTo(town.exact[b * n + a], 9);
  });

  it('satisfies the triangle inequality (shortest paths really are shortest)', () => {
    for (let a = 0; a < n; a += 9)
      for (let b = 0; b < n; b += 11)
        for (let c = 0; c < n; c += 13) {
          expect(town.exact[a * n + c]).toBeLessThanOrEqual(town.exact[a * n + b] + town.exact[b * n + c] + 1e-9);
        }
  });

  it('reconstructs paths whose edge times add up to the shortest time', () => {
    const edgeTime = new Map<string, number>();
    for (const e of town.edges) {
      edgeTime.set(`${e.a}-${e.b}`, e.time);
      edgeTime.set(`${e.b}-${e.a}`, e.time);
    }
    for (let a = 0; a < n; a += 17)
      for (let b = 3; b < n; b += 19) {
        const path = shortestPath(town, a, b);
        expect(path[0]).toBe(a);
        expect(path[path.length - 1]).toBe(b);
        let sum = 0;
        for (let k = 0; k < path.length - 1; k++) {
          const t = edgeTime.get(`${path[k]}-${path[k + 1]}`);
          expect(t).toBeDefined();
          sum += t!;
        }
        expect(sum).toBeCloseTo(town.exact[a * n + b], 9);
      }
  });

  it('rounds to whole minutes, with at least one minute between different places', () => {
    for (let a = 0; a < n; a += 5)
      for (let b = 0; b < n; b += 3) {
        const v = town.tt[a * n + b];
        expect(Number.isInteger(v)).toBe(true);
        if (a !== b) expect(v).toBeGreaterThanOrEqual(1);
        expect(Math.abs(v - town.exact[a * n + b])).toBeLessThanOrEqual(0.5);
      }
  });
});

describe('river and bridges', () => {
  const bridgeEdges = new Set(town.bridges.map((b) => b.edge));

  it('has exactly two bridges, each joining the two banks', () => {
    expect(town.bridges.length).toBe(2);
    for (const b of town.bridges) {
      const e = town.edges[b.edge];
      expect(e.kind).toBe('bridge');
      expect(riverSideOf(town, e.a)).not.toBe(riverSideOf(town, e.b));
    }
  });

  it('has no other edge crossing the water', () => {
    town.edges.forEach((e, k) => {
      if (bridgeEdges.has(k)) return;
      expect(riverSideOf(town, e.a)).toBe(riverSideOf(town, e.b));
    });
  });

  it('routes every crossing over one of the bridges', () => {
    const bridgePairs = new Set<string>();
    for (const k of bridgeEdges) {
      const e = town.edges[k];
      bridgePairs.add(`${e.a}-${e.b}`);
      bridgePairs.add(`${e.b}-${e.a}`);
    }
    let crossings = 0;
    for (let a = 0; a < n; a += 4)
      for (let b = 1; b < n; b += 6) {
        if (riverSideOf(town, a) === riverSideOf(town, b)) continue;
        crossings++;
        const path = shortestPath(town, a, b);
        const used = path.slice(1).some((v, k) => bridgePairs.has(`${path[k]}-${v}`));
        expect(used).toBe(true);
      }
    expect(crossings).toBeGreaterThan(100);
  });

  it('forces a detour for neighbours that face each other across the water', () => {
    // Nodes in the same column on opposite banks, away from the bridge columns.
    let checked = 0;
    for (const col of [2, 10, 18]) {
      const inCol = town.nodes.map((p, k) => ({ p, k })).filter(({ p }) => p.i === col);
      const north = inCol.filter(({ k }) => riverSideOf(town, k) < 0).sort((a, b) => b.p.y - a.p.y)[0];
      const south = inCol.filter(({ k }) => riverSideOf(town, k) > 0).sort((a, b) => a.p.y - b.p.y)[0];
      if (!north || !south) continue;
      const straight = (Math.hypot(north.p.x - south.p.x, north.p.y - south.p.y) * UNIT_M) / 500;
      const actual = town.exact[north.k * n + south.k];
      expect(actual).toBeGreaterThan(straight * 2);
      checked++;
    }
    expect(checked).toBeGreaterThanOrEqual(2);
  });

  it('disconnects the two banks when the bridges are removed', () => {
    const seen = new Uint8Array(n);
    const stack = [0];
    seen[0] = 1;
    while (stack.length) {
      const u = stack.pop()!;
      for (const k of town.adj[u]) {
        if (bridgeEdges.has(k)) continue;
        const e = town.edges[k];
        const v = e.a === u ? e.b : e.a;
        if (!seen[v]) {
          seen[v] = 1;
          stack.push(v);
        }
      }
    }
    const side0 = riverSideOf(town, 0);
    for (let v = 0; v < n; v++) expect(seen[v] === 1).toBe(riverSideOf(town, v) === side0);
  });
});
