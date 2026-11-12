import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { afterEach, describe, expect, it } from 'vitest';
import { CFG, dayOf } from '../src/sim/config';
import { decide } from '../src/sim/agent';
import { boundedDifference, mutate, newBehavior } from '../src/sim/behavior';
import { causalChain, chronicle, lineage } from '../src/sim/chronicle';
import { qualifies } from '../src/sim/culture';
import { addMemory } from '../src/sim/memory';
import { los } from '../src/sim/nav';
import { applyAction, Driver, replay, run, step } from '../src/sim/sim';
import { createWorld, eventLogHash, getEvent, idleAct, restoreWorld, snapshotBody, worldHash } from '../src/sim/world';
import { clearSave, loadWorld, saveWorld } from '../src/persist/db';
import { T_GRASS, T_ROCK, type World } from '../src/sim/types';
import { longRun, scripted } from './fixture';

afterEach(() => { CFG.learningEnabled = true; });

// A clear patch of meadow with one stone, one watcher, and everyone else far away and asleep.
function stage(watcherDist: number): { w: World; stone: string; x: number; y: number } {
  const w = createWorld(3);
  const x = 11, y = 11;
  for (let dy = -9; dy <= 9; dy++) for (let dx = -9; dx <= 9; dx++) w.terrain[(y + dy) * w.w + (x + dx)] = T_GRASS;
  w.creatures.forEach((c, i) => { c.x = c.hx = 2 + i; c.y = c.hy = 2; c.asleep = true; c.act = { ...idleAct(), type: 'rest', stage: 2 }; });
  const c = w.creatures[0];
  c.asleep = false; c.act = idleAct(); c.x = x + watcherDist; c.y = y; c.traits.curiosity = 1; c.relations.hand.trust = 1;
  const stone = Object.values(w.objects).find(o => o.kind === 'stone')!;
  stone.x = x - 3; stone.y = y - 3;
  return { w, stone: stone.id, x, y };
}
function demo(s: ReturnType<typeof stage>, times: number) {
  for (let i = 0; i < times; i++) { const r = applyAction(s.w, { kind: 'move', objId: s.stone, x: s.x + (i % 2), y: s.y }); expect(r.ok).toBe(true); }
}
const of = (w: World, type: string) => w.events.filter(e => e.type === type);

describe('determinism', () => {
  it('same seed and schedule give identical event logs', () => {
    const a = scripted(5, 2), b = scripted(5, 2);
    expect(eventLogHash(a)).toBe(eventLogHash(b));
    expect(worldHash(a)).toBe(worldHash(b));
    expect(a.events.length).toBeGreaterThan(50);
  });
  it('a different seed gives a different history', () => {
    expect(eventLogHash(scripted(5, 1))).not.toBe(eventLogHash(scripted(6, 1)));
  });
  it('replaying the recorded action schedule reproduces the world', () => {
    const a = scripted(5, 2);
    const b = replay(5, a.schedule, a.tick, createWorld);
    expect(worldHash(b)).toBe(worldHash(a));
  });
  it('is independent of frame rate', () => {
    const run2 = (dt: number) => { const d = new Driver(createWorld(9)); d.speed = 4; while (d.world.tick < 2500) d.advance(dt); return d.world; };
    const a = run2(1 / 60), b = run2(1 / 7);
    const target = Math.max(a.tick, b.tick);
    while (a.tick < target) step(a);
    while (b.tick < target) step(b);
    expect(worldHash(a)).toBe(worldHash(b));
  });
});

