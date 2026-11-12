import { CFG } from './config';
import { creatureDaily, tickCreature } from './agent';
import { inferShape, newBehavior, shallowsNear } from './behavior';
import { cultureDaily } from './culture';
import { observeBehavior } from './learning';
import { decayMemories } from './memory';
import { dist, isLand, movableAt, terr } from './nav';
import { hasAccess, hear } from './perception';
import { addObj, emit } from './world';
import { T_SHALLOWS, T_WATER, type Behavior, type PlayerAction, type Shape, type Step, type World } from './types';

// ---- the fixed timestep -----------------------------------------------------

export function step(w: World): void {
  w.tick++;
  if (w.tick % CFG.DAY === 0) {
    for (const c of w.creatures) { decayMemories(w, c); creatureDaily(w, c); }
    cultureDaily(w);
  }
  if (w.tick % 600 === 0) for (const id in w.objects) { const o = w.objects[id]; if (o.kind === 'bush' && o.food < 3) o.food++; }
  for (let i = 0; i < w.creatures.length; i++) tickCreature(w, w.creatures[i], i);
  if (w.fx.length > 64) w.fx.splice(0, w.fx.length - 64);
}

export function run(w: World, ticks: number): void { for (let i = 0; i < ticks; i++) step(w); }

// ---- the hand ---------------------------------------------------------------
// The player never commands a creature. Each action changes the world and, for
// demonstrative ones, becomes something creatures with perceptual access may
// observe.

function handBehavior(w: World, steps: Step[], x: number, y: number, shape: Shape, origin: string): Behavior {
  let near: Behavior | null = null;
  for (const id in w.behaviors) {
    const b = w.behaviors[id];
    if (b.creator === 'hand' && b.steps.join() === steps.join() && dist(b.x, b.y, x, y) <= 2.2 && (!near || b.bornTick > near.bornTick)) near = b;
  }
  if (near && near.shape === shape) return near;
  if (near) return newBehavior(w, { steps, x: near.x, y: near.y, shape, creator: 'hand', origin, parent: near, change: `arranged as a ${shape}` });
  return newBehavior(w, { steps, x, y, shape, creator: 'hand', origin });
}

function demonstrate(w: World, ev: string, b: Behavior, x: number, y: number): void {
  for (const c of w.creatures) if (hasAccess(w, c, x, y)) observeBehavior(w, c, 'hand', b.id, ev, false, 0, 0.12);
}

export type ActionResult = { ok: true; event: string } | { ok: false; why: string };

export function canDo(w: World, a: PlayerAction): string | null {
  const count = (k: string) => Object.values(w.objects).filter(o => o.kind === k).length;
  switch (a.kind) {
    case 'move': {
      const o = w.objects[a.objId];
      if (!o || o.carriedBy) return 'That is being carried.';
      if (!['stone', 'shell', 'lumen'].includes(o.kind)) return 'That cannot be moved.';
      if (!isLand(w, a.x, a.y)) return 'It needs dry ground.';
      if (movableAt(w, a.x, a.y)) return 'Something is already there.';
      return null;
    }
    case 'food': return !isLand(w, a.x, a.y) ? 'Food needs dry ground.' : movableAt(w, a.x, a.y) ? 'Something is already there.' : count('fruit') >= 8 ? 'There is enough fruit lying about.' : null;
    case 'signal': return null;
    case 'log': {
      const at = movableAt(w, a.x, a.y);
      if (at && w.objects[at].kind === 'log') return null;
      if (!isLand(w, a.x, a.y) || at) return 'A log needs clear dry ground.';
      if (w.creatures.some(c => Math.round(c.x) === a.x && Math.round(c.y) === a.y)) return 'Someone is standing there.';
      return count('log') >= CFG.maxLogs ? `Only ${CFG.maxLogs} logs at a time.` : null;
    }
    case 'lumen': return !isLand(w, a.x, a.y) || movableAt(w, a.x, a.y) ? 'It needs clear dry ground.' : count('lumen') >= CFG.maxLumens ? `Only ${CFG.maxLumens} lumens exist. Move one instead.` : null;
    case 'catchup': return null;
  }
}

