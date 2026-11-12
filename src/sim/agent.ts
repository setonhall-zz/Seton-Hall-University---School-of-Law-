import { CFG, dayOf, phaseOf } from './config';
import { isPlace, newBehavior, placeKind, shallowsNear, slots, validAt, describeBehavior } from './behavior';
import { evaluate, onPerform } from './culture';
import { forget, observeBehavior } from './learning';
import { addMemory, findMemory } from './memory';
import { blockedSet, canPerceive, dist, findPath, idx, isLand, movableAt, nearestTile, terr, walkable } from './nav';
import { hasAccess, hear, scan as scanRef } from './perception';
import { clamp, pick, rint, rnd } from './rng';
import { addObj, emit, idleAct } from './world';
import { T_SHALLOWS, type Creature, type Obj, type Step, type World } from './types';

// ---- movement -------------------------------------------------------------

const tile = (c: Creature) => ({ x: Math.round(c.x), y: Math.round(c.y) });

export function goTo(w: World, c: Creature, x: number, y: number): boolean {
  const t = tile(c);
  const p = findPath(w, t.x, t.y, x, y);
  if (!p) return false;
  c.path = p;
  return true;
}

// returns 'moving' | 'arrived' | 'stuck'
function moveAlong(w: World, c: Creature): 'moving' | 'arrived' | 'stuck' {
  if (!c.path.length) return 'arrived';
  const next = c.path[0];
  const tx = next % w.w, ty = (next / w.w) | 0;
  if (blockedSet(w).has(next)) {
    const last = c.path[c.path.length - 1];
    if (!goTo(w, c, last % w.w, (last / w.w) | 0)) { c.path = []; return 'stuck'; }
    return 'moving';
  }
  const d = dist(c.x, c.y, tx, ty);
  const sp = CFG.speed * (terr(w, tx, ty) === T_SHALLOWS ? 0.7 : 1);
  if (tx !== Math.round(c.x)) c.face = (tx - ty) - (c.x - c.y) >= 0 ? 1 : -1;
  if (d <= sp) { c.x = tx; c.y = ty; c.path.shift(); return c.path.length ? 'moving' : 'arrived'; }
  c.x += ((tx - c.x) / d) * sp; c.y += ((ty - c.y) / d) * sp;
  return 'moving';
}

// ---- needs ----------------------------------------------------------------

function updateNeeds(w: World, c: Creature): void {
  const D = CFG.DAY, n = c.needs, night = phaseOf(w.tick) === 'night';
  n.food = clamp(n.food + 1 / (D * 0.8));
  n.rest = clamp(n.rest + (c.asleep ? -1 / (D * 0.12) : (night ? 2 : 1) / (D * 0.75)));
  const company = w.creatures.some(o => o !== c && dist(o.x, o.y, c.x, c.y) < 2.5);
  n.belonging = clamp(n.belonging + (company ? -1 / 500 : (0.4 + c.traits.sociability) / (D * 0.5)));
  n.exploration = clamp(n.exploration + (0.4 + c.traits.curiosity) / (D * 0.45));
  n.safety = night ? clamp(dist(c.x, c.y, c.hx, c.hy) / 8) * (0.5 + 0.5 * c.traits.caution) : 0;
}

// ---- decision -------------------------------------------------------------

function bestFood(w: World, c: Creature): { objId: string; x: number; y: number } | null {
  let best: { objId: string; x: number; y: number } | null = null, bd = Infinity;
  for (const m of c.memories) {
    if (m.kind !== 'food' || m.outcome <= 0 || !m.objId || !w.objects[m.objId]) continue;
    const d = dist(c.x, c.y, m.x, m.y);
    if (d < bd) { bd = d; best = { objId: m.objId, x: m.x, y: m.y }; }
  }
  return best;
}

export function performScore(w: World, c: Creature, e: Creature['repertoire'][number]): number {
  const b = w.behaviors[e.behaviorId];
  const phase = phaseOf(w.tick);
  const pm = b.phase === 'any' ? 0.85 : b.phase === phase ? 1.3 : 0.12;
  const cd = clamp((w.tick - e.last) / 1300);
  const drive = 0.3 + 0.7 * Math.max(c.needs.belonging, c.needs.exploration * 0.7);
  let join = 0;
  for (const m of c.memories) if (m.kind === 'behavior' && w.tick - m.tick < 260 && w.behaviors[m.behaviorId!]?.rootId === b.rootId) join = c.traits.conformity * 0.3;
  return ((0.2 + e.value) * drive * pm + join) * cd;
}

