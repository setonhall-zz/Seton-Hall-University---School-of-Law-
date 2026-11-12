import { CFG, dayFrac } from '../sim/config';
import { isLand } from '../sim/nav';
import { hash2 } from '../sim/rng';
import { T_GRASS, T_GROVE, T_ROCK, T_SAND, T_SHALLOWS, T_WATER, type Creature, type Obj, type World } from '../sim/types';

// Canvas 2D isometric diorama. The renderer only reads the world; nothing here
// feeds back into simulation state, and all animation runs on wall-clock time.

const TW = 60, TH = 30;
const ELEV = [0, 0, 3, 9, 9, 9];

export function glyphSegments(id: string): [number, number, number, number][] {
  let h = 0; for (let i = 0; i < id.length; i++) h = Math.imul(h ^ id.charCodeAt(i), 2654435761) >>> 0;
  const segs: [number, number, number, number][] = [];
  let px = h % 3, py = (h >>> 2) % 3;
  for (let i = 0; i < 4; i++) {
    h = Math.imul(h ^ (h >>> 7), 2246822519) >>> 0;
    let nx = h % 3, ny = (h >>> 3) % 3;
    if (nx === px && ny === py) nx = (nx + 1) % 3;
    segs.push([px, py, nx, ny]); px = nx; py = ny;
  }
  return segs;
}

interface FxLive { type: string; x: number; y: number; t0: number; id?: string }
export interface Pick { tile: { x: number; y: number }; creatureId: string | null; objId: string | null }

export class Renderer {
  ctx: CanvasRenderingContext2D;
  cam = { x: 0, y: 0, zoom: 1 };
  w = 0; h = 0; dpr = 1;
  disp: Record<string, { x: number; y: number }> = {};
  fx: FxLive[] = [];
  flies: { x: number; y: number; p: number }[] = [];
  hover: { x: number; y: number } | null = null;
  cursorOk = true;
  showCursor = false;
  selected: string | null = null;
  held: string | null = null;
  focusTile: { x: number; y: number } | null = null;
  reduced = false;
  time = 0;
  ox = 0; oy = 0; tox = 0; toy = 0;   // eased screen offset (panels push the island aside)
  marks: Record<string, number> = {};
  get mx() { return this.w / 2 + this.ox; }
  get my() { return this.h / 2 + this.oy; }

  constructor(public canvas: HTMLCanvasElement, public world: World) {
    this.ctx = canvas.getContext('2d')!;
    for (let i = 0; i < 26; i++) this.flies.push({ x: hash2(1, i, 0) * world.w, y: hash2(2, i, 0) * world.h, p: hash2(3, i, 0) * 6.28 });
    this.center();
  }
  setWorld(w: World) { this.world = w; this.disp = {}; this.fx = []; this.center(); }
  center() { const c = this.iso((this.world.w - 1) / 2, (this.world.h - 1) / 2, 0); this.cam.x = c.x; this.cam.y = c.y; }
  resize() {
    const r = this.canvas.getBoundingClientRect();
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.w = r.width; this.h = r.height;
    this.canvas.width = Math.round(r.width * this.dpr); this.canvas.height = Math.round(r.height * this.dpr);
    const fit = Math.min(r.width / (this.world.w * TW * 0.78), r.height / (this.world.h * TH * 0.82));
    if (!this.fitted) { this.cam.zoom = Math.max(0.55, Math.min(1.6, fit)); this.fitted = true; }
  }
  fitted = false;

