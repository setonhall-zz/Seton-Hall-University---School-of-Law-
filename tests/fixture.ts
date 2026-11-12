import { CFG } from '../src/sim/config';
import { applyAction, step } from '../src/sim/sim';
import { createWorld } from '../src/sim/world';
import type { World } from '../src/sim/types';

// A scripted "player": three stone demonstrations beside Pim early on day 0,
// then nothing. Everything after that is the island's own doing.
export function scripted(seed: number, days: number, demos = 3): World {
  const w = createWorld(seed);
  let anchor = { x: 0, y: 0 };
  for (let t = 0; t < CFG.DAY * days; t++) {
    if (t % 200 === 100 && t / 200 < demos) {
      const c = w.creatures[0];
      const stone = Object.values(w.objects).filter(o => o.kind === 'stone' && !o.carriedBy).sort((p, q) => Math.hypot(q.x - c.x, q.y - c.y) - Math.hypot(p.x - c.x, p.y - c.y))[0];
      if (t < 200) anchor = { x: Math.round(c.x) + 1, y: Math.round(c.y) };
      for (const [dx, dy] of [[0, 0], [1, 0], [0, 1], [-1, 0], [0, -1], [1, 1]]) if (applyAction(w, { kind: 'move', objId: stone.id, x: anchor.x + dx, y: anchor.y + dy }).ok) break;
    }
    step(w);
  }
  return w;
}

let cached: World | null = null;
export function longRun(): World { return cached ?? (cached = scripted(1, 6)); }