export function decide(w: World, c: Creature): void {
  const n = c.needs, t = c.traits;
  const night = phaseOf(w.tick) === 'night';
  const s: Record<string, number> = {};
  const food = bestFood(w, c);
  s.forage = food ? 1.6 * n.food * n.food + (n.food > 0.85 ? 1 : 0) : 0;
  s.rest = 1.4 * n.rest * n.rest + (night ? 0.9 : 0) + n.safety * 0.3;
  s.socialize = n.belonging * (0.5 + t.sociability) * 0.8;
  let nov = null as Creature['memories'][number] | null;
  for (const m of c.memories) if (m.kind === 'novelty' && (!nov || m.salience > nov.salience)) nov = m;
  s.investigate = nov ? nov.salience * (0.45 + t.curiosity) * (0.5 + 0.5 * n.exploration) * (1 - 0.35 * t.caution * ((c.relations[nov.actor]?.trust ?? 0.2) < 0.3 ? 1 : 0)) : 0;
  let bestRep = null as Creature['repertoire'][number] | null; let bestU = 0;
  for (const e of c.repertoire) { const u = performScore(w, c, e); if (u > bestU) { bestU = u; bestRep = e; } }
  s.perform = bestU;
  const day = dayOf(w.tick);
  s.experiment = c.lastExperimentDay < day && c.repertoire.length < CFG.repertoireCap
    ? t.creativity * n.exploration * 0.2 + (c.inspired ? 0.15 + 0.3 * t.creativity : 0) + (rnd(w) < 0.005 * t.creativity ? 0.7 : 0) : 0;
  s.wander = 0.14 + n.exploration * 0.2 + (food ? 0 : n.food * 0.5);
  if (night) for (const k in s) if (k !== 'rest') s[k] *= 0.35;
  let choice = 'wander', top = -1;
  for (const k of ['forage', 'rest', 'socialize', 'investigate', 'perform', 'experiment', 'wander']) {
    s[k] = Math.round((s[k] + rnd(w) * 0.1) * 1000) / 1000;
    if (s[k] > top) { top = s[k]; choice = k; }
  }
  c.scores = s;
  const a = idleAct(w.tick);
  a.type = choice as any;
  if (choice === 'forage' && food) { a.targetId = food.objId; a.tx = food.x; a.ty = food.y; }
  if (choice === 'investigate' && nov) { a.tx = nov.x; a.ty = nov.y; a.targetId = nov.objId; a.cause = nov.sourceEvents[0] ?? null; a.idx = nov.id; }
  if (choice === 'perform' && bestRep) a.bId = bestRep.behaviorId;
  c.act = a;
  c.path = [];
}

// ---- actions --------------------------------------------------------------

function done(w: World, c: Creature): void { c.act = idleAct(w.tick); c.path = []; }

function walkStage(w: World, c: Creature, onArrive: () => void, onStuck?: () => void): void {
  const r = moveAlong(w, c);
  if (r === 'arrived') onArrive();
  else if (r === 'stuck') (onStuck ?? (() => done(w, c)))();
}

function awakeNear(w: World, c: Creature, r: number): Creature[] {
  return w.creatures.filter(o => o !== c && !o.asleep && dist(o.x, o.y, c.x, c.y) <= r);
}

export function gatherCheck(w: World, x: number, y: number, cause: string | null, by: string): void {
  const present = w.creatures.filter(o => !o.asleep && dist(o.x, o.y, x, y) <= 2.6);
  if (present.length < 3) return;
  const key = Math.floor(x / 3) + ',' + Math.floor(y / 3);
  const t = w.siteTally[key] ?? (w.siteTally[key] = { n: 0, last: -9999, events: [] });
  if (w.tick - t.last < 150) return;
  const ev = cause ?? emit(w, 'gather', by, x, y, { present: present.map(p => p.id) });
  t.n++; t.last = w.tick; t.events.push(ev); if (t.events.length > 6) t.events.shift();
  const rx = Math.round(x), ry = Math.round(y);
  if (t.n >= 4 && !w.sites.some(s => dist(s.x, s.y, rx, ry) < 3.5)) {
    const id = 's' + w.nextId++;
    const sev = emit(w, 'site.new', by, rx, ry, { siteId: id, gatherings: t.n }, t.events.slice());
    w.sites.push({ id, x: rx, y: ry, name: '', event: sev });
  }
}