  iso(x: number, y: number, e = 0) { return { x: (x - y) * TW / 2, y: (x + y) * TH / 2 - e }; }
  toScreen(x: number, y: number, e = 0) { const p = this.iso(x, y, e); return { x: (p.x - this.cam.x) * this.cam.zoom + this.mx, y: (p.y - this.cam.y) * this.cam.zoom + this.my }; }
  toTile(sx: number, sy: number): { x: number; y: number } {
    const wx = (sx - this.mx) / this.cam.zoom + this.cam.x, wy = (sy - this.my) / this.cam.zoom + this.cam.y;
    const solve = (e: number) => ({ x: Math.round((wx / (TW / 2) + (wy + e) / (TH / 2)) / 2), y: Math.round(((wy + e) / (TH / 2) - wx / (TW / 2)) / 2) });
    const hi = solve(9);
    if (hi.x >= 0 && hi.y >= 0 && hi.x < this.world.w && hi.y < this.world.h && ELEV[this.world.terrain[hi.y * this.world.w + hi.x]] >= 9) return hi;
    return solve(1);
  }
  pan(dx: number, dy: number) { this.cam.x -= dx / this.cam.zoom; this.cam.y -= dy / this.cam.zoom; this.clampCam(); }
  zoomAt(f: number, sx: number, sy: number) {
    const z = Math.max(0.5, Math.min(2.6, this.cam.zoom * f));
    const wx = (sx - this.mx) / this.cam.zoom + this.cam.x, wy = (sy - this.my) / this.cam.zoom + this.cam.y;
    this.cam.zoom = z;
    this.cam.x = wx - (sx - this.mx) / z; this.cam.y = wy - (sy - this.my) / z; this.clampCam();
  }
  clampCam() { const m = this.world.w * TW / 2; this.cam.x = Math.max(-m, Math.min(m, this.cam.x)); this.cam.y = Math.max(0, Math.min(this.world.h * TH, this.cam.y)); }
  lookAt(x: number, y: number) { const p = this.iso(x, y, 0); this.cam.x = p.x; this.cam.y = p.y; }

  pick(sx: number, sy: number): Pick {
    const tile = this.toTile(sx, sy);
    let creatureId: string | null = null, bd = 26;
    for (const c of this.world.creatures) {
      const d = this.disp[c.id] ?? c;
      const p = this.toScreen(d.x, d.y, 9);
      const dist = Math.hypot(p.x - sx, p.y - 14 * this.cam.zoom - sy);
      if (dist < bd * Math.max(1, this.cam.zoom)) { bd = dist / Math.max(1, this.cam.zoom); creatureId = c.id; }
    }
    let objId: string | null = null;
    for (const id in this.world.objects) { const o = this.world.objects[id]; if (!o.carriedBy && o.x === tile.x && o.y === tile.y) objId = id; }
    return { tile, creatureId, objId };
  }

  // ---- drawing -----------------------------------------------------------

