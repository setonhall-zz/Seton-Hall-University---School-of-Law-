// Headless probe: run seeds with a small scripted "player" and print what happened.
import { CFG, dayOf } from '../src/sim/config';
import { applyAction, step } from '../src/sim/sim';
import { createWorld } from '../src/sim/world';
import { describeBehavior } from '../src/sim/behavior';
import { T_GRASS, T_SHALLOWS } from '../src/sim/types';

const seeds = process.argv[2] ? process.argv[2].split(',').map(Number) : [7, 1, 2, 3];
const days = Number(process.argv[3] ?? 6);
const hand = process.argv[4] !== 'nohand';
for (const seed of seeds) {
  const w = createWorld(seed);
  const terrCount = [0, 0, 0, 0, 0, 0]; w.terrain.forEach(t => terrCount[t]++);
  const t0 = Date.now();
  for (let t = 0; t < CFG.DAY * days; t++) {
    if (hand && t % 300 === 150 && t < CFG.DAY * 2) {
      // move a stone next to a creature that is awake
      const c = w.creatures[(t / 300 | 0) % 8];
      const stone = Object.values(w.objects).find(o => o.kind === 'stone' && !o.carriedBy)!;
      const x = Math.round(c.x) + 1, y = Math.round(c.y);
      applyAction(w, { kind: 'move', objId: stone.id, x, y });
    }
    if (hand && t === 700) { const i = w.terrain.findIndex(v => v === T_SHALLOWS); applyAction(w, { kind: 'signal', x: i % w.w, y: (i / w.w) | 0 }); }
    step(w);
  }
  const ms = Date.now() - t0;
  const types: Record<string, number> = {};
  for (const e of w.events) types[e.type] = (types[e.type] ?? 0) + 1;
  console.log(`\n=== seed ${seed}: ${days} days, ${w.events.length} events, ${ms}ms, terrain ${terrCount.join('/')}, objs ${Object.keys(w.objects).length}`);
  console.log(JSON.stringify(types));
  for (const p of Object.values(w.practices)) {
    const root = w.behaviors[p.rootId];
    console.log(` practice ${p.id} [${p.status}/peak ${p.peak}] "${p.name}" by ${root.creator}: performers ${p.performers.length}, perf ${p.performances}, trans ${p.transmissions.length}, days ${p.days.length}, depth ${p.maxDepth}, variants ${Object.keys(p.variants).length}`);
    console.log('   ' + describeBehavior(w, root));
  }
  for (const e of w.events.filter(e => e.type === 'practice.status' || e.type === 'site.new' || e.type === 'practice.branch')) console.log(`  d${dayOf(e.tick)} t${e.tick} ${e.type} ${JSON.stringify(e.data)}`);
  console.log(' creatures:', w.creatures.map(c => `${c.name}:${c.act.type}${c.asleep ? 'z' : ''} rep${c.repertoire.length} f${c.needs.food.toFixed(1)}`).join(' | '));
}