function eat(w: World, c: Creature, o: Obj): void {
  o.food--;
  c.needs.food = clamp(c.needs.food - 0.75);
  w.fx.push({ type: 'eat', x: o.x, y: o.y, tick: w.tick });
  if (o.byHand) {
    c.relations.hand.trust = clamp(c.relations.hand.trust + 0.15);
    emit(w, 'eat.gift', c.id, o.x, o.y, { objId: o.id }, o.causeEvent ? [o.causeEvent] : []);
  }
  if (o.kind !== 'bush') delete w.objects[o.id];
  const m = findMemory(c, 'food', { objId: o.id });
  if (m) m.outcome = o.kind === 'bush' && o.food > 0 ? 1 : 0;
}

function tickAct(w: World, c: Creature): void {
  const a = c.act;
  switch (a.type) {
    case 'idle': return;
    case 'wander': {
      if (a.stage === 0) {
        const t = tile(c);
        for (let i = 0; i < 8; i++) {
          const x = t.x + rint(w, 11) - 5, y = t.y + rint(w, 11) - 5;
          if (isLand(w, x, y) && goTo(w, c, x, y)) { a.stage = 1; return; }
        }
        a.timer = 10; a.stage = 2; return;
      }
      if (a.stage === 1) return walkStage(w, c, () => { c.needs.exploration = clamp(c.needs.exploration - 0.08); a.stage = 2; a.timer = 6 + rint(w, 14); });
      if (--a.timer <= 0) done(w, c);
      return;
    }
    case 'forage': {
      const o = a.targetId ? w.objects[a.targetId] : undefined;
      if (a.stage === 0) { if (!o || !goTo(w, c, a.tx, a.ty)) { const m = a.targetId && findMemory(c, 'food', { objId: a.targetId }); if (m) m.outcome = 0; return done(w, c); } a.stage = 1; return; }
      if (a.stage === 1) return walkStage(w, c, () => {
        if (o && !o.carriedBy && o.food > 0) { a.stage = 2; a.timer = 16; }
        else { const m = a.targetId && findMemory(c, 'food', { objId: a.targetId }); if (m) m.outcome = 0; done(w, c); }
      });
      if (--a.timer <= 0) { if (o && o.food > 0) eat(w, c, o); done(w, c); }
      return;
    }
    case 'rest': {
      if (a.stage === 0) { a.stage = dist(c.x, c.y, c.hx, c.hy) > 1 && goTo(w, c, c.hx, c.hy) ? 1 : 2; return; }
      if (a.stage === 1) return walkStage(w, c, () => { a.stage = 2; }, () => { a.stage = 2; });
      c.asleep = true;
      const night = phaseOf(w.tick) === 'night';
      if ((!night && c.needs.rest < 0.25) || (c.needs.rest <= 0.02 && !night) || (!night && w.tick - a.since > CFG.DAY * 0.3)) { c.asleep = false; done(w, c); }
      return;
    }
    case 'socialize': {
      if (a.stage === 0) {
        let best: Creature | null = null, bs = -1;
        for (const o of w.creatures) {
          if (o === c || o.asleep || !canPerceive(w, c.x, c.y, c.perception, o.x, o.y)) continue;
          const r = c.relations[o.id];
          const sc = r.trust + r.familiarity * 0.5 + rnd(w) * 0.3;
          if (sc > bs) { bs = sc; best = o; }
        }
        if (best) { a.targetId = best.id; const t = tile(best); if (goTo(w, c, t.x, t.y)) { a.stage = 1; return; } }
        // nobody in sight: head for a known gathering place, or the heart of the island
        let gx = Math.round((w.w - 1) / 2), gy = Math.round((w.h - 1) / 2);
        if (w.sites.length) { const st = w.sites.reduce((p, q) => (dist(q.x, q.y, c.x, c.y) < dist(p.x, p.y, c.x, c.y) ? q : p)); gx = st.x; gy = st.y; }
        const land = nearestTile(w, gx, gy, 2, (x, y) => isLand(w, x, y));
        a.targetId = null;
        if (land && goTo(w, c, land.x, land.y)) { a.stage = 1; return; }
        return done(w, c);
      }
      if (a.stage === 1) {
        const o = a.targetId ? w.creatures.find(k => k.id === a.targetId) : null;
        if (o && dist(o.x, o.y, c.x, c.y) <= 1.6) { c.path = []; a.stage = 2; a.timer = 28; return; }
        if (o && (w.tick - a.since) % 20 === 19) { const t = tile(o); goTo(w, c, t.x, t.y); }
        if (w.tick - a.since > 400) return done(w, c);
        return walkStage(w, c, () => {
          if (o && dist(o.x, o.y, c.x, c.y) > 1.6) { const t = tile(o); if (!goTo(w, c, t.x, t.y)) done(w, c); return; }
          a.stage = 2; a.timer = 28;
        });
      }
      if (--a.timer <= 0) {
        const o = a.targetId ? w.creatures.find(k => k.id === a.targetId) : null;
        if (o && !o.asleep && dist(o.x, o.y, c.x, c.y) <= 2.2) {
          c.needs.belonging = clamp(c.needs.belonging - 0.5); o.needs.belonging = clamp(o.needs.belonging - 0.3);
          for (const [p, q] of [[c, o], [o, c]] as const) { const r = p.relations[q.id]; r.trust = clamp(r.trust + 0.04); r.familiarity = clamp(r.familiarity + 0.08); }
        } else if (awakeNear(w, c, 2.5).length) c.needs.belonging = clamp(c.needs.belonging - 0.2);
        gatherCheck(w, c.x, c.y, null, c.id);
        done(w, c);
      }
      return;
    }
    case 'investigate': {
      if (a.stage === 0) {
        const t = walkable(w, a.tx, a.ty) ? { x: a.tx, y: a.ty } : nearestTile(w, a.tx, a.ty, 2, (x, y) => walkable(w, x, y));
        const mem = c.memories.find(m => m.id === a.idx);
        if (!t || !goTo(w, c, t.x, t.y)) { if (mem) mem.salience *= 0.3; return done(w, c); }
        a.stage = 1; return;
      }
      if (a.stage === 1) return walkStage(w, c, () => { a.stage = 2; a.timer = 20; });
      if (--a.timer <= 0) {
        const mem = c.memories.find(m => m.id === a.idx);
        if (mem) mem.salience *= 0.25;
        const ev = emit(w, 'investigate', c.id, a.tx, a.ty, { objId: a.targetId }, a.cause ? [a.cause] : []);
        c.needs.exploration = clamp(c.needs.exploration - 0.45);
        const byHand = !!a.cause && (w.events[parseInt(a.cause.slice(1), 10)]?.data.source ?? 'hand') === 'hand';
        if (rnd(w) < (0.1 + 0.45 * c.traits.creativity) * (byHand ? 1 : 0.2)) c.inspired = { x: a.tx, y: a.ty, cause: ev };
        const o = a.targetId ? w.objects[a.targetId] : undefined;
        if (o && (o.kind === 'fruit' || o.kind === 'clam') && o.food > 0 && c.needs.food > 0.25) eat(w, c, o);
        done(w, c);
      }
      return;
    }
    case 'experiment': return experiment(w, c);
    case 'perform': return perform(w, c);
  }
}

