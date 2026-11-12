import { CFG, dayOf } from './config';
import { coinName } from './behavior';
import { emit } from './world';
import type { Behavior, Creature, Practice, PracticeStatus, World } from './types';

// Culture is bookkeeping over real events. A practice only advances when
// performance and transmission records satisfy explicit thresholds; the
// passage of time can only ever make a practice decline.

const RANK: Record<PracticeStatus, number> = { forgotten: 0, declining: 1, emerging: 2, custom: 3, tradition: 4 };

export function holders(w: World, rootId: string): string[] {
  return w.creatures.filter(c => c.repertoire.some(e => w.behaviors[e.behaviorId]?.rootId === rootId)).map(c => c.id);
}

export function qualifies(p: Practice): PracticeStatus {
  const C = CFG.custom, T = CFG.tradition;
  const custom = p.performers.length >= C.performers && p.transmissions.length >= C.transmissions && p.performances >= C.performances && p.days.length >= C.days;
  const trad = custom && p.performers.length >= T.performers && p.performances >= T.performances && p.days.length >= T.days && p.maxDepth >= T.depth;
  return trad ? 'tradition' : custom ? 'custom' : 'emerging';
}

export function evaluate(w: World, p: Practice, cause: string | null): void {
  const day = dayOf(w.tick);
  let target: PracticeStatus = qualifies(p);
  if (holders(w, p.rootId).length === 0) target = 'forgotten';
  else if (day - p.lastDay >= CFG.declineDays) target = 'declining';
  if (target === p.status) return;
  const from = p.status;
  p.status = target;
  if (RANK[target] > RANK[p.peak]) p.peak = target;
  const evidence = [...(cause ? [cause] : []), ...p.transmissions.slice(-6), ...p.performEvents.slice(-4)];
  const root = w.behaviors[p.rootId];
  emit(w, 'practice.status', 'world', root.x, root.y, {
    practiceId: p.id, from, to: target,
    performers: p.performers.length, transmissions: p.transmissions.length, performances: p.performances, days: p.days.length, depth: p.maxDepth,
  }, [...new Set(evidence)]);
}

export function onPerform(w: World, evId: string, c: Creature, b: Behavior, depth: number): void {
  let p = w.practices[b.rootId];
  const root = w.behaviors[b.rootId];
  if (!p) {
    p = w.practices[b.rootId] = {
      id: b.rootId, rootId: b.rootId, name: coinName(w, root.id), originEvent: root.origin, status: 'emerging', peak: 'emerging',
      performers: [], performances: 0, performEvents: [], transmissions: [], days: [], maxDepth: 0, lastDay: dayOf(w.tick), variants: {},
    };
    emit(w, 'practice.begin', c.id, b.x, b.y, { practiceId: p.id, name: p.name }, [evId, root.origin]);
  }
  const day = dayOf(w.tick);
  if (!p.performers.includes(c.id)) p.performers.push(c.id);
  p.performances++;
  p.performEvents.push(evId); if (p.performEvents.length > 24) p.performEvents.shift();
  if (!p.days.includes(day)) p.days.push(day);
  p.lastDay = day;
  if (depth > p.maxDepth) p.maxDepth = depth;
  const v = p.variants[b.id] ?? (p.variants[b.id] = { performers: [], performances: 0, branched: false });
  if (!v.performers.includes(c.id)) v.performers.push(c.id);
  v.performances++;
  if (b.parentId && !v.branched && v.performers.length >= 2) {
    v.branched = true;
    emit(w, 'practice.branch', c.id, b.x, b.y, { practiceId: p.id, behaviorId: b.id, parentId: b.parentId, change: b.change, performers: v.performers.slice() }, [evId, b.origin]);
  }
  evaluate(w, p, evId);
}

export function onTransmit(w: World, evId: string, rootId: string): void {
  const p = w.practices[rootId];
  if (!p) return;
  p.transmissions.push(evId);
  evaluate(w, p, evId);
}

export function cultureDaily(w: World): void {
  for (const id in w.practices) evaluate(w, w.practices[id], null);
}
