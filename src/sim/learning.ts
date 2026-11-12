import { CFG } from './config';
import { mutate } from './behavior';
import { onTransmit } from './culture';
import { addMemory, findMemory } from './memory';
import { attentionProb } from './perception';
import { clamp, rnd } from './rng';
import { emit } from './world';
import type { Creature, World } from './types';

// Social learning: observation -> memory -> (maybe) adoption -> (maybe)
// imperfect copy. Every step leaves an event with causal parents.

export function observeBehavior(w: World, c: Creature, actorId: string, behaviorId: string, cause: string, yielded: boolean, crowd: number, boost = 0): string | null {
  const b = w.behaviors[behaviorId];
  if (!b || c.id === actorId) return null;
  const actor = actorId === 'hand' ? null : w.creatures.find(k => k.id === actorId);
  const ax = actor ? actor.x : b.x, ay = actor ? actor.y : b.y;
  if (rnd(w) >= attentionProb(c, actorId, ax, ay, boost)) return null;
  // habituation: a sight seen many times stops drawing the eye
  const known = findMemory(c, 'behavior', { behaviorId });
  if (known && known.count > 4 && rnd(w) < 0.65) return null;
  const ev = emit(w, 'observe', c.id, ax, ay, { actor: actorId, behaviorId, rootId: b.rootId }, [cause]);
  if (actorId === 'hand') w.fx.push({ type: 'notice', x: c.x, y: c.y, tick: w.tick, id: c.id });
  let m = findMemory(c, 'behavior', { behaviorId });
  if (!m) m = addMemory(w, c, { kind: 'behavior', actor: actorId, behaviorId, x: b.x, y: b.y, salience: 0.5 });
  else { m.count++; m.tick = w.tick; m.actor = actorId; if (!m.actors.includes(actorId)) m.actors.push(actorId); }
  m.salience = clamp(m.salience + 0.3);
  m.outcome = Math.max(m.outcome * 0.8, clamp((yielded ? 0.7 : 0) + 0.15 * Math.min(crowd, 3)));
  m.sourceEvents.push(ev); if (m.sourceEvents.length > 6) m.sourceEvents.shift();
  const trust = c.relations[actorId]?.trust ?? 0.2;
  m.confidence += (actorId === 'hand' ? 0.6 : 0.2) + (actorId === 'hand' ? 0.45 : 0.38) * c.traits.curiosity + 0.2 * trust;
  if (CFG.learningEnabled) tryAdopt(w, c, m.id);
  return ev;
}

function tryAdopt(w: World, c: Creature, memId: number): void {
  const m = c.memories.find(x => x.id === memId)!;
  const b = w.behaviors[m.behaviorId!];
  const mine = c.repertoire.find(e => w.behaviors[e.behaviorId].rootId === b.rootId);
  if (mine) {
    if (mine.behaviorId === b.id) { mine.value = clamp(mine.value + 0.05); return; }
    // already keeps a different variant: only a strong conformist is pulled across
    if (!(m.count >= 2 && rnd(w) < c.traits.conformity * 0.5)) return;
  }
  if (m.confidence < 1) return;
  const trust = c.relations[m.actor]?.trust ?? 0.2;
  const pop = clamp((m.actors.length - 1) / 3);
  const p = clamp((m.actor === 'hand' ? 0.22 : 0.08) + 0.36 * c.traits.curiosity + 0.26 * trust + 0.3 * c.traits.conformity * pop + 0.25 * m.outcome
    - (m.actor === 'hand' && trust < 0.3 ? 0.2 * c.traits.caution : 0), 0.05, 0.95) / (1 + 0.6 * c.repertoire.length);
  if (rnd(w) >= p) {
    m.confidence = 0.2;
    emit(w, 'reject', c.id, b.x, b.y, { actor: m.actor, behaviorId: b.id, rootId: b.rootId }, m.sourceEvents.slice(-2));
    return;
  }
  adopt(w, c, m.id);
}

export function adopt(w: World, c: Creature, memId: number, forceMutate?: boolean): string {
  const m = c.memories.find(x => x.id === memId)!;
  const src = w.behaviors[m.behaviorId!];
  const adoptEv = emit(w, 'adopt', c.id, src.x, src.y, { from: m.actor, behaviorId: src.id, rootId: src.rootId }, m.sourceEvents.slice());
  let b = src;
  const pm = clamp(0.14 + 0.45 * c.traits.creativity - 0.2 * c.traits.conformity, 0.04, 0.55);
  if (forceMutate ?? rnd(w) < pm) {
    const child = mutate(w, src, c.id, adoptEv);
    if (child) {
      b = child;
      emit(w, 'mutate', c.id, child.x, child.y, { parentId: src.id, behaviorId: child.id, rootId: child.rootId, change: child.change }, [adoptEv]);
    }
  }
  let depth = 0;
  if (m.actor !== 'hand') {
    const teacher = w.creatures.find(k => k.id === m.actor);
    const te = teacher?.repertoire.find(e => w.behaviors[e.behaviorId].rootId === src.rootId);
    depth = (te?.depth ?? 0) + 1;
  }
  c.repertoire = c.repertoire.filter(e => w.behaviors[e.behaviorId].rootId !== src.rootId);
  if (c.repertoire.length >= CFG.repertoireCap) {
    c.repertoire.sort((a, z) => z.value - a.value);
    const dropped = c.repertoire.pop()!;
    forget(w, c, dropped.behaviorId, 'crowded out');
  }
  c.repertoire.push({ behaviorId: b.id, value: clamp(0.5 + 0.25 * m.outcome), from: m.actor, adoptEvent: adoptEv, performances: 0, last: -9999, depth });
  m.confidence = 0;
  if (m.actor !== 'hand') {
    const tr = emit(w, 'transmit', c.id, src.x, src.y, { from: m.actor, to: c.id, behaviorId: b.id, sourceBehavior: src.id, rootId: src.rootId, depth }, [adoptEv, ...m.sourceEvents.slice(-2)]);
    onTransmit(w, tr, src.rootId);
  }
  return adoptEv;
}

export function forget(w: World, c: Creature, behaviorId: string, why: string): string {
  const b = w.behaviors[behaviorId];
  return emit(w, 'forget', c.id, b.x, b.y, { behaviorId, rootId: b.rootId, why });
}