function experiment(w: World, c: Creature): void {
  const t = tile(c);
  let at = c.inspired ? { x: c.inspired.x, y: c.inspired.y } : t;
  const opts: Step[] = ['call', 'dance'];
  const knows = (k: string) => Object.keys(c.seen).some(id => w.objects[id]?.kind === k);
  if (knows('stone')) opts.push('place:stone', 'place:stone');
  if (knows('shell')) opts.push('place:shell');
  if (shallowsNear(w, at.x, at.y, 2)) opts.push('splash', 'splash');
  const steps: Step[] = [pick(w, opts)];
  if (rnd(w) < 0.35) { const s2 = pick(w, opts); if (s2 !== steps[0]) steps.push(s2); }
  if (!validAt(w, steps, at.x, at.y)) {
    const alt = nearestTile(w, at.x, at.y, 2, (x, y) => validAt(w, steps, x, y));
    if (!alt) { c.lastExperimentDay = dayOf(w.tick); return done(w, c); }
    at = alt;
  }
  const cause = c.inspired?.cause ?? null;
  const ev = emit(w, 'innovate', c.id, at.x, at.y, { inspired: !!cause }, cause ? [cause] : []);
  const b = newBehavior(w, { steps, x: at.x, y: at.y, creator: c.id, origin: ev });
  w.events[w.events.length - 1].data.behaviorId = b.id;
  w.events[w.events.length - 1].data.what = describeBehavior(w, b);
  c.repertoire.push({ behaviorId: b.id, value: 0.5, from: 'self', adoptEvent: ev, performances: 0, last: -9999, depth: 0 });
  c.inspired = null; c.lastExperimentDay = dayOf(w.tick);
  c.needs.exploration = clamp(c.needs.exploration - 0.2);
  const a = idleAct(w.tick); a.type = 'perform'; a.bId = b.id; c.act = a;
}

