import { T_GROVE, T_ROCK, T_SAND, T_SHALLOWS, T_WATER, type World } from './types';

export const idx = (w: World, x: number, y: number) => y * w.w + x;
export const inb = (w: World, x: number, y: number) => x >= 0 && y >= 0 && x < w.w && y < w.h;
export const terr = (w: World, x: number, y: number) => (inb(w, x, y) ? w.terrain[idx(w, x, y)] : T_WATER);
export const dist = (ax: number, ay: number, bx: number, by: number) => Math.hypot(ax - bx, ay - by);

export function blockedSet(w: World): Set<number> {
  const s = new Set<number>();
  for (const id in w.objects) { const o = w.objects[id]; if (o.kind === 'log' && !o.carriedBy) s.add(idx(w, o.x, o.y)); }
  return s;
}
export function walkable(w: World, x: number, y: number, logs?: Set<number>): boolean {
  if (!inb(w, x, y)) return false;
  const t = w.terrain[idx(w, x, y)];
  if (t === T_WATER || t === T_ROCK) return false;
  if (logs && logs.has(idx(w, x, y))) return false;
  return true;
}
export const isLand = (w: World, x: number, y: number) => walkable(w, x, y) && terr(w, x, y) !== T_SHALLOWS;

const DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];

// A* over the tile grid (8-neighbour, no corner cutting). Returns tile indices
// excluding the start, or null when unreachable.
export function findPath(w: World, sx: number, sy: number, tx: number, ty: number): number[] | null {
  const logs = blockedSet(w);
  if (!walkable(w, tx, ty, logs)) return null;
  const start = idx(w, sx, sy), goal = idx(w, tx, ty);
  if (start === goal) return [];
  const n = w.w * w.h;
  const g = new Float32Array(n).fill(Infinity);
  const f = new Float32Array(n).fill(Infinity);
  const from = new Int32Array(n).fill(-1);
  const closed = new Uint8Array(n);
  const open: number[] = [start];
  g[start] = 0; f[start] = dist(sx, sy, tx, ty);
  while (open.length) {
    let bi = 0;
    for (let i = 1; i < open.length; i++) if (f[open[i]] < f[open[bi]] || (f[open[i]] === f[open[bi]] && open[i] < open[bi])) bi = i;
    const cur = open[bi];
    open[bi] = open[open.length - 1]; open.pop();
    if (cur === goal) {
      const out: number[] = [];
      let c = cur;
      while (c !== start) { out.push(c); c = from[c]; }
      return out.reverse();
    }
    if (closed[cur]) continue;
    closed[cur] = 1;
    const cx = cur % w.w, cy = (cur / w.w) | 0;
    for (const [dx, dy] of DIRS) {
      const nx = cx + dx, ny = cy + dy;
      if (!walkable(w, nx, ny, logs)) continue;
      if (dx && dy && (!walkable(w, cx + dx, cy, logs) || !walkable(w, cx, cy + dy, logs))) continue;
      const ni = idx(w, nx, ny);
      if (closed[ni]) continue;
      const cost = g[cur] + (dx && dy ? 1.414 : 1) + (w.terrain[ni] === T_SHALLOWS ? 0.6 : 0);
      if (cost < g[ni]) {
        g[ni] = cost; f[ni] = cost + dist(nx, ny, tx, ty); from[ni] = cur;
        open.push(ni);
      }
    }
  }
  return null;
}

// Line of sight between two tiles. Rock and grove tiles strictly between the
// endpoints block vision.
export function los(w: World, ax: number, ay: number, bx: number, by: number): boolean {
  let x0 = Math.round(ax), y0 = Math.round(ay);
  const x1 = Math.round(bx), y1 = Math.round(by);
  const dx = Math.abs(x1 - x0), dy = Math.abs(y1 - y0);
  const sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1;
  let err = dx - dy;
  while (!(x0 === x1 && y0 === y1)) {
    const e2 = 2 * err;
    if (e2 > -dy) { err -= dy; x0 += sx; }
    if (e2 < dx) { err += dx; y0 += sy; }
    if (x0 === x1 && y0 === y1) break;
    const t = terr(w, x0, y0);
    if (t === T_ROCK || t === T_GROVE) return false;
  }
  return true;
}

export function canPerceive(w: World, cx: number, cy: number, radius: number, x: number, y: number): boolean {
  return dist(cx, cy, x, y) <= radius && los(w, cx, cy, x, y);
}

export function movableAt(w: World, x: number, y: number): string | null {
  for (const id in w.objects) { const o = w.objects[id]; if (!o.carriedBy && o.x === x && o.y === y) return id; }
  return null;
}

// Nearest tile satisfying `ok`, searched in deterministic ring order.
export function nearestTile(w: World, x: number, y: number, maxR: number, ok: (x: number, y: number) => boolean): { x: number; y: number } | null {
  let best: { x: number; y: number } | null = null, bd = Infinity;
  for (let dy = -maxR; dy <= maxR; dy++) for (let dx = -maxR; dx <= maxR; dx++) {
    const nx = x + dx, ny = y + dy;
    if (!inb(w, nx, ny) || !ok(nx, ny)) continue;
    const d = dx * dx + dy * dy;
    if (d < bd) { bd = d; best = { x: nx, y: ny }; }
  }
  return best;
}

export function placeName(w: World, x: number, y: number): string {
  const cx = (w.w - 1) / 2, cy = (w.h - 1) / 2;
  const dx = x - cx, dy = y - cy;
  const t = terr(w, x, y);
  const what = t === T_SHALLOWS ? 'shallows' : t === T_SAND ? 'shore' : t === T_GROVE ? 'grove' : 'meadow';
  if (Math.hypot(dx, dy) < 3) return `the heart ${what}`;
  // screen-relative compass: the isometric view puts -x-y at the top
  const ang = Math.atan2(dx + dy, dx - dy);
  const dirs = ['east', 'south-east', 'south', 'south-west', 'west', 'north-west', 'north', 'north-east'];
  const d = dirs[((Math.round(ang / (Math.PI / 4)) % 8) + 8) % 8];
  return `the ${d} ${what}`;
}
