import { CFG, PHASES } from './config';
import { dist, inb, isLand, placeName, terr, walkable } from './nav';
import { pick, rint, rnd } from './rng';
import { T_SHALLOWS, type Behavior, type Shape, type Step, type World } from './types';

// A behaviour is a small structured signature: what is done (steps), where,
// when, how many times and in what arrangement. Culture is built out of these.

export const isPlace = (s: Step) => s.startsWith('place:');
export const placeKind = (s: Step) => s.slice(6) as 'stone' | 'shell' | 'lumen';

export function shallowsNear(w: World, x: number, y: number, r = 2): { x: number; y: number } | null {
  let best: { x: number; y: number } | null = null, bd = Infinity;
  for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
    const nx = x + dx, ny = y + dy;
    if (inb(w, nx, ny) && terr(w, nx, ny) === T_SHALLOWS) { const d = dx * dx + dy * dy; if (d < bd) { bd = d; best = { x: nx, y: ny }; } }
  }
  return best;
}

export function validAt(w: World, steps: Step[], x: number, y: number): boolean {
  if (!inb(w, x, y) || !walkable(w, x, y)) return false;
  if (steps.includes('splash') && !shallowsNear(w, x, y, 2)) return false;
  if (!steps.every(s => s === 'splash') && !isLand(w, x, y)) return false;
  return true;
}

export function newBehavior(w: World, p: { steps: Step[]; x: number; y: number; phase?: Behavior['phase']; count?: number; shape?: Shape; creator: string; origin: string; parent?: Behavior; change?: string }): Behavior {
  const id = 'b' + w.nextId++;
  const b: Behavior = {
    id, rootId: p.parent ? p.parent.rootId : id, parentId: p.parent ? p.parent.id : null,
    steps: p.steps.slice(), x: p.x, y: p.y, phase: p.phase ?? 'any', count: p.count ?? 1, shape: p.shape ?? 'pile',
    creator: p.creator, origin: p.origin, change: p.change ?? null, bornTick: w.tick,
  };
  w.behaviors[id] = b;
  return b;
}

// One bounded change to exactly one parameter. Returns null if no valid
// mutation was found (the copy is then faithful).
export function mutate(w: World, b: Behavior, creator: string, origin: string): Behavior | null {
  const M = CFG.mutation;
  for (let attempt = 0; attempt < 6; attempt++) {
    const kinds = ['shift', 'shift', 'phase', 'count', 'sequence', 'sequence'];
    if (b.steps.some(isPlace)) kinds.push('shape');
    const k = pick(w, kinds);
    if (k === 'shift') {
      const dx = rint(w, M.maxShift * 2 + 1) - M.maxShift, dy = rint(w, M.maxShift * 2 + 1) - M.maxShift;
      const x = b.x + dx, y = b.y + dy;
      if ((dx || dy) && validAt(w, b.steps, x, y)) return newBehavior(w, { ...b, x, y, creator, origin, parent: b, change: `moved to ${placeName(w, x, y)}` });
    } else if (k === 'phase') {
      const cur = b.phase;
      const opts = cur === 'any' ? PHASES.filter(p => p !== 'night') : [PHASES[(PHASES.indexOf(cur) + 1) % 4], PHASES[(PHASES.indexOf(cur) + 3) % 4]].filter(p => p !== 'night');
      const phase = pick(w, opts);
      if (phase !== cur) return newBehavior(w, { ...b, phase, creator, origin, parent: b, change: `now kept at ${phase}` });
    } else if (k === 'count') {
      const count = b.count + (rnd(w) < 0.65 ? 1 : -1);
      if (count >= 1 && count <= M.maxCount) return newBehavior(w, { ...b, count, creator, origin, parent: b, change: count > b.count ? `repeated ${count} times` : `shortened to ${count}` });
    } else if (k === 'shape') {
      const shape = pick(w, (['pile', 'ring', 'line'] as Shape[]).filter(s => s !== b.shape));
      return newBehavior(w, { ...b, shape, creator, origin, parent: b, change: `arranged as a ${shape}` });
    } else {
      const steps = b.steps.slice();
      const r = rnd(w);
      let change = '';
      if (r < 0.5 && steps.length < M.maxSteps) {
        const add = pick(w, (['call', 'dance', 'splash', 'place:stone', 'place:shell'] as Step[]).filter(s => !steps.includes(s)));
        if (rnd(w) < 0.5) steps.push(add); else steps.unshift(add);
        change = `added ${stepWord(add)}`;
      } else if (r < 0.7 && steps.length > 1) {
        const i = rint(w, steps.length); change = `dropped ${stepWord(steps[i])}`; steps.splice(i, 1);
      } else if (r < 0.85 && steps.length > 1) {
        steps.reverse(); change = 'reversed the order';
      } else {
        const i = steps.findIndex(s => s === 'place:stone' || s === 'place:shell');
        if (i >= 0) { steps[i] = steps[i] === 'place:stone' ? 'place:shell' : 'place:stone'; change = `uses a ${placeKind(steps[i])} instead`; }
      }
      if (change && validAt(w, steps, b.x, b.y)) return newBehavior(w, { ...b, steps, creator, origin, parent: b, change });
    }
  }
  return null;
}

