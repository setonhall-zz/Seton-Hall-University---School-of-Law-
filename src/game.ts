import { CFG } from './sim/config';
import { applyAction, canDo, Driver, step } from './sim/sim';
import { createWorld, DEFAULT_SEED } from './sim/world';
import { clearSave, loadWorld, saveWorld } from './persist/db';
import type { PlayerAction, World } from './sim/types';

// App-level state that is not part of the simulation: which panel is open,
// which tool is held, save status. The world itself lives in the Driver.

export type Mode = 'observe' | 'influence' | 'discover';
export type Tool = 'move' | 'food' | 'signal' | 'log' | 'lumen';

export interface UI {
  mode: Mode; tool: Tool; speed: number;
  selected: string | null;          // creature id
  held: string | null;              // object being carried by the hand
  entry: string | null;             // chronicle event being inspected
  practice: string | null;          // practice whose lineage is open
  place: { x: number; y: number } | null;
  sheet: boolean;
  toast: { text: string; id: number } | null;
  saved: 'saving' | 'saved' | 'unavailable' | 'never';
  savedAt: number;
  notice: string | null;            // one-off message after load
  confirmNew: boolean;
  reduced: boolean;
  hint: boolean;
}

class Game {
  driver = new Driver(createWorld(DEFAULT_SEED));
  runId = 'run-' + Date.now().toString(36);
  ui: UI = {
    mode: 'influence', tool: 'move', speed: 1, selected: null, held: null, entry: null, practice: null, place: null, sheet: false,
    toast: null, saved: 'never', savedAt: 0, notice: null, confirmNew: false, hint: true,
    reduced: typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches,
  };
  version = 0;
  ready = false;
  private subs = new Set<() => void>();
  private lastEvents = 0;
  private lastNotify = 0;
  private lastSave = 0;
  onWorld: (w: World) => void = () => {};

  get world(): World { return this.driver.world; }
  subscribe = (f: () => void) => { this.subs.add(f); return () => { this.subs.delete(f); }; };
  snapshot = () => this.version;
  notify() { this.version++; this.subs.forEach(f => f()); }
  set(p: Partial<UI>) { Object.assign(this.ui, p); this.notify(); }
  toast(text: string) { this.set({ toast: { text, id: Date.now() } }); }

  async boot() {
    try {
      const r = await loadWorld();
      if (r.status === 'ok') {
        this.driver = new Driver(r.world); this.runId = r.runId;
        this.ui.saved = 'saved'; this.ui.savedAt = r.savedAt; this.ui.hint = false;
        // Offline catch-up: bounded, and said out loud.
        const away = Math.max(0, (Date.now() - r.savedAt) / 1000) * CFG.TPS;
        const ticks = Math.min(Math.floor(away), CFG.offlineCapTicks);
        if (ticks > CFG.TPS * 60) {
          applyAction(r.world, { kind: 'catchup', ticks, capped: away > CFG.offlineCapTicks });
          for (let i = 0; i < ticks; i++) step(r.world);
          r.world.fx = [];
          this.ui.notice = `While you were away the island lived ${(ticks / CFG.DAY).toFixed(1)} of its days.` + (away > CFG.offlineCapTicks ? ' Catch-up stops at three days; the rest was not simulated.' : '');
        } else this.ui.notice = 'Your island is as you left it.';
      } else if (r.status === 'invalid') {
        this.ui.notice = `The saved island could not be restored (${r.reason}). A new one has begun.`;
      }
    } catch { this.ui.saved = 'unavailable'; }
    this.ready = true;
    this.onWorld(this.world);
    this.lastEvents = this.world.events.length;
    this.notify();
  }

  frame(dt: number, now: number) {
    if (!this.ready) return;
    this.driver.speed = this.ui.speed;
    this.driver.advance(Math.min(dt, 0.25));
    const n = this.world.events.length;
    if (n !== this.lastEvents || now - this.lastNotify > 400) {
      const fresh = this.world.events.slice(this.lastEvents);
      this.lastEvents = n; this.lastNotify = now;
      if (fresh.some(e => e.type === 'practice.status' || e.type === 'site.new')) this.save();
      this.notify();
    }
    if (now - this.lastSave > 20000) this.save();
  }

  act(a: PlayerAction): boolean {
    const r = applyAction(this.world, a);
    if (!r.ok) { this.toast(r.why); return false; }
    if (this.ui.hint) this.ui.hint = false;
    this.notify();
    return true;
  }
  can(a: PlayerAction): boolean { return canDo(this.world, a) === null; }

  async save() {
    this.lastSave = performance.now();
    if (this.ui.saved === 'unavailable') return;
    try { const at = await saveWorld(this.world, this.runId); this.ui.saved = 'saved'; this.ui.savedAt = at; }
    catch { this.ui.saved = 'unavailable'; }
    this.notify();
  }

  async newWorld() {
    const seed = (Date.now() % 100000) + 1;
    this.driver = new Driver(createWorld(seed));
    this.runId = 'run-' + Date.now().toString(36);
    this.lastEvents = this.world.events.length;
    Object.assign(this.ui, { selected: null, held: null, entry: null, practice: null, place: null, confirmNew: false, notice: 'A new island begins. The old one is gone.', hint: true });
    try { await clearSave(); } catch { /* storage unavailable */ }
    this.onWorld(this.world);
    this.save();
  }
}

export const game = new Game();