  draw(dt: number) {
    const { ctx, world: w } = this;
    this.time += dt;
    const t = this.reduced ? 0 : this.time;
    const ke = this.reduced ? 1 : Math.min(1, dt * 6);
    this.ox += (this.tox - this.ox) * ke; this.oy += (this.toy - this.oy) * ke;
    for (const f of w.fx.splice(0)) { if (f.type === 'notice' && f.id) this.marks[f.id] = this.time; else this.fx.push({ type: f.type, x: f.x, y: f.y, t0: this.time, id: f.id }); }
    this.fx = this.fx.filter(f => this.time - f.t0 < 1.6);
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    const frac = dayFrac(w.tick);
    const light = lightAt(frac);
    // sea
    const g = ctx.createLinearGradient(0, 0, 0, this.h);
    g.addColorStop(0, '#0b262e'); g.addColorStop(1, '#123c44');
    ctx.fillStyle = g; ctx.fillRect(0, 0, this.w, this.h);
    ctx.save();
    ctx.translate(this.mx, this.my); ctx.scale(this.cam.zoom, this.cam.zoom); ctx.translate(-this.cam.x, -this.cam.y);

    // soft underwater glow beneath the island
    const c0 = this.iso((w.w - 1) / 2, (w.h - 1) / 2, 0);
    ctx.save(); ctx.translate(c0.x, c0.y); ctx.scale(1, 0.5);
    const R = w.w * TW * 0.56;
    const rg = ctx.createRadialGradient(0, 0, 40, 0, 0, R);
    rg.addColorStop(0, 'rgba(60,150,150,0.5)'); rg.addColorStop(1, 'rgba(60,150,150,0)');
    ctx.fillStyle = rg; ctx.beginPath(); ctx.arc(0, 0, R, 0, 6.3); ctx.fill(); ctx.restore();

    for (let s = 0; s < w.w + w.h - 1; s++) for (let x = Math.max(0, s - w.h + 1); x <= Math.min(s, w.w - 1); x++) this.tile(x, s - x, t);

    // gathering places and custom marks on the ground
    for (const site of w.sites) { const p = this.iso(site.x, site.y, 9); ctx.strokeStyle = 'rgba(255,236,190,0.35)'; ctx.lineWidth = 1.5; ctx.setLineDash([4, 5]); ctx.beginPath(); ctx.ellipse(p.x, p.y, 44, 22, 0, 0, 6.3); ctx.stroke(); ctx.setLineDash([]); }
    for (const id in w.practices) {
      const pr = w.practices[id];
      if (pr.status !== 'custom' && pr.status !== 'tradition') continue;
      const b = w.behaviors[pr.rootId];
      const p = this.iso(b.x, b.y, ELEV[w.terrain[b.y * w.w + b.x]]);
      this.glyph(id, p.x, p.y + 2, 0.55, pr.status === 'tradition' ? 'rgba(255,214,130,0.85)' : 'rgba(255,240,205,0.6)');
    }
    if (this.showCursor && this.hover) this.diamond(this.hover.x, this.hover.y, this.cursorOk ? 'rgba(255,232,170,0.9)' : 'rgba(255,140,120,0.9)', 2);
    if (this.focusTile) this.diamond(this.focusTile.x, this.focusTile.y, 'rgba(140,230,220,0.9)', 2);

    // sprites, back to front
    type S = { d: number; f: () => void };
    const sprites: S[] = [];
    for (let y = 0; y < w.h; y++) for (let x = 0; x < w.w; x++) {
      const tt = w.terrain[y * w.w + x];
      if (tt === T_GROVE) sprites.push({ d: x + y + 0.1, f: () => this.tree(x, y, t) });
      else if (tt === T_ROCK) sprites.push({ d: x + y + 0.1, f: () => this.rock(x, y) });
    }
    for (const id in w.objects) { const o = w.objects[id]; if (!o.carriedBy) sprites.push({ d: o.x + o.y + 0.2, f: () => this.obj(o, t) }); }
    const k = this.reduced ? 1 : Math.min(1, dt * 9);
    for (const c of w.creatures) {
      const d = this.disp[c.id] ?? (this.disp[c.id] = { x: c.x, y: c.y });
      d.x += (c.x - d.x) * k; d.y += (c.y - d.y) * k;
      sprites.push({ d: d.x + d.y + 0.3, f: () => this.wick(c, d.x, d.y, t, light.night) });
    }
    sprites.sort((a, b) => a.d - b.d);
    for (const s of sprites) s.f();
    for (const f of this.fx) this.drawFx(f);
    ctx.restore();

    // light of day
    ctx.globalCompositeOperation = 'multiply'; ctx.fillStyle = light.tint; ctx.fillRect(0, 0, this.w, this.h);
    ctx.globalCompositeOperation = 'lighter';
    ctx.save(); ctx.translate(this.mx, this.my); ctx.scale(this.cam.zoom, this.cam.zoom); ctx.translate(-this.cam.x, -this.cam.y);
    const glowA = 0.25 + light.night * 0.75;
    for (const c of w.creatures) { const d = this.disp[c.id]; const p = this.iso(d.x, d.y, 9); this.glow(p.x, p.y - 30, (c.asleep ? 16 : 26) + light.night * 16, `hsla(${c.hue},90%,65%,${(c.asleep ? 0.4 : 0.55) * glowA})`); }
    for (const id in w.objects) { const o = w.objects[id]; if (o.kind === 'lumen' && !o.carriedBy) { const p = this.iso(o.x, o.y, 9); this.glow(p.x, p.y - 14, 46 + Math.sin(t * 2 + o.x) * 4, `rgba(120,240,225,${0.35 + light.night * 0.4})`); } }
    if (light.night > 0.2 && !this.reduced) for (const f of this.flies) {
      const fx = f.x + Math.sin(t * 0.3 + f.p) * 1.5, fy = f.y + Math.cos(t * 0.23 + f.p * 2) * 1.5;
      if (!isLand(w, Math.round(fx), Math.round(fy))) continue;
      const p = this.iso(fx, fy, 22 + Math.sin(t + f.p) * 8);
      this.glow(p.x, p.y, 5, `rgba(210,255,170,${light.night * (0.4 + 0.4 * Math.sin(t * 2 + f.p))})`);
    }
    ctx.restore();
    ctx.globalCompositeOperation = 'source-over';
  }