// Used by tests and the lineage view: is `child` a legal single-step mutation of `parent`?
export function boundedDifference(parent: Behavior, child: Behavior): { ok: boolean; changed: string[] } {
  const changed: string[] = [];
  const M = CFG.mutation;
  let ok = true;
  if (parent.x !== child.x || parent.y !== child.y) { changed.push('place'); if (Math.abs(parent.x - child.x) > M.maxShift || Math.abs(parent.y - child.y) > M.maxShift) ok = false; }
  if (parent.phase !== child.phase) changed.push('phase');
  if (parent.count !== child.count) { changed.push('count'); if (Math.abs(parent.count - child.count) !== 1 || child.count < 1 || child.count > M.maxCount) ok = false; }
  if (parent.shape !== child.shape) changed.push('shape');
  if (parent.steps.join() !== child.steps.join()) { changed.push('sequence'); if (child.steps.length > M.maxSteps || child.steps.length < 1 || Math.abs(child.steps.length - parent.steps.length) > 1) ok = false; }
  if (changed.length !== 1) ok = false;
  return { ok, changed };
}

export function stepWord(s: Step): string {
  return s === 'splash' ? 'a splash' : s === 'call' ? 'a call' : s === 'dance' ? 'a turning dance' : `setting a ${placeKind(s)}`;
}
function stepVerb(s: Step, b: Behavior): string {
  if (s === 'splash') return 'splashes the water';
  if (s === 'call') return 'calls out';
  if (s === 'dance') return 'turns in a slow dance';
  return `sets a ${placeKind(s)}${b.shape === 'pile' ? '' : ` in a ${b.shape}`}`;
}
export function describeBehavior(w: World, b: Behavior): string {
  const parts = b.steps.map(s => stepVerb(s, b));
  let s = parts.length > 1 ? parts.slice(0, -1).join(', ') + ' then ' + parts[parts.length - 1] : parts[0];
  s += ` at ${placeName(w, b.x, b.y)}`;
  if (b.count > 1) s += `, ${b.count} times over`;
  if (b.phase !== 'any') s += `, at ${b.phase}`;
  return s;
}
export function shortName(w: World, b: Behavior): string {
  const main = b.steps.find(isPlace) ?? b.steps[0];
  const noun = main === 'splash' ? 'Water-waking' : main === 'call' ? 'Calling' : main === 'dance' ? 'Turning' : main === 'place:stone' ? 'Stone-setting' : main === 'place:shell' ? 'Shell-laying' : 'Light-keeping';
  return `${noun} of ${placeName(w, b.x, b.y).replace('the ', 'the ')}`;
}

// Where objects go for a "place" step, by arrangement.
export function slots(b: Behavior): [number, number][] {
  if (b.shape === 'ring') return [[1, 0], [0, 1], [-1, 0], [0, -1], [1, 1], [-1, 1], [-1, -1], [1, -1]].map(([dx, dy]) => [b.x + dx, b.y + dy]);
  if (b.shape === 'line') return [[0, 0], [1, 0], [-1, 0], [2, 0], [-2, 0], [3, 0], [-3, 0]].map(([dx, dy]) => [b.x + dx, b.y + dy]);
  return [[0, 0], [1, 0], [0, 1], [-1, 0], [0, -1], [1, 1], [-1, -1], [1, -1], [-1, 1]].map(([dx, dy]) => [b.x + dx, b.y + dy]);
}

// Infer the arrangement the hand has made around a tile.
export function inferShape(w: World, kind: string, x: number, y: number): Shape {
  const near = Object.values(w.objects).filter(o => o.kind === kind && !o.carriedBy && dist(o.x, o.y, x, y) <= 2.3);
  if (near.length >= 3) {
    const sameY = near.filter(o => o.y === y).length, sameX = near.filter(o => o.x === x).length;
    if (sameY >= 3 || sameX >= 3) return 'line';
    const mx = Math.round(near.reduce((s, o) => s + o.x, 0) / near.length), my = Math.round(near.reduce((s, o) => s + o.y, 0) / near.length);
    if (near.length >= 4 && !near.some(o => o.x === mx && o.y === my) && near.every(o => dist(o.x, o.y, mx, my) <= 1.6)) return 'ring';
  }
  return 'pile';
}

// A practice gets a word of its own, derived from its id, so two similar
// customs can still be told apart.
export function coinName(w: World, id: string): string {
  const syl = ['ka', 'lo', 'mi', 'ren', 'tu', 'sha', 'vo', 'ne', 'ul', 'ia', 'bri', 'om', 'the', 'wen', 'du', 'pa', 'hil', 'or', 'sa', 'ye'];
  let h = (w.seed * 2654435761 + parseInt(id.slice(1), 10) * 40503) >>> 0;
  let out = '';
  const n = 2 + (h % 2);
  for (let i = 0; i < n; i++) { out += syl[h % syl.length]; h = Math.imul(h ^ (h >>> 5), 2246822519) >>> 0; }
  return out[0].toUpperCase() + out.slice(1);
}
