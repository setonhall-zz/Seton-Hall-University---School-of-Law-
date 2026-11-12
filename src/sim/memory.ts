import { CFG } from './config';
import type { Creature, Memory, World } from './types';

// Bounded, decaying memory. Reinforcement happens where memories are touched
// (perception/learning); this module owns storage, decay and pruning.

export function findMemory(c: Creature, kind: Memory['kind'], key: { behaviorId?: string; objId?: string }): Memory | undefined {
  return c.memories.find(m => m.kind === kind && (key.behaviorId ? m.behaviorId === key.behaviorId : m.objId === key.objId));
}

export function addMemory(w: World, c: Creature, m: Partial<Memory> & Pick<Memory, 'kind' | 'x' | 'y' | 'actor'>): Memory {
  const mem: Memory = {
    id: c.memSeq++, actors: [m.actor], behaviorId: null, objId: null, tick: w.tick, salience: 0.5, confidence: 0, outcome: 0, count: 1, sourceEvents: [], ...m,
  };
  c.memories.push(mem);
  if (c.memories.length > CFG.memoryCap) {
    // forget the least salient thing that is not what we just stored
    let wi = -1, ws = Infinity;
    c.memories.forEach((x, i) => { const s = x.salience + (x.kind === 'food' ? 0.3 : 0); if (x !== mem && s < ws) { ws = s; wi = i; } });
    if (wi >= 0) c.memories.splice(wi, 1);
  }
  return mem;
}

export function decayMemories(w: World, c: Creature): void {
  c.memories = c.memories.filter(m => {
    if (m.objId && !w.objects[m.objId]) return false;
    if (m.kind === 'food') return true;
    m.salience *= 0.8; m.confidence *= 0.92;
    return m.salience > 0.06;
  });
  for (const id in c.seen) if (!w.objects[id]) delete c.seen[id];
}
