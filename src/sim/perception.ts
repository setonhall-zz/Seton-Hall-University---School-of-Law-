import { CFG } from './config';
import { addMemory, findMemory } from './memory';
import { canPerceive, dist } from './nav';
import { clamp, rnd } from './rng';
import { emit } from './world';
import type { Creature, World } from './types';

// Perception is the only door into a creature's mind: range + line of sight
// for sight, range alone for sound, and an attention roll on top.

export function hasAccess(w: World, c: Creature, x: number, y: number): boolean {
  return !c.asleep && canPerceive(w, c.x, c.y, c.perception, x, y);
}

export function attentionProb(c: Creature, actorId: string, x: number, y: number, boost = 0): number {
  if (c.asleep) return 0;
  const trust = c.relations[actorId]?.trust ?? 0.2;
  let p = 0.3 + 0.42 * c.traits.curiosity + 0.2 * trust + boost;
  if (c.needs.food > 0.85) p *= 0.5;
  p *= 1 - 0.35 * clamp(dist(c.x, c.y, x, y) / c.perception);
  return clamp(p, 0, 0.95);
}

// Periodic look-around: remember food, notice things the hand has touched.
export function scan(w: World, c: Creature): void {
  if (c.asleep) return;
  for (const id in w.objects) {
    const o = w.objects[id];
    if (o.carriedBy || !canPerceive(w, c.x, c.y, c.perception, o.x, o.y)) continue;
    if (o.kind === 'bush' || o.kind === 'fruit' || o.kind === 'clam') {
      const m = findMemory(c, 'food', { objId: id });
      if (m) { m.outcome = o.food > 0 ? 1 : 0; m.tick = w.tick; m.x = o.x; m.y = o.y; }
      else addMemory(w, c, { kind: 'food', actor: 'world', objId: id, x: o.x, y: o.y, outcome: o.food > 0 ? 1 : 0, salience: 0.5 });
    }
    const prev = c.seen[id] ?? -2;
    if (o.novelTick >= 0 && prev < o.novelTick) {
      const ev = emit(w, 'notice', c.id, o.x, o.y, { objId: id, kind: o.kind }, o.causeEvent ? [o.causeEvent] : []);
      w.fx.push({ type: 'notice', x: c.x, y: c.y, tick: w.tick, id: c.id });
      const sal = clamp((o.kind === 'lumen' ? 0.85 : 0.55) + 0.2 * c.traits.curiosity);
      const m = findMemory(c, 'novelty', { objId: id });
      if (m) { m.salience = sal; m.x = o.x; m.y = o.y; m.tick = w.tick; m.sourceEvents = [ev]; }
      else addMemory(w, c, { kind: 'novelty', actor: 'hand', objId: id, x: o.x, y: o.y, salience: sal, sourceEvents: [ev] });
    }
    c.seen[id] = w.tick;
  }
}

// A sound carries without line of sight but only draws attention; it cannot
// teach a behaviour by itself.
export function hear(w: World, x: number, y: number, source: string, cause: string): void {
  for (const c of w.creatures) {
    if (c.id === source || c.asleep || dist(c.x, c.y, x, y) > CFG.hearRadius) continue;
    if (rnd(w) > 0.35 + 0.5 * c.traits.curiosity) continue;
    const ev = emit(w, 'hear', c.id, x, y, { source }, [cause]);
    addMemory(w, c, { kind: 'novelty', actor: source, x: Math.round(x), y: Math.round(y), salience: clamp(0.35 + 0.35 * c.traits.curiosity - (source === 'hand' ? 0.2 * c.traits.caution : 0)), sourceEvents: [ev] });
  }
}
