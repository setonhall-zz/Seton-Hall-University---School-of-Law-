// Tuning survey: how often does culture emerge, with and without the hand?
import { CFG } from '../src/sim/config';
import { applyAction, step } from '../src/sim/sim';
import { createWorld } from '../src/sim/world';
const days = Number(process.argv[2] ?? 6);
for (const mode of ['nohand', 'light', 'heavy']) {
  const rows: string[] = [];
  for (let seed = 1; seed <= 10; seed++) {
    const w = createWorld(seed);
    let anchor = { x: 0, y: 0 };
    for (let t = 0; t < CFG.DAY * days; t++) {
      const n = mode === 'heavy' ? 8 : 3;
      if (mode !== 'nohand' && t % 200 === 100 && t / 200 < n) {
        const c = w.creatures[0];
        const stone = Object.values(w.objects).filter(o => o.kind === 'stone' && !o.carriedBy).sort((p, q) => Math.hypot(q.x - c.x, q.y - c.y) - Math.hypot(p.x - c.x, p.y - c.y))[0];
        const ax = t < 200 ? Math.round(c.x) + 1 : anchor.x, ay = t < 200 ? Math.round(c.y) : anchor.y;
        if (t < 200) anchor = { x: ax, y: ay };
        for (const [dx, dy] of [[0, 0], [1, 0], [0, 1], [-1, 0], [0, -1], [1, 1]]) if (applyAction(w, { kind: 'move', objId: stone.id, x: ax + dx, y: ay + dy }).ok) break;
      }
      step(w);
    }
    const ps = Object.values(w.practices);
    const cnt = (s: string) => ps.filter(p => p.peak === s).length;
    const perf = w.events.filter(e => e.type === 'perform').length;
    const firstCustom = w.events.find(e => e.type === 'practice.status' && e.data.to === 'custom');
    const hr = ps.filter(p => w.behaviors[p.rootId].creator === 'hand');
    const hand = `hand ${hr.length}/${Object.values(w.behaviors).filter(b => b.creator === 'hand' && !b.parentId).length} →${hr.map(p => p.peak[0] + (p.status === 'forgotten' ? 'x' : '')).join('')}`;
    rows.push(`s${seed}: ${hand} prac ${ps.length} cust ${cnt('custom')} trad ${cnt('tradition')} alive ${ps.filter(p => !['forgotten','declining'].includes(p.status)).length} perf/cd ${(perf / 8 / days).toFixed(1)} 1stCustom t${firstCustom?.tick ?? '-'} branch ${w.events.filter(e => e.type === 'practice.branch').length} sites ${w.sites.length}`);
  }
  console.log(`--- ${mode}\n` + rows.join('\n'));
}
