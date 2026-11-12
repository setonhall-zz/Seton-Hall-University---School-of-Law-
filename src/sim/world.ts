import { CFG } from './config';
import { dist, idx, inb, isLand, walkable } from './nav';
import { fnv, hash2, rint, rnd } from './rng';
import { T_GRASS, T_GROVE, T_ROCK, T_SAND, T_SHALLOWS, T_WATER, type Act, type Creature, type Obj, type ObjKind, type SimEvent, type World } from './types';

export const DEFAULT_SEED = 7;

export function idleAct(tick = 0): Act {
  return { type: 'idle', stage: 0, timer: 0, tx: 0, ty: 0, targetId: null, bId: null, idx: 0, yielded: false, cause: null, since: tick };
}

export function emit(w: World, type: string, actor: string, x: number, y: number, data: Record<string, any> = {}, parents: string[] = []): string {
  const ev: SimEvent = { id: 'e' + w.eventSeq++, tick: w.tick, type, actor, x, y, data, parents };
  w.events.push(ev);
  return ev.id;
}
export function getEvent(w: World, id: string): SimEvent | undefined {
  const e = w.events[parseInt(id.slice(1), 10)];
  return e && e.id === id ? e : w.events.find(v => v.id === id);
}

export function addObj(w: World, kind: ObjKind, x: number, y: number, extra: Partial<Obj> = {}): Obj {
  const o: Obj = { id: 'o' + w.nextId++, kind, x, y, carriedBy: null, food: kind === 'bush' ? 3 : kind === 'fruit' || kind === 'clam' ? 1 : 0, regrowAt: 0, byHand: false, novelTick: -1, causeEvent: null, ...extra };
  w.objects[o.id] = o;
  return o;
}

function smooth(seed: number, x: number, y: number, scale: number): number {
  const fx = x / scale, fy = y / scale;
  const x0 = Math.floor(fx), y0 = Math.floor(fy);
  const tx = fx - x0, ty = fy - y0;
  const sx = tx * tx * (3 - 2 * tx), sy = ty * ty * (3 - 2 * ty);
  const a = hash2(seed, x0, y0), b = hash2(seed, x0 + 1, y0), c = hash2(seed, x0, y0 + 1), d = hash2(seed, x0 + 1, y0 + 1);
  return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
}

const CAST: [string, number, number, number, number, number, number][] = [
  // name, curiosity, sociability, creativity, conformity, caution, hue
  ['Pim', 0.92, 0.6, 0.5, 0.3, 0.2, 38],
  ['Oro', 0.42, 0.8, 0.2, 0.85, 0.5, 18],
  ['Sable', 0.6, 0.3, 0.9, 0.15, 0.4, 265],
  ['Fen', 0.76, 0.7, 0.4, 0.6, 0.3, 150],
  ['Lume', 0.52, 0.92, 0.3, 0.7, 0.2, 52],
  ['Brae', 0.3, 0.4, 0.2, 0.5, 0.9, 205],
  ['Tuck', 0.86, 0.5, 0.7, 0.35, 0.15, 330],
  ['Ysa', 0.56, 0.65, 0.55, 0.55, 0.55, 95],
];