describe('perception', () => {
  it('a creature in range with line of sight can observe a demonstration', () => {
    const s = stage(2); demo(s, 12);
    const obs = of(s.w, 'observe').filter(e => e.actor === 'c0');
    expect(obs.length).toBeGreaterThan(0);
    expect(getEvent(s.w, obs[0].parents[0])!.type).toBe('hand.arrange');
  });
  it('a creature out of range never observes it', () => {
    const s = stage(CFG.perception + 2); demo(s, 40);
    expect(of(s.w, 'observe').length).toBe(0);
    expect(s.w.creatures[0].repertoire.length).toBe(0);
  });
  it('rock between watcher and event blocks sight', () => {
    const s = stage(4);
    for (const dy of [-1, 0, 1]) s.w.terrain[(s.y + dy) * s.w.w + s.x + 2] = T_ROCK;
    expect(los(s.w, s.x + 4, s.y, s.x, s.y)).toBe(false);
    demo(s, 40);
    expect(of(s.w, 'observe').length).toBe(0);
  });
  it('a sleeping creature observes nothing', () => {
    const s = stage(2); s.w.creatures[0].asleep = true; demo(s, 40);
    expect(of(s.w, 'observe').length).toBe(0);
  });
});

describe('learning', () => {
  it('adoption follows observation and cites it as evidence', () => {
    const s = stage(2); demo(s, 12);
    const adopt = of(s.w, 'adopt').find(e => e.actor === 'c0')!;
    expect(adopt).toBeTruthy();
    expect(adopt.parents.length).toBeGreaterThan(0);
    for (const p of adopt.parents) expect(getEvent(s.w, p)!.type).toBe('observe');
    expect(s.w.creatures[0].repertoire.length).toBe(1);
  });
  it('a learned behaviour is later performed, unprompted', () => {
    const s = stage(2); demo(s, 12);
    const c = s.w.creatures[0]; c.needs.exploration = 0.9; c.needs.food = 0; c.needs.rest = 0;
    run(s.w, 1500);
    const perf = of(s.w, 'perform').find(e => e.actor === 'c0')!;
    expect(perf).toBeTruthy();
    expect(perf.data.from).toBe('hand');
    expect(getEvent(s.w, perf.parents[0])!.type).toBe('adopt');
  });
  it('nothing is learned when learning is switched off', () => {
    CFG.learningEnabled = false;
    const s = stage(2); demo(s, 12);
    expect(of(s.w, 'observe').length).toBeGreaterThan(0);
    expect(of(s.w, 'adopt').length).toBe(0);
  });
  it('mutations change exactly one parameter within bounds', () => {
    const w = createWorld(4);
    const b = newBehavior(w, { steps: ['place:stone'], x: 11, y: 11, creator: 'hand', origin: 'e0' });
    let made = 0;
    for (let i = 0; i < 300; i++) {
      const parent = Object.values(w.behaviors)[i % Object.keys(w.behaviors).length];
      const child = mutate(w, parent, 'c0', 'e0');
      if (!child) continue;
      made++;
      const d = boundedDifference(parent, child);
      expect(d.ok, `${JSON.stringify(parent)} -> ${JSON.stringify(child)}`).toBe(true);
      expect(child.rootId).toBe(b.rootId);
      expect(child.parentId).toBe(parent.id);
    }
    expect(made).toBeGreaterThan(200);
  });
});