  glow(x: number, y: number, r: number, color: string) {
    const { ctx } = this;
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, color); g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, r, 0, 6.3); ctx.fill();
  }
  diamond(x: number, y: number, stroke: string, lw: number) {
    const { ctx } = this; const e = ELEV[this.world.terrain[y * this.world.w + x] ?? 0] ?? 0; const p = this.iso(x, y, e);
    ctx.strokeStyle = stroke; ctx.lineWidth = lw; ctx.beginPath();
    ctx.moveTo(p.x, p.y - TH / 2); ctx.lineTo(p.x + TW / 2, p.y); ctx.lineTo(p.x, p.y + TH / 2); ctx.lineTo(p.x - TW / 2, p.y); ctx.closePath(); ctx.stroke();
  }
  glyph(id: string, x: number, y: number, s: number, color: string) {
    const { ctx } = this; ctx.strokeStyle = color; ctx.lineWidth = 2.2 * s; ctx.lineCap = 'round'; ctx.beginPath();
    for (const [a, b, c, d] of glyphSegments(id)) { ctx.moveTo(x + (a - 1) * 12 * s - (b - 1) * 12 * s, y + ((a - 1) + (b - 1)) * 6 * s); ctx.lineTo(x + (c - 1) * 12 * s - (d - 1) * 12 * s, y + ((c - 1) + (d - 1)) * 6 * s); }
    ctx.stroke();
  }

  tile(x: number, y: number, t: number) {
    const { ctx, world: w } = this;
    const tt = w.terrain[y * w.w + x];
    if (tt === T_WATER) return;
    const e = ELEV[tt], p = this.iso(x, y, e), v = hash2(w.seed + 77, x, y);
    const top = () => { ctx.beginPath(); ctx.moveTo(p.x, p.y - TH / 2); ctx.lineTo(p.x + TW / 2, p.y); ctx.lineTo(p.x, p.y + TH / 2); ctx.lineTo(p.x - TW / 2, p.y); ctx.closePath(); };
    if (tt === T_SHALLOWS) {
      top(); ctx.fillStyle = `rgba(${70 + v * 18},${168 + v * 14},${160 + v * 12},${0.5 + 0.08 * Math.sin(t * 1.3 + x * 0.8 + y)})`; ctx.fill();
      if (v > 0.55) { ctx.strokeStyle = `rgba(220,255,245,${0.18 + 0.14 * Math.sin(t * 1.7 + v * 20)})`; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(p.x - 10, p.y + (v - 0.7) * 10); ctx.lineTo(p.x + 8, p.y + (v - 0.7) * 10); ctx.stroke(); }
      return;
    }
    const base = tt === T_SAND ? [226 - v * 12, 212 - v * 12, 172 - v * 12] : tt === T_GROVE ? [70 + v * 10, 112 + v * 10, 74] : tt === T_ROCK ? [110, 122, 104] : [104 + v * 16, 148 + v * 14, 84 + v * 8];
    const el = (dx: number, dy: number) => ELEV[w.terrain[(y + dy) * w.w + x + dx] ?? 0] ?? 0;
    const sideL = y + 1 < w.h ? el(0, 1) : 0, sideR = x + 1 < w.w ? el(1, 0) : 0;
    const col = (k: number) => `rgb(${base[0] * k | 0},${base[1] * k | 0},${base[2] * k | 0})`;
    if (sideL < e) { const d = e - sideL + (sideL === 0 ? 5 : 0); ctx.fillStyle = tt === T_SAND ? col(0.72) : 'rgb(88,74,58)'; ctx.beginPath(); ctx.moveTo(p.x - TW / 2, p.y); ctx.lineTo(p.x, p.y + TH / 2); ctx.lineTo(p.x, p.y + TH / 2 + d); ctx.lineTo(p.x - TW / 2, p.y + d); ctx.closePath(); ctx.fill(); }
    if (sideR < e) { const d = e - sideR + (sideR === 0 ? 5 : 0); ctx.fillStyle = tt === T_SAND ? col(0.6) : 'rgb(66,56,46)'; ctx.beginPath(); ctx.moveTo(p.x + TW / 2, p.y); ctx.lineTo(p.x, p.y + TH / 2); ctx.lineTo(p.x, p.y + TH / 2 + d); ctx.lineTo(p.x + TW / 2, p.y + d); ctx.closePath(); ctx.fill(); }
    top(); ctx.fillStyle = col(1); ctx.fill();
    if (tt === T_GRASS && v > 0.5) { ctx.strokeStyle = 'rgba(46,84,48,0.45)'; ctx.lineWidth = 1.2; const sw = Math.sin(t * 1.4 + x + y * 0.7) * 1.5; ctx.beginPath(); for (let i = 0; i < 3; i++) { const gx = p.x + (hash2(9, x * 3 + i, y) - 0.5) * 28, gy = p.y + (hash2(8, x, y * 3 + i) - 0.5) * 10; ctx.moveTo(gx, gy); ctx.lineTo(gx + sw, gy - 5); } ctx.stroke(); }
  }

  tree(x: number, y: number, t: number) {
    const { ctx } = this; const p = this.iso(x, y, 9); const v = hash2(5, x, y); const sw = Math.sin(t * 0.9 + v * 9) * 2;
    ctx.fillStyle = 'rgba(0,0,0,0.22)'; ctx.beginPath(); ctx.ellipse(p.x, p.y + 2, 18, 8, 0, 0, 6.3); ctx.fill();
    ctx.fillStyle = '#5a4634'; ctx.fillRect(p.x - 2, p.y - 16, 4, 18);
    const hgt = 34 + v * 14;
    for (let i = 0; i < 3; i++) { ctx.fillStyle = ['#2f5d43', '#3b7350', '#4b8a5c'][i]; ctx.beginPath(); ctx.ellipse(p.x + sw * (i + 1) * 0.5 + (i - 1) * 3, p.y - 14 - (hgt * i) / 3.2, 19 - i * 4, 15 - i * 3, 0, 0, 6.3); ctx.fill(); }
  }
  rock(x: number, y: number) {
    const { ctx } = this; const p = this.iso(x, y, 9);
    ctx.fillStyle = '#6b727a'; ctx.beginPath(); ctx.moveTo(p.x - 20, p.y + 2); ctx.lineTo(p.x - 12, p.y - 22); ctx.lineTo(p.x + 4, p.y - 30); ctx.lineTo(p.x + 19, p.y - 10); ctx.lineTo(p.x + 16, p.y + 6); ctx.lineTo(p.x - 6, p.y + 10); ctx.closePath(); ctx.fill();
    ctx.fillStyle = '#8f979d'; ctx.beginPath(); ctx.moveTo(p.x - 12, p.y - 22); ctx.lineTo(p.x + 4, p.y - 30); ctx.lineTo(p.x + 6, p.y - 12); ctx.lineTo(p.x - 8, p.y - 6); ctx.closePath(); ctx.fill();
  }

  objShape(kind: string, x: number, y: number, t: number, food = 0, seedv = 0) {
    const { ctx } = this;
    const shadow = (rx: number) => { ctx.fillStyle = 'rgba(0,0,0,0.25)'; ctx.beginPath(); ctx.ellipse(x, y + 2, rx, rx * 0.45, 0, 0, 6.3); ctx.fill(); };
    if (kind === 'stone') { shadow(11); ctx.fillStyle = '#8a8f96'; ctx.beginPath(); ctx.ellipse(x, y - 4, 10, 7.5, 0, 0, 6.3); ctx.fill(); ctx.fillStyle = '#b9bec4'; ctx.beginPath(); ctx.ellipse(x - 2.5, y - 6.5, 5, 3, -0.3, 0, 6.3); ctx.fill(); }
    else if (kind === 'shell') { shadow(8); ctx.fillStyle = '#f1dcc9'; ctx.beginPath(); ctx.moveTo(x - 8, y); ctx.quadraticCurveTo(x, y - 16, x + 8, y); ctx.closePath(); ctx.fill(); ctx.strokeStyle = '#c99a86'; ctx.lineWidth = 1; ctx.beginPath(); for (const a of [-5, 0, 5]) { ctx.moveTo(x, y); ctx.lineTo(x + a, y - 8 + Math.abs(a) * 0.5); } ctx.stroke(); }
    else if (kind === 'fruit') { shadow(6); ctx.fillStyle = '#e8743b'; ctx.beginPath(); ctx.arc(x, y - 5, 5.5, 0, 6.3); ctx.fill(); ctx.fillStyle = '#6fa256'; ctx.beginPath(); ctx.ellipse(x + 3, y - 11, 3.5, 1.8, -0.6, 0, 6.3); ctx.fill(); }
    else if (kind === 'clam') { shadow(7); ctx.fillStyle = '#cfe3ea'; ctx.beginPath(); ctx.ellipse(x, y - 3, 7, 4.5, 0, 0, 6.3); ctx.fill(); ctx.strokeStyle = '#8fb0bd'; ctx.beginPath(); ctx.moveTo(x - 6, y - 3); ctx.lineTo(x + 6, y - 3); ctx.stroke(); }
    else if (kind === 'log') { shadow(18); ctx.fillStyle = '#6e4f37'; ctx.beginPath(); ctx.roundRect(x - 20, y - 12, 40, 13, 6); ctx.fill(); ctx.fillStyle = '#a17c56'; ctx.beginPath(); ctx.ellipse(x + 17, y - 5.5, 4, 6.5, 0, 0, 6.3); ctx.fill(); ctx.strokeStyle = '#54392a'; ctx.beginPath(); ctx.moveTo(x - 14, y - 8); ctx.lineTo(x + 8, y - 8); ctx.stroke(); }
    else if (kind === 'lumen') { const bob = Math.sin(t * 2 + seedv) * 2; shadow(7); ctx.fillStyle = '#bff6ec'; ctx.beginPath(); ctx.arc(x, y - 14 + bob, 6, 0, 6.3); ctx.fill(); ctx.fillStyle = '#ffffff'; ctx.beginPath(); ctx.arc(x - 1.5, y - 15.5 + bob, 2.4, 0, 6.3); ctx.fill(); }
    else if (kind === 'bush') {
      shadow(17);
      for (const [dx, dy, r, c] of [[-8, -8, 11, '#3d6e47'], [8, -9, 12, '#44794d'], [0, -15, 12, '#4f8a57']] as const) { ctx.fillStyle = c; ctx.beginPath(); ctx.arc(x + dx + Math.sin(t + dx) * 0.6, y + dy, r, 0, 6.3); ctx.fill(); }
      ctx.fillStyle = '#d9486b'; for (let i = 0; i < food; i++) { ctx.beginPath(); ctx.arc(x - 8 + i * 8, y - 12 - (i % 2) * 6, 3.2, 0, 6.3); ctx.fill(); }
    }
  }
  obj(o: Obj, t: number) {
    const p = this.iso(o.x, o.y, ELEV[this.world.terrain[o.y * this.world.w + o.x]]);
    if (o.id === this.held) { this.ctx.globalAlpha = 0.35; this.objShape(o.kind, p.x, p.y, t, o.food, o.x); this.ctx.globalAlpha = 1; return; }
    this.objShape(o.kind, p.x, p.y, t, o.food, o.x);
  }

  wick(c: Creature, dx: number, dy: number, t: number, night: number) {
    const { ctx, world: w } = this;
    const tt = w.terrain[Math.round(dy) * w.w + Math.round(dx)];
    const p = this.iso(dx, dy, tt === T_SHALLOWS ? -3 : ELEV[tt] ?? 9);
    const moving = c.path.length > 0 && !this.reduced;
    const a = c.act;
    const doing = a.type === 'perform' && a.stage === 6 ? w.behaviors[a.bId!]?.steps[a.idx % w.behaviors[a.bId!].steps.length] : null;
    const bob = moving ? Math.abs(Math.sin(t * 9 + c.hue)) * 3 : c.asleep ? 0 : Math.sin(t * 2 + c.hue) * 0.8;
    const sway = doing === 'dance' && !this.reduced ? Math.sin(t * 7) * 5 : 0;
    const x = p.x + sway, y = p.y - bob;
    if (c.id === this.selected) { ctx.strokeStyle = 'rgba(255,236,180,0.95)'; ctx.lineWidth = 2; ctx.beginPath(); ctx.ellipse(p.x, p.y + 1, 15, 7, 0, 0, 6.3); ctx.stroke(); }
    ctx.fillStyle = 'rgba(0,0,0,0.28)'; ctx.beginPath(); ctx.ellipse(p.x, p.y + 1, 10, 4.5, 0, 0, 6.3); ctx.fill();
    const hgt = c.asleep ? 15 : 22, wid = c.asleep ? 10.5 : 9;
    // feet
    if (!c.asleep) { ctx.fillStyle = `hsl(${c.hue},25%,42%)`; const st = moving ? Math.sin(t * 9 + c.hue) * 3 : 0; ctx.beginPath(); ctx.ellipse(x - 4 + st, p.y, 3.2, 2, 0, 0, 6.3); ctx.ellipse(x + 4 - st, p.y, 3.2, 2, 0, 0, 6.3); ctx.fill(); }
    // wax body: a soft teardrop
    ctx.fillStyle = `hsl(${c.hue},38%,${82 - night * 14}%)`;
    ctx.beginPath(); ctx.moveTo(x - wid, y - 3); ctx.quadraticCurveTo(x - wid - 1, y - hgt * 0.75, x - 3.5, y - hgt); ctx.quadraticCurveTo(x, y - hgt - 3, x + 3.5, y - hgt); ctx.quadraticCurveTo(x + wid + 1, y - hgt * 0.75, x + wid, y - 3); ctx.quadraticCurveTo(x, y + 2.5, x - wid, y - 3); ctx.fill();
    ctx.fillStyle = `hsla(${c.hue},45%,55%,0.35)`; ctx.beginPath(); ctx.ellipse(x + 3 * c.face, y - 6, 4.5, 6, 0, 0, 6.3); ctx.fill();
    // face
    const ex = x + 2.2 * c.face, ey = y - hgt * 0.58;
    ctx.fillStyle = '#2b2a33'; ctx.strokeStyle = '#2b2a33'; ctx.lineWidth = 1.3;
    if (c.asleep) { ctx.beginPath(); ctx.moveTo(ex - 5, ey); ctx.lineTo(ex - 2, ey); ctx.moveTo(ex + 2, ey); ctx.lineTo(ex + 5, ey); ctx.stroke(); }
    else { const blink = !this.reduced && Math.sin(t * 0.9 + c.hue) > 0.985; ctx.beginPath(); ctx.ellipse(ex - 3.2, ey, 1.5, blink ? 0.4 : 1.9, 0, 0, 6.3); ctx.ellipse(ex + 3.2, ey, 1.5, blink ? 0.4 : 1.9, 0, 0, 6.3); ctx.fill(); }
    // the flame tuft: bright when alert, an ember when asleep
    const fl = c.asleep ? 3 : 7 + (a.type === 'perform' || a.type === 'investigate' || a.type === 'experiment' ? 3 : 0) + (this.reduced ? 0 : Math.sin(t * 8 + c.hue) * 0.8);
    const fx = x + (this.reduced ? 0 : Math.sin(t * 5 + c.hue) * 1.2), fy = y - hgt - 1;
    ctx.fillStyle = `hsl(${c.hue},92%,${c.asleep ? 48 : 62}%)`;
    ctx.beginPath(); ctx.moveTo(x - fl * 0.42, fy); ctx.quadraticCurveTo(x - fl * 0.5, fy - fl * 0.6, fx, fy - fl * 1.35); ctx.quadraticCurveTo(x + fl * 0.5, fy - fl * 0.6, x + fl * 0.42, fy); ctx.quadraticCurveTo(x, fy + 2, x - fl * 0.42, fy); ctx.fill();
    ctx.fillStyle = 'rgba(255,250,225,0.9)'; ctx.beginPath(); ctx.ellipse(x, fy - fl * 0.3, fl * 0.16, fl * 0.3, 0, 0, 6.3); ctx.fill();
    if (c.carrying && w.objects[c.carrying]) this.objShape(w.objects[c.carrying].kind, x, y - hgt - 14, t, 0, 0);
    // a small sign of what it is doing: shape, not colour
    const noticed = this.time - (this.marks[c.id] ?? -9) < 1.5;
    const mark = noticed ? '!' : c.asleep ? 'z' : doing === 'call' ? '♪' : doing === 'dance' ? '∿' : a.type === 'investigate' ? '?' : a.type === 'experiment' ? '!' : a.type === 'socialize' && a.stage === 2 ? '♥' : a.type === 'forage' && a.stage === 2 ? '◦' : '';
    ctx.textAlign = 'center';
    if (mark) { ctx.font = noticed ? '700 16px system-ui, sans-serif' : '600 11px system-ui, sans-serif'; ctx.fillStyle = noticed ? '#ffd978' : 'rgba(255,246,220,0.95)'; ctx.fillText(mark, x + 13, y - hgt - 4 - (c.asleep && !this.reduced ? ((t * 6) % 8) : 0)); }
    if (this.cam.zoom > 0.75) { ctx.font = '600 10px system-ui, sans-serif'; ctx.fillStyle = 'rgba(8,24,28,0.55)'; ctx.fillText(c.name, p.x + 0.6, p.y + 15.6); ctx.fillStyle = c.id === this.selected ? '#ffe9b0' : 'rgba(255,248,228,0.9)'; ctx.fillText(c.name, p.x, p.y + 15); }
  }

  drawFx(f: FxLive) {
    const { ctx } = this; const age = this.time - f.t0; const p = this.iso(f.x, f.y, 4); const k = age / 1.6;
    if (f.type === 'splash') { ctx.strokeStyle = `rgba(225,255,250,${0.9 * (1 - k)})`; ctx.lineWidth = 2; for (const m of [1, 0.6]) { ctx.beginPath(); ctx.ellipse(p.x, p.y, 8 + k * 38 * m, 4 + k * 19 * m, 0, 0, 6.3); ctx.stroke(); } }
    else if (f.type === 'call') { ctx.strokeStyle = `rgba(255,232,160,${0.9 * (1 - k)})`; ctx.lineWidth = 2; for (const m of [1, 0.66, 0.33]) { ctx.beginPath(); ctx.ellipse(p.x, p.y - 24, 10 + k * 70 * m, 5 + k * 35 * m, 0, 0, 6.3); ctx.stroke(); } }
    else if (f.type === 'hand') { ctx.strokeStyle = `rgba(255,236,180,${1 - k})`; ctx.lineWidth = 2.5; ctx.beginPath(); ctx.ellipse(p.x, p.y - 6, 14 + k * 20, 7 + k * 10, 0, 0, 6.3); ctx.stroke(); this.glow(p.x, p.y - 10, 30, `rgba(255,236,180,${0.5 * (1 - k)})`); }
    else if (f.type === 'eat' || f.type === 'drop') { ctx.fillStyle = `rgba(255,246,220,${0.7 * (1 - k)})`; for (let i = 0; i < 4; i++) { ctx.beginPath(); ctx.arc(p.x + Math.cos(i * 1.6) * (6 + k * 16), p.y - 6 - k * 14 + Math.sin(i * 1.6) * 4, 2, 0, 6.3); ctx.fill(); } }
  }
}

// Day runs warm; dusk goes amber; night falls to deep blue-green.
function lightAt(f: number): { tint: string; night: number } {
  const stops: [number, number[], number][] = [
    [0, [255, 196, 170], 0.35], [0.1, [255, 246, 228], 0], [0.55, [255, 240, 214], 0], [0.7, [255, 176, 120], 0.25], [0.8, [118, 138, 186], 0.85], [0.95, [104, 124, 176], 1], [1, [255, 196, 170], 0.35],
  ];
  let i = 0; while (i < stops.length - 2 && f > stops[i + 1][0]) i++;
  const [a, ca, na] = stops[i], [b, cb, nb] = stops[i + 1];
  const k = Math.max(0, Math.min(1, (f - a) / (b - a)));
  const c = ca.map((v, j) => Math.round(v + (cb[j] - v) * k));
  return { tint: `rgb(${c[0]},${c[1]},${c[2]})`, night: na + (nb - na) * k };
}
export { CFG };