function failPerform(w: World, c: Creature): void {
  const e = c.repertoire.find(r => r.behaviorId === c.act.bId);
  if (e) { e.value *= 0.8; e.last = w.tick; }
  if (c.carrying) dropCarried(w, c);
  done(w, c);
}

function dropCarried(w: World, c: Creature, x?: number, y?: number): void {
  const o = c.carrying ? w.objects[c.carrying] : undefined;
  c.carrying = null;
  if (!o) return;
  const t = tile(c);
  const tx = x ?? t.x, ty = y ?? t.y;
  const free = (px: number, py: number) => isLand(w, px, py) && !movableAt(w, px, py);
  const spot = free(tx, ty) ? { x: tx, y: ty } : nearestTile(w, tx, ty, 4, free) ?? { x: tx, y: ty };
  o.x = spot.x; o.y = spot.y; o.carriedBy = null;
  w.fx.push({ type: 'drop', x: o.x, y: o.y, tick: w.tick });
}

function perform(w: World, c: Creature): void {
  const a = c.act;
  const b = a.bId ? w.behaviors[a.bId] : undefined;
  const entry = c.repertoire.find(r => r.behaviorId === a.bId);
  if (!b || !entry) return done(w, c);
  const total = b.steps.length * b.count;
  const step = b.steps[a.idx % b.steps.length];
  const next = () => { a.idx++; a.stage = 0; a.timer = 0; if (a.idx >= total) completePerform(w, c); };
  if (w.tick - a.since > 1400) return failPerform(w, c);
  switch (a.stage) {
    case 0: {
      if (isPlace(step)) {
        const kind = placeKind(step);
        const sl = slots(b);
        const onSlot = (o: Obj) => sl.some(([x, y]) => x === o.x && y === o.y);
        let best: Obj | null = null, bd = Infinity;
        for (const id in c.seen) {
          const o = w.objects[id];
          if (!o || o.kind !== kind || o.carriedBy) continue;
          const d = dist(o.x, o.y, c.x, c.y) + (onSlot(o) ? 100 : 0);
          if (d < bd) { bd = d; best = o; }
        }
        if (!best || !goTo(w, c, best.x, best.y)) { if (++a.timer > 2 || !best) return failPerform(w, c); delete c.seen[best.id]; return; }
        a.targetId = best.id; a.stage = 1; return;
      }
      const dest = step === 'splash' ? shallowsNear(w, b.x, b.y, 2) : (isLand(w, b.x, b.y) ? { x: b.x, y: b.y } : nearestTile(w, b.x, b.y, 2, (x, y) => isLand(w, x, y)));
      if (!dest || !goTo(w, c, dest.x, dest.y)) return failPerform(w, c);
      a.stage = 5; return;
    }
    case 1: return walkStage(w, c, () => {
      const o = a.targetId ? w.objects[a.targetId] : undefined;
      const t = tile(c);
      if (!o || o.carriedBy || o.x !== t.x || o.y !== t.y) { if (o) delete c.seen[o.id]; a.stage = 0; if (++a.timer > 3) failPerform(w, c); return; }
      o.carriedBy = c.id; c.carrying = o.id;
      const sl = slots(b).filter(([x, y]) => isLand(w, x, y) && !movableAt(w, x, y));
      const dest = sl.length ? { x: sl[0][0], y: sl[0][1] } : nearestTile(w, b.x, b.y, 3, (x, y) => isLand(w, x, y) && !movableAt(w, x, y));
      if (!dest || !goTo(w, c, dest.x, dest.y)) return failPerform(w, c);
      a.tx = dest.x; a.ty = dest.y; a.stage = 3;
    }, () => failPerform(w, c));
    case 3: return walkStage(w, c, () => { dropCarried(w, c, a.tx, a.ty); a.stage = 6; a.timer = 6; }, () => failPerform(w, c));
    case 5: return walkStage(w, c, () => {
      a.stage = 6; a.timer = step === 'dance' ? 26 : step === 'splash' ? 14 : 10;
      if (step === 'dance') w.fx.push({ type: 'dance', x: c.x, y: c.y, tick: w.tick, id: c.id });
    }, () => failPerform(w, c));
    case 6: {
      if (--a.timer > 0) return;
      if (step === 'splash') {
        w.fx.push({ type: 'splash', x: c.x, y: c.y, tick: w.tick });
        const clams = Object.values(w.objects).filter(o => o.kind === 'clam').length;
        if (clams < 5 && rnd(w) < 0.3) {
          const t = tile(c);
          const spot = nearestTile(w, t.x, t.y, 2, (x, y) => isLand(w, x, y) && !movableAt(w, x, y));
          if (spot) { const o = addObj(w, 'clam', spot.x, spot.y); a.yielded = true; addMemory(w, c, { kind: 'food', actor: 'world', objId: o.id, x: o.x, y: o.y, outcome: 1 }); }
        }
      } else if (step === 'call') {
        w.fx.push({ type: 'call', x: c.x, y: c.y, tick: w.tick });
        a.cause = emit(w, 'call', c.id, c.x, c.y, { behaviorId: b.id });
        hear(w, c.x, c.y, c.id, a.cause);
      }
      return next();
    }
  }
}