export function applyAction(w: World, a: PlayerAction): ActionResult {
  const why = canDo(w, a);
  if (why) return { ok: false, why };
  w.schedule.push({ tick: w.tick, action: a });
  let ev = '';
  switch (a.kind) {
    case 'move': {
      const o = w.objects[a.objId];
      const from = { x: o.x, y: o.y };
      o.x = a.x; o.y = a.y; o.novelTick = w.tick; o.byHand = true;
      ev = emit(w, 'hand.arrange', 'hand', a.x, a.y, { objId: o.id, kind: o.kind, from });
      o.causeEvent = ev;
      const b = handBehavior(w, ['place:' + o.kind as Step], a.x, a.y, inferShape(w, o.kind, a.x, a.y), ev);
      w.events[w.events.length - 1].data.behaviorId = b.id;
      demonstrate(w, ev, b, a.x, a.y);
      break;
    }
    case 'food': {
      ev = emit(w, 'hand.food', 'hand', a.x, a.y, {});
      addObj(w, 'fruit', a.x, a.y, { byHand: true, novelTick: w.tick, causeEvent: ev });
      break;
    }
    case 'signal': {
      const t = terr(w, a.x, a.y);
      const wet = t === T_SHALLOWS || t === T_WATER;
      const sh = t === T_SHALLOWS ? { x: a.x, y: a.y } : wet ? shallowsNear(w, a.x, a.y, 2) : null;
      ev = emit(w, wet ? 'hand.splash' : 'hand.call', 'hand', a.x, a.y, {});
      if (wet ? sh : isLand(w, a.x, a.y)) {
        const p = sh ?? { x: a.x, y: a.y };
        const b = handBehavior(w, [wet ? 'splash' : 'call'], p.x, p.y, 'pile', ev);
        w.events[w.events.length - 1].data.behaviorId = b.id;
        demonstrate(w, ev, b, p.x, p.y);
      }
      hear(w, a.x, a.y, 'hand', ev);
      break;
    }
    case 'log': {
      const at = movableAt(w, a.x, a.y);
      if (at) { delete w.objects[at]; ev = emit(w, 'hand.clear', 'hand', a.x, a.y, {}); }
      else { ev = emit(w, 'hand.block', 'hand', a.x, a.y, {}); addObj(w, 'log', a.x, a.y, { byHand: true, novelTick: w.tick, causeEvent: ev }); }
      break;
    }
    case 'lumen': {
      ev = emit(w, 'hand.lumen', 'hand', a.x, a.y, {});
      addObj(w, 'lumen', a.x, a.y, { byHand: true, novelTick: w.tick, causeEvent: ev });
      break;
    }
    case 'catchup': {
      ev = emit(w, 'world.catchup', 'world', (w.w - 1) / 2, (w.h - 1) / 2, { ticks: a.ticks, capped: a.capped });
      break;
    }
  }
  if (a.kind !== 'catchup') {
    const wet = a.kind === 'signal' && terr(w, a.x, a.y) <= T_SHALLOWS;
    w.fx.push({ type: a.kind === 'signal' ? (wet ? 'splash' : 'call') : 'hand', x: a.x, y: a.y, tick: w.tick });
  }
  return { ok: true, event: ev };
}

// Replays a recorded schedule from a seed. Used by determinism tests and to
// prove that history is a pure function of seed + actions.
export function replay(seed: number, schedule: World['schedule'], untilTick: number, make: (seed: number) => World): World {
  const w = make(seed);
  let i = 0;
  while (w.tick < untilTick) {
    while (i < schedule.length && schedule[i].tick === w.tick) applyAction(w, schedule[i++].action);
    step(w);
  }
  return w;
}

// Frame-rate independent driver: wall-clock time only decides how many fixed
// ticks to run, never what happens inside one.
export class Driver {
  acc = 0;
  speed = 1;
  constructor(public world: World) {}
  advance(dtSeconds: number, maxSteps = 400): number {
    this.acc += dtSeconds * CFG.TPS * this.speed;
    let n = 0;
    while (this.acc >= 1 && n < maxSteps) { step(this.world); this.acc -= 1; n++; }
    if (this.acc > maxSteps) this.acc = 0;
    return n;
  }
}