export function createWorld(seed: number = DEFAULT_SEED): World {
  const W = CFG.W, H = CFG.H;
  const w: World = {
    version: CFG.SIM_VERSION, seed, rng: seed | 0, tick: 0, w: W, h: H, terrain: new Array(W * H).fill(T_WATER),
    objects: {}, nextId: 1, creatures: [], behaviors: {}, practices: {}, sites: [], siteTally: {}, eventSeq: 0, schedule: [], events: [], fx: [],
  };
  const cx = (W - 1) / 2, cy = (H - 1) / 2;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const d = dist(x, y, cx, cy) / (W / 2);
    const n = smooth(seed, x, y, 5) * 0.65 + smooth(seed + 11, x, y, 2.3) * 0.35;
    const e = 1 - d * 1.12 + (n - 0.5) * 0.55;
    let t = e < 0.14 ? T_WATER : e < 0.25 ? T_SHALLOWS : e < 0.35 ? T_SAND : T_GRASS;
    if (t === T_GRASS && d > 0.22) {
      if (smooth(seed + 23, x, y, 3.1) > 0.66) t = T_GROVE;
      else if (hash2(seed + 5, x, y) < 0.035) t = T_ROCK;
    }
    w.terrain[idx(w, x, y)] = t;
  }
  // keep one connected island: anything walkable but unreachable sinks.
  const start = idx(w, Math.round(cx), Math.round(cy));
  w.terrain[start] = T_GRASS;
  const seen = new Uint8Array(W * H); const q = [start]; seen[start] = 1;
  while (q.length) {
    const c = q.pop()!; const x = c % W, y = (c / W) | 0;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx, ny = y + dy;
      if (!inb(w, nx, ny) || !walkable(w, nx, ny)) continue;
      const ni = idx(w, nx, ny); if (seen[ni]) continue; seen[ni] = 1; q.push(ni);
    }
  }
  for (let i = 0; i < W * H; i++) if (!seen[i] && w.terrain[i] !== T_ROCK && w.terrain[i] !== T_WATER) w.terrain[i] = T_WATER;

  const taken: { x: number; y: number }[] = [];
  const scatter = (n: number, ok: (x: number, y: number) => boolean, gap: number, each: (x: number, y: number) => void) => {
    let placed = 0, tries = 0;
    while (placed < n && tries++ < 4000) {
      const x = rint(w, W), y = rint(w, H);
      if (!ok(x, y) || taken.some(p => dist(p.x, p.y, x, y) < gap)) continue;
      taken.push({ x, y }); each(x, y); placed++;
    }
  };
  const t = (x: number, y: number) => w.terrain[idx(w, x, y)];
  scatter(6, (x, y) => t(x, y) === T_GRASS && dist(x, y, cx, cy) > 2.5, 4, (x, y) => addObj(w, 'bush', x, y));
  scatter(9, (x, y) => (t(x, y) === T_GRASS || t(x, y) === T_SAND), 1.5, (x, y) => addObj(w, 'stone', x, y));
  scatter(4, (x, y) => t(x, y) === T_SAND, 2, (x, y) => addObj(w, 'shell', x, y));

  const homes: { x: number; y: number }[] = [];
  let tries = 0;
  while (homes.length < CAST.length && tries++ < 4000) {
    const x = rint(w, W), y = rint(w, H);
    if (t(x, y) !== T_GRASS || dist(x, y, cx, cy) > 6 || homes.some(p => dist(p.x, p.y, x, y) < 2.2) || taken.some(p => p.x === x && p.y === y)) continue;
    homes.push({ x, y });
  }
  CAST.forEach((c, i) => {
    const h = homes[i] ?? { x: Math.round(cx), y: Math.round(cy) };
    const j = () => (rnd(w) - 0.5) * 0.08;
    const cr: Creature = {
      id: 'c' + i, name: c[0], x: h.x, y: h.y, hx: h.x, hy: h.y, hue: c[6],
      traits: { curiosity: c[1] + j(), sociability: c[2] + j(), creativity: c[3] + j(), conformity: c[4] + j(), caution: c[5] + j() },
      needs: { food: 0.2 + rnd(w) * 0.4, rest: rnd(w) * 0.2, safety: 0, belonging: rnd(w) * 0.5, exploration: 0.2 + rnd(w) * 0.5 },
      perception: CFG.perception, memories: [], memSeq: 0, seen: {}, relations: {}, repertoire: [],
      act: idleAct(), path: [], carrying: null, asleep: false, scores: {}, inspired: null, lastExperimentDay: -1, face: 1,
    };
    w.creatures.push(cr);
  });
  for (const a of w.creatures) {
    a.relations.hand = { trust: 0.25, familiarity: 0 };
    for (const b of w.creatures) if (a !== b) {
      const near = dist(a.hx, a.hy, b.hx, b.hy) < 4.5;
      a.relations[b.id] = { trust: 0.3 + (near ? 0.2 : 0) + rnd(w) * 0.15, familiarity: near ? 0.5 : 0.2 };
    }
  }
  emit(w, 'world.begin', 'world', cx, cy, { seed });
  return w;
}

// --- snapshots -------------------------------------------------------------

export function snapshotBody(w: World): string {
  const { events, fx, ...body } = w;
  return JSON.stringify(body);
}
export function restoreWorld(body: string, events: SimEvent[]): World {
  const w = JSON.parse(body) as World;
  w.events = events; w.fx = [];
  return w;
}
export function worldHash(w: World): string { return fnv(snapshotBody(w)) + ':' + fnv(JSON.stringify(w.events)); }
export function eventLogHash(w: World): string { return fnv(JSON.stringify(w.events)); }

export const creature = (w: World, id: string) => w.creatures.find(c => c.id === id);
export const actorName = (w: World, id: string) => (id === 'hand' ? 'the hand' : id === 'self' ? 'itself' : creature(w, id)?.name ?? id);
export { isLand };