function completePerform(w: World, c: Creature): void {
  const a = c.act;
  const b = w.behaviors[a.bId!];
  const entry = c.repertoire.find(r => r.behaviorId === b.id)!;
  const present = awakeNear(w, c, 4);
  const first = entry.performances === 0;
  const ev = emit(w, 'perform', c.id, c.x, c.y, {
    behaviorId: b.id, rootId: b.rootId, yielded: a.yielded, present: present.map(p => p.id), first, from: entry.from, depth: entry.depth,
  }, [entry.adoptEvent]);
  entry.performances++; entry.last = w.tick;
  for (const o of w.creatures) {
    if (o === c || !hasAccess(w, o, c.x, c.y)) continue;
    observeBehavior(w, o, c.id, b.id, ev, a.yielded, present.length);
    const r = o.relations[c.id]; r.familiarity = clamp(r.familiarity + 0.02);
  }
  const reward = 0.05 + 0.2 * Math.min(present.length, 3) + (a.yielded ? 0.5 : 0);
  entry.value = clamp(entry.value * 0.72 + reward * 0.28);
  c.needs.belonging = clamp(c.needs.belonging - 0.12 * Math.min(present.length, 3));
  c.needs.exploration = clamp(c.needs.exploration - 0.3);
  onPerform(w, ev, c, b, entry.depth);
  gatherCheck(w, c.x, c.y, ev, c.id);
  done(w, c);
}

// ---- daily upkeep ----------------------------------------------------------

export function creatureDaily(w: World, c: Creature): void {
  for (const e of c.repertoire.slice()) {
    e.value *= 0.9;
    const idle = w.tick - Math.max(e.last, w.events[parseInt(e.adoptEvent.slice(1), 10)]?.tick ?? 0);
    if ((e.value < 0.22 && idle > CFG.DAY) || idle > CFG.DAY * 3) {
      c.repertoire = c.repertoire.filter(x => x !== e);
      const fe = forget(w, c, e.behaviorId, e.value < 0.22 ? 'it stopped being worth doing' : 'left undone too long');
      const p = w.practices[w.behaviors[e.behaviorId].rootId];
      if (p) evaluate(w, p, fe);
    }
  }
}

export function tickCreature(w: World, c: Creature, i: number): void {
  updateNeeds(w, c);
  if ((w.tick + i * 2) % 12 === 0) {
    scanRef(w, c);
  }
  if (c.act.type === 'idle') decide(w, c);
  tickAct(w, c);
}

export { idx };