describe('culture over a long headless run', () => {
  it('runs thousands of ticks without stalling or corrupting state', () => {
    const w = longRun();
    expect(w.tick).toBe(CFG.DAY * 6);
    for (const c of w.creatures) {
      expect(Number.isFinite(c.x) && Number.isFinite(c.y)).toBe(true);
      const t = w.terrain[Math.round(c.y) * w.w + Math.round(c.x)];
      expect(t === 0 || t === 5).toBe(false);
      for (const v of Object.values(c.needs)) expect(v >= 0 && v <= 1).toBe(true);
      expect(c.memories.length).toBeLessThanOrEqual(CFG.memoryCap);
    }
  });
  it('creatures act on their own when the player does nothing', () => {
    const w = createWorld(2);
    const start = w.creatures.map(c => [c.x, c.y]);
    const moved = new Set<string>();
    const acts = new Set<string>();
    for (let i = 0; i < CFG.DAY; i++) { step(w); w.creatures.forEach((c, k) => { acts.add(c.act.type); if (Math.hypot(c.x - start[k][0], c.y - start[k][1]) > 2) moved.add(c.id); }); }
    expect(moved.size).toBe(8);
    for (const a of ['forage', 'rest', 'socialize', 'wander']) expect(acts.has(a)).toBe(true);
  });
  it('social transmission happens between creatures and is fully traceable', () => {
    const w = longRun();
    const tr = of(w, 'transmit');
    expect(tr.length).toBeGreaterThan(1);
    for (const t of tr) {
      expect(t.data.from).not.toBe('hand');
      const adopt = getEvent(w, t.parents[0])!;
      expect(adopt.type).toBe('adopt'); expect(adopt.actor).toBe(t.data.to);
      // the learner really saw the teacher perform
      const seen = adopt.parents.map(p => getEvent(w, p)!);
      expect(seen.length).toBeGreaterThan(0);
      for (const o of seen) { expect(o.type).toBe('observe'); expect(o.actor).toBe(t.data.to); }
      const perf = getEvent(w, seen[seen.length - 1].parents[0])!;
      expect(perf.type).toBe('perform'); expect(perf.actor).toBe(t.data.from);
    }
  });
  it('a custom emerges from several creatures, and its thresholds hold when recounted from raw events', () => {
    const w = longRun();
    const ups = of(w, 'practice.status').filter(e => e.data.to === 'custom');
    expect(ups.length).toBeGreaterThan(0);
    for (const u of ups) {
      const root = u.data.practiceId;
      const upTo = w.events.filter(e => e.tick <= u.tick && e.data.rootId === root && parseInt(e.id.slice(1)) < parseInt(u.id.slice(1)));
      const perf = upTo.filter(e => e.type === 'perform');
      expect(new Set(perf.map(e => e.actor)).size).toBeGreaterThanOrEqual(CFG.custom.performers);
      expect(perf.length).toBeGreaterThanOrEqual(CFG.custom.performances);
      expect(new Set(perf.map(e => dayOf(e.tick))).size).toBeGreaterThanOrEqual(CFG.custom.days);
      expect(upTo.filter(e => e.type === 'transmit').length).toBeGreaterThanOrEqual(CFG.custom.transmissions);
    }
  });
  it('the hand-introduced behaviour spread without being commanded', () => {
    const w = longRun();
    const hand = Object.values(w.practices).filter(p => w.behaviors[p.rootId].creator === 'hand');
    expect(hand.length).toBeGreaterThan(0);
    expect(Math.max(...hand.map(p => p.performers.length))).toBeGreaterThanOrEqual(3);
  });
  it('without transmission there is no custom, however long the world runs', () => {
    CFG.learningEnabled = false;
    const w = scripted(1, 8);
    expect(of(w, 'transmit').length).toBe(0);
    for (const p of Object.values(w.practices)) expect(p.peak).toBe('emerging');
    expect(of(w, 'practice.status').filter(e => e.data.to === 'custom' || e.data.to === 'tradition').length).toBe(0);
  });
  it('time alone cannot promote a practice', () => {
    const w = longRun();
    const p = structuredClone(Object.values(w.practices).find(q => q.peak === 'emerging') ?? Object.values(w.practices)[0]);
    const before = qualifies({ ...p, performers: ['c0'], transmissions: [], performances: 1, days: [0] });
    expect(before).toBe('emerging');
    expect(qualifies({ ...p, performers: ['c0'], transmissions: [], performances: 1, days: [0], lastDay: 999 })).toBe('emerging');
  });
  it('every variant has a recorded parent and a bounded difference from it', () => {
    const w = longRun();
    const variants = Object.values(w.behaviors).filter(b => b.parentId);
    expect(variants.length).toBeGreaterThan(0);
    for (const v of variants) {
      const parent = w.behaviors[v.parentId!];
      expect(parent.rootId).toBe(v.rootId);
      expect(boundedDifference(parent, v).ok).toBe(true);
      const origin = getEvent(w, v.origin)!;
      expect(['adopt', 'hand.arrange', 'hand.splash', 'hand.call']).toContain(origin.type);
      if (origin.type === 'adopt') expect(w.events.some(e => e.type === 'mutate' && e.data.behaviorId === v.id && e.data.parentId === parent.id)).toBe(true);
    }
    for (const p of Object.values(w.practices)) {
      const ids: string[] = []; const walk = (n: ReturnType<typeof lineage>) => { ids.push(n.id); n.children.forEach(walk); }; walk(lineage(w, p.rootId));
      expect(ids.sort()).toEqual(Object.values(w.behaviors).filter(b => b.rootId === p.rootId).map(b => b.id).sort());
    }
  });
  it('the Chronicle only says things the event log supports', () => {
    const w = longRun();
    const entries = chronicle(w);
    expect(entries.length).toBeGreaterThan(20);
    for (const en of entries) {
      expect(getEvent(w, en.id)).toBeTruthy();
      for (const id of en.evidence) expect(getEvent(w, id), id).toBeTruthy();
    }
    const custom = entries.find(e => e.title.includes('is now a custom'))!;
    expect(getEvent(w, custom.id)!.type).toBe('practice.status');
    const chain = causalChain(w, custom.id);
    expect(chain.some(c => c.event.type === 'transmit')).toBe(true);
    expect(chain.some(c => c.event.type === 'perform')).toBe(true);
  });
  it('traits change decisions', () => {
    const score = (curiosity: number) => {
      const w = createWorld(3); const c = w.creatures[0];
      c.traits.curiosity = curiosity; c.needs.exploration = 0.8;
      addMemory(w, c, { kind: 'novelty', actor: 'hand', x: Math.round(c.x) + 1, y: Math.round(c.y), salience: 0.8 });
      decide(w, c); return c.scores.investigate;
    };
    expect(score(1) - score(0)).toBeGreaterThan(0.25);
  });
});

