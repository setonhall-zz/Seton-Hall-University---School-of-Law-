import { useEffect, useRef } from 'react';
import { game } from '../game';
import { Renderer } from '../render/renderer';
import type { PlayerAction } from '../sim/types';

// The canvas: pointer, touch and keyboard all funnel into the same three
// gestures — look (pan/zoom), point (hover/cursor) and act (tap/Enter).

function actionAt(x: number, y: number, objId: string | null): PlayerAction | null {
  const ui = game.ui;
  if (ui.tool === 'move') return ui.held ? { kind: 'move', objId: ui.held, x, y } : null;
  if (ui.tool === 'food') return { kind: 'food', x, y };
  if (ui.tool === 'signal') return { kind: 'signal', x, y };
  if (ui.tool === 'log') return { kind: 'log', x, y };
  return { kind: 'lumen', x, y };
}

export function tapTile(x: number, y: number, creatureId: string | null, objId: string | null) {
  const ui = game.ui, w = game.world;
  if (x < 0 || y < 0 || x >= w.w || y >= w.h) return;
  if (ui.mode === 'observe') { game.set({ selected: creatureId, sheet: !!creatureId }); return; }
  if (ui.mode === 'discover') {
    if (creatureId) game.set({ selected: creatureId, mode: 'observe', sheet: true });
    else game.set({ place: { x, y }, entry: null, practice: null, sheet: true });
    return;
  }
  if (ui.tool === 'move' && !ui.held) {
    const o = objId ? w.objects[objId] : null;
    if (o && ['stone', 'shell', 'lumen'].includes(o.kind)) game.set({ held: o.id });
    else game.toast(o ? 'That cannot be picked up.' : 'Pick up a stone, a shell or a lumen first.');
    return;
  }
  const a = actionAt(x, y, objId);
  if (a && game.act(a) && ui.tool === 'move') game.set({ held: null });
}

export function WorldCanvas() {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current!;
    const r = new Renderer(canvas, game.world);
    (window as any).__r = r;
    game.onWorld = w => { r.setWorld(w); r.fitted = false; r.resize(); };
    const ro = new ResizeObserver(() => r.resize()); ro.observe(canvas); r.resize();
    let raf = 0, last = performance.now();
    const loop = (now: number) => {
      const dt = (now - last) / 1000; last = now;
      game.frame(dt, now);
      const ui = game.ui;
      r.world = game.world; r.selected = ui.selected; r.held = ui.held; r.reduced = ui.reduced;
      r.showCursor = ui.mode !== 'observe';
      const open = ui.sheet && ui.mode !== 'influence', phone = r.w <= 720;
      r.tox = open && !phone ? -Math.min(380, r.w - 32) / 2 : 0; r.toy = open && phone ? -r.h * 0.2 : 0;
      r.focusTile = ui.mode === 'discover' ? ui.place : null;
      if (r.hover && ui.mode === 'influence') { const a = actionAt(r.hover.x, r.hover.y, null); r.cursorOk = a ? game.can(a) : true; } else r.cursorOk = true;
      r.draw(Math.min(dt, 0.1));
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);

    const pts = new Map<number, { x: number; y: number }>();
    let moved = 0, pinch = 0;
    const pos = (e: PointerEvent) => { const b = canvas.getBoundingClientRect(); return { x: e.clientX - b.left, y: e.clientY - b.top }; };
    const down = (e: PointerEvent) => { canvas.setPointerCapture(e.pointerId); pts.set(e.pointerId, pos(e)); moved = pts.size > 1 ? 99 : 0; pinch = 0; };
    const move = (e: PointerEvent) => {
      const p = pos(e); const prev = pts.get(e.pointerId);
      r.hover = r.toTile(p.x, p.y);
      if (!prev) return;
      if (pts.size === 1) { const dx = p.x - prev.x, dy = p.y - prev.y; moved += Math.abs(dx) + Math.abs(dy); if (moved > 8) r.pan(dx, dy); }
      pts.set(e.pointerId, p);
      if (pts.size === 2) { const [a, b] = [...pts.values()]; const d = Math.hypot(a.x - b.x, a.y - b.y); if (pinch) r.zoomAt(d / pinch, (a.x + b.x) / 2, (a.y + b.y) / 2); pinch = d; }
    };
    const up = (e: PointerEvent) => {
      const had = pts.has(e.pointerId); pts.delete(e.pointerId);
      if (had && moved <= 8) { const p = pos(e); const k = r.pick(p.x, p.y); tapTile(k.tile.x, k.tile.y, k.creatureId, k.objId); }
      if (e.pointerType !== 'mouse') r.hover = null;
    };
    const wheel = (e: WheelEvent) => { e.preventDefault(); const b = canvas.getBoundingClientRect(); r.zoomAt(Math.exp(-e.deltaY * 0.0015), e.clientX - b.left, e.clientY - b.top); };
    const key = (e: KeyboardEvent) => {
      const w = game.world;
      const cur = r.hover ?? { x: Math.round(w.w / 2), y: Math.round(w.h / 2) };
      const d: Record<string, [number, number]> = { ArrowUp: [-1, -1], ArrowDown: [1, 1], ArrowLeft: [-1, 1], ArrowRight: [1, -1], w: [0, -1], s: [0, 1], a: [-1, 0], d: [1, 0] };
      if (d[e.key]) { e.preventDefault(); r.hover = { x: Math.max(0, Math.min(w.w - 1, cur.x + d[e.key][0])), y: Math.max(0, Math.min(w.h - 1, cur.y + d[e.key][1])) }; r.showCursor = true; r.lookAt(r.hover.x, r.hover.y); }
      else if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        const here = w.creatures.find(c => Math.round(c.x) === cur.x && Math.round(c.y) === cur.y);
        let objId: string | null = null; for (const id in w.objects) { const o = w.objects[id]; if (!o.carriedBy && o.x === cur.x && o.y === cur.y) objId = id; }
        tapTile(cur.x, cur.y, here?.id ?? null, objId);
      } else if (e.key === '+' || e.key === '=') r.zoomAt(1.2, r.w / 2, r.h / 2);
      else if (e.key === '-') r.zoomAt(1 / 1.2, r.w / 2, r.h / 2);
      else if (e.key === 'Escape') game.set({ held: null });
    };
    const leave = () => { if (document.activeElement !== canvas) r.hover = null; };
    const hide = () => { if (document.visibilityState === 'hidden') game.save(); };
    canvas.addEventListener('pointerdown', down); canvas.addEventListener('pointermove', move); canvas.addEventListener('pointerup', up);
    canvas.addEventListener('pointercancel', e => pts.delete(e.pointerId)); canvas.addEventListener('pointerleave', leave);
    canvas.addEventListener('wheel', wheel, { passive: false }); canvas.addEventListener('keydown', key);
    document.addEventListener('visibilitychange', hide);
    return () => { cancelAnimationFrame(raf); ro.disconnect(); document.removeEventListener('visibilitychange', hide); };
  }, []);
  return <canvas ref={ref} className="world" tabIndex={0} aria-label="The island of Tallowmere. Arrow keys move the cursor, Enter acts on the tile, plus and minus zoom." />;
}