describe('persistence', () => {
  it('a snapshot restores a world that continues identically', () => {
    const a = scripted(4, 2);
    const b = restoreWorld(snapshotBody(a), JSON.parse(JSON.stringify(a.events)));
    expect(worldHash(b)).toBe(worldHash(a));
    run(a, 2000); run(b, 2000);
    expect(worldHash(b)).toBe(worldHash(a));
  });
  it('saves to IndexedDB incrementally and reloads world, memories, culture and history', async () => {
    const idb = new IDBFactory();
    const w = scripted(1, 2);
    await saveWorld(w, 'run-a', idb);
    run(w, 1800);
    await saveWorld(w, 'run-a', idb);
    const r = await loadWorld(idb);
    expect(r.status).toBe('ok');
    if (r.status !== 'ok') return;
    expect(worldHash(r.world)).toBe(worldHash(w));
    expect(r.world.events.length).toBe(w.events.length);
    expect(Object.keys(r.world.practices)).toEqual(Object.keys(w.practices));
    expect(r.world.creatures[0].memories).toEqual(w.creatures[0].memories);
    expect(chronicle(r.world).length).toBe(chronicle(w).length);
  });
  it('a new world replaces the old history instead of mixing with it', async () => {
    const idb = new IDBFactory();
    await saveWorld(scripted(1, 1), 'run-a', idb);
    const fresh = createWorld(2); run(fresh, 50);
    await saveWorld(fresh, 'run-b', idb);
    const r = await loadWorld(idb);
    expect(r.status === 'ok' && r.world.seed === 2 && r.world.events.length === fresh.events.length).toBe(true);
  });
  it('reports an empty or corrupted save instead of crashing', async () => {
    const idb = new IDBFactory();
    expect((await loadWorld(idb)).status).toBe('empty');
    await saveWorld(scripted(1, 1), 'run-a', idb);
    const db: IDBDatabase = await new Promise(res => { const q = idb.open('elsewhere', 1); q.onsuccess = () => res(q.result); });
    await new Promise<void>(res => { const tx = db.transaction('snapshot', 'readwrite'); const st = tx.objectStore('snapshot'); const g = st.get('current'); g.onsuccess = () => { st.put({ ...g.result, body: g.result.body.slice(0, -20) + 'garbage' }); }; tx.oncomplete = () => res(); });
    db.close();
    const r = await loadWorld(idb);
    expect(r.status).toBe('invalid');
    await clearSave(idb);
    expect((await loadWorld(idb)).status).toBe('empty');
  });
});
