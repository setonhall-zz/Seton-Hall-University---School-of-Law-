import { useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { game, type Mode, type Tool } from '../game';
import { glyphSegments } from '../render/renderer';
import { describeBehavior, shortName } from '../sim/behavior';
import { causalChain, chronicle, describeEvent, lineage, transmissionChain, type VariantNode } from '../sim/chronicle';
import { holders } from '../sim/culture';
import { CFG, dayOf, phaseOf } from '../sim/config';
import { dist, placeName } from '../sim/nav';
import { actorName } from '../sim/world';
import type { Creature, SimEvent, World } from '../sim/types';
import { WorldCanvas } from './World';

const useGame = () => useSyncExternalStore(game.subscribe, game.snapshot);

function Glyph({ id, size = 22 }: { id: string; size?: number }) {
  return (
    <svg className="glyph" width={size} height={size} viewBox="-2 -2 28 28" aria-hidden="true">
      {glyphSegments(id).map(([a, b, c, d], i) => <line key={i} x1={a * 12} y1={b * 12} x2={c * 12} y2={d * 12} />)}
    </svg>
  );
}

const ICON: Record<string, string> = {
  observe: 'M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12zm10 3a3 3 0 100-6 3 3 0 000 6z',
  influence: 'M12 3l2.2 5.8L20 11l-5.8 2.2L12 19l-2.2-5.8L4 11l5.8-2.2z',
  discover: 'M5 4h11a3 3 0 013 3v13H8a3 3 0 01-3-3zm3 4h8M8 12h8',
  move: 'M5 16c0-3 3-5 7-5s7 2 7 5-3 4-7 4-7-1-7-4zm7-13v6m-3-3l3-3 3 3',
  food: 'M12 8a6 6 0 100 12 6 6 0 000-12zm0 0c0-3 2-5 5-5',
  signal: 'M4 14c2-2 4-2 6 0s4 2 6 0 3-2 4-1M4 19c2-2 4-2 6 0s4 2 6 0 3-2 4-1M12 3v6',
  log: 'M3 10h14a3 3 0 010 6H3a3 3 0 010-6zm14 0a3 3 0 000 6M6 13h7',
  lumen: 'M12 7a5 5 0 100 10 5 5 0 000-10zm0-5v2m0 16v2M2 12h2m16 0h2M5 5l1.5 1.5M17.5 17.5L19 19M19 5l-1.5 1.5M6.5 17.5L5 19',
};
const Icon = ({ name }: { name: string }) => <svg className="icon" viewBox="0 0 24 24" aria-hidden="true"><path d={ICON[name]} /></svg>;

const TOOLS: { id: Tool; label: string; help: string }[] = [
  { id: 'move', label: 'Arrange', help: 'Pick up a stone, shell or lumen, then set it down somewhere.' },
  { id: 'food', label: 'Fruit', help: 'Leave fruit on dry ground.' },
  { id: 'signal', label: 'Signal', help: 'Tap water to splash. Tap land to sound a note.' },
  { id: 'log', label: 'Log', help: 'Lay a log across a path, or tap a log to lift it.' },
  { id: 'lumen', label: 'Lumen', help: 'Place a small light the wicks have never seen.' },
];

export function actLabel(w: World, c: Creature): string {
  const a = c.act;
  if (c.asleep) return 'asleep';
  switch (a.type) {
    case 'forage': return a.stage === 2 ? 'eating' : 'going to eat';
    case 'rest': return 'heading home to rest';
    case 'socialize': return a.stage === 2 ? `keeping company${a.targetId ? ' with ' + actorName(w, a.targetId) : ''}` : `looking for ${a.targetId ? actorName(w, a.targetId) : 'company'}`;
    case 'investigate': return 'going to look at something';
    case 'experiment': return 'trying something new';
    case 'perform': { const b = a.bId ? w.behaviors[a.bId] : null; const p = b ? w.practices[b.rootId] : null; return p ? `performing ${p.name}` : 'trying out a gesture'; }
    case 'wander': return 'wandering';
    default: return 'pausing';
  }
}

const dayLabel = (tick: number) => `Day ${dayOf(tick) + 1}`;
const pct = (v: number) => `${Math.round(v * 100)}%`;

function Bar({ label, v, kind = '' }: { label: string; v: number; kind?: string }) {
  return <div className="bar"><span>{label}</span><i className={kind}><b style={{ width: pct(Math.max(0, Math.min(1, v))) }} /></i></div>;
}

function CreaturePanel({ c, w }: { c: Creature; w: World }) {
  const mems = c.memories.filter(m => m.kind !== 'food').sort((a, b) => b.salience - a.salience).slice(0, 5);
  const rel = Object.entries(c.relations).sort((a, b) => b[1].trust - a[1].trust).slice(0, 5);
  const t = c.traits, n = c.needs;
  return (
    <div className="panel-body">
      <header className="who"><span className="flame" style={{ background: `hsl(${c.hue},90%,62%)` }} /><div><h2>{c.name}</h2><p>{actLabel(w, c)}</p></div></header>
      <section><h3>Temperament</h3>
        <Bar label="Curiosity" v={t.curiosity} /><Bar label="Sociability" v={t.sociability} /><Bar label="Creativity" v={t.creativity} /><Bar label="Conformity" v={t.conformity} /><Bar label="Caution" v={t.caution} />
      </section>
      <section><h3>Needs right now</h3>
        <Bar label="Hunger" v={n.food} kind="need" /><Bar label="Tiredness" v={n.rest} kind="need" /><Bar label="Loneliness" v={n.belonging} kind="need" /><Bar label="Restlessness" v={n.exploration} kind="need" /><Bar label="Unease" v={n.safety} kind="need" />
      </section>
      <section><h3>What {c.name} keeps</h3>
        {c.repertoire.length === 0 && <p className="quiet">No learned behaviours yet.</p>}
        {c.repertoire.map(e => { const b = w.behaviors[e.behaviorId]; const p = w.practices[b.rootId]; return (
          <button key={e.behaviorId} className="row" onClick={() => p && game.set({ mode: 'discover', practice: p.id, entry: null, place: null, sheet: true })}>
            <Glyph id={b.rootId} /><span><strong>{p?.name ?? 'A gesture not yet tried'}</strong><small>{c.name} {describeBehavior(w, b)}. Learned from {actorName(w, e.from)}; done {e.performances}×; worth {pct(e.value)}.</small></span>
          </button>); })}
      </section>
      <section><h3>On {c.name}'s mind</h3>
        {mems.length === 0 && <p className="quiet">Nothing in particular.</p>}
        {mems.map(m => <p key={m.id} className="mem">{m.kind === 'behavior'
          ? <>Saw {m.actors.map(a => actorName(w, a)).join(', ')} {m.behaviorId && w.behaviors[m.behaviorId] ? describeBehavior(w, w.behaviors[m.behaviorId]).replace(/^(\w+)s /, '$1 ') : 'do something'} <em>({m.count}×, {pct(Math.min(1, m.confidence))} sure)</em></>
          : <>Something changed at {placeName(w, m.x, m.y)} <em>({pct(m.salience)} interesting)</em></>}</p>)}
      </section>
      <section><h3>Trusts most</h3>
        {rel.map(([id, r]) => <Bar key={id} label={actorName(w, id).replace('the hand', 'The hand')} v={r.trust} />)}
      </section>
      <details><summary>Why this choice? (decision scores)</summary>
        {Object.entries(c.scores).sort((a, b) => b[1] - a[1]).map(([k, v]) => <Bar key={k} label={k} v={v / 1.5} kind={k === c.act.type ? 'pick' : 'need'} />)}
        <p className="quiet">The highest score wins when {c.name} next chooses. Scores come from needs × temperament, with a little noise.</p>
      </details>
    </div>
  );
}

function Roster({ w }: { w: World }) {
  return <div className="panel-body"><h2>The wicks of Tallowmere</h2><p className="quiet">Tap a wick on the island, or pick one here.</p>
    {w.creatures.map(c => <button key={c.id} className="row" onClick={() => game.set({ selected: c.id })}><span className="flame" style={{ background: `hsl(${c.hue},90%,62%)` }} /><span><strong>{c.name}</strong><small>{actLabel(w, c)}</small></span></button>)}
  </div>;
}

function eventLine(w: World, e: SimEvent): string {
  const d = describeEvent(w, e);
  if (d) return d.text;
  if (e.type === 'perform') return `${actorName(w, e.actor)} performed ${w.practices[e.data.rootId]?.name ?? 'a gesture'} at ${placeName(w, Math.round(e.x), Math.round(e.y))}${e.data.present.length ? ` with ${e.data.present.length} nearby` : ''}.`;
  if (e.type === 'hear') return `${actorName(w, e.actor)} heard a sound from ${actorName(w, e.data.source)}.`;
  if (e.type === 'call') return `${actorName(w, e.actor)} called out.`;
  return e.type;
}

function Evidence({ w, id }: { w: World; id: string }) {
  const chain = causalChain(w, id);
  return <div className="panel-body">
    <button className="back" onClick={() => game.set({ entry: null })}>← Chronicle</button>
    <h2>{describeEvent(w, chain[0].event)?.title ?? 'Event'}</h2>
    <p className="quiet">Every line below is a recorded event. Indented lines are what caused the line above them.</p>
    <ol className="chain">{chain.map(({ event: e, depth }) => (
      <li key={e.id} style={{ marginLeft: Math.min(depth, 6) * 14 }}>
        <span className="eid">{e.id} · {dayLabel(e.tick)} · {e.type}</span>
        {eventLine(w, e)}
      </li>))}</ol>
  </div>;
}

function Tree({ w, n, depth = 0 }: { w: World; n: VariantNode; depth?: number }) {
  const b = w.behaviors[n.id];
  return <li>
    <div className={'variant' + (n.keepers.length ? '' : ' dead')}>
      <strong>{depth === 0 ? 'Origin' : n.change}</strong>
      <small>{actorName(w, n.creator).replace('the hand', 'The hand')} {depth === 0 ? 'began it' : 'changed it'}: {describeBehavior(w, b)}.</small>
      <small>{n.performances} performances · kept by {n.keepers.length ? n.keepers.map(k => actorName(w, k)).join(', ') : 'no one now'}</small>
    </div>
    {n.children.length > 0 && <ul>{n.children.map(c => <Tree key={c.id} w={w} n={c} depth={depth + 1} />)}</ul>}
  </li>;
}

const STATUS_WORD: Record<string, string> = { emerging: 'Emerging', custom: 'Custom', tradition: 'Tradition', declining: 'Fading', forgotten: 'Forgotten' };

function PracticeView({ w, id }: { w: World; id: string }) {
  const p = w.practices[id]; const root = w.behaviors[p.rootId];
  const chain = transmissionChain(w, id);
  const C = CFG.custom;
  return <div className="panel-body">
    <button className="back" onClick={() => game.set({ practice: null })}>← Customs</button>
    <header className="who"><Glyph id={id} size={34} /><div><h2>{p.name}</h2><p>{shortName(w, root)} · <span className={'pill ' + p.status}>{STATUS_WORD[p.status]}</span></p></div></header>
    <section><h3>Standing</h3>
      <p className="mem">{p.performers.length} performers (a custom needs {C.performers}) · {p.transmissions.length} learnings between wicks (needs {C.transmissions}) · {p.performances} performances (needs {C.performances}) · seen on {p.days.length} days (needs {C.days}).</p>
      <button className="link" onClick={() => game.set({ entry: p.originEvent, practice: null })}>See how it began →</button>
    </section>
    <section><h3>Family tree</h3><ul className="tree"><Tree w={w} n={lineage(w, id)} /></ul></section>
    <section><h3>Who learned from whom</h3>
      {chain.length === 0 && <p className="quiet">No wick has learned this from another yet.</p>}
      {chain.map(t => <button key={t.id} className="row slim" onClick={() => game.set({ entry: t.id, practice: null })}><span><strong>{actorName(w, t.from)} → {actorName(w, t.to)}</strong><small>{dayLabel(t.tick)} · {t.id}</small></span></button>)}
    </section>
  </div>;
}

function Discover({ w }: { w: World }) {
  const [tab, setTab] = useState<'chronicle' | 'customs'>('chronicle');
  const [all, setAll] = useState(false);
  const ui = game.ui;
  const entries = useMemo(() => chronicle(w), [w, w.events.length]);
  if (ui.entry) return <Evidence w={w} id={ui.entry} />;
  if (ui.practice && w.practices[ui.practice]) return <PracticeView w={w} id={ui.practice} />;
  if (ui.place) {
    const here = w.events.filter(e => dist(e.x, e.y, ui.place!.x, ui.place!.y) <= 1.6 && e.type !== 'observe' && e.type !== 'hear').slice(-40).reverse();
    return <div className="panel-body"><button className="back" onClick={() => game.set({ place: null })}>← Chronicle</button><h2>What happened at {placeName(w, ui.place.x, ui.place.y)}</h2>
      {here.length === 0 && <p className="quiet">Nothing recorded on this spot yet.</p>}
      <ol className="chain">{here.map(e => <li key={e.id}><span className="eid">{e.id} · {dayLabel(e.tick)} · {e.type}</span><button className="link plain" onClick={() => game.set({ entry: e.id, place: null })}>{eventLine(w, e)}</button></li>)}</ol></div>;
  }
  const shown = (all ? entries : entries.filter(e => e.weight === 'major')).slice(-120).reverse();
  const practices = Object.values(w.practices).sort((a, b) => b.performances - a.performances);
  return <div className="panel-body">
    <div className="tabs" role="tablist">
      <button role="tab" aria-selected={tab === 'chronicle'} onClick={() => setTab('chronicle')}>Chronicle</button>
      <button role="tab" aria-selected={tab === 'customs'} onClick={() => setTab('customs')}>Customs <em>{practices.filter(p => p.status !== 'forgotten').length}</em></button>
    </div>
    {tab === 'chronicle' ? <>
      <label className="check"><input id="show-all" type="checkbox" checked={all} onChange={e => setAll(e.target.checked)} /> Include small moments</label>
      {shown.length === 0 && <p className="quiet">Nothing of note yet. Try the Influence tools, or simply wait: the wicks have ideas of their own. Tap any spot on the island to read its history.</p>}
      {shown.map(en => <button key={en.id} className={'entry ' + en.weight} onClick={() => game.set({ entry: en.id })}>
        <span className="when">{dayLabel(en.tick)}</span><strong>{en.title}</strong><small>{en.text}</small></button>)}
    </> : <>
      {practices.length === 0 && <p className="quiet">No practices yet. A practice begins the first time a wick performs a behaviour it invented or learned.</p>}
      {practices.map(p => <button key={p.id} className="row" onClick={() => game.set({ practice: p.id })}>
        <Glyph id={p.id} /><span><strong>{p.name} <span className={'pill ' + p.status}>{STATUS_WORD[p.status]}</span></strong>
          <small>{shortName(w, w.behaviors[p.rootId])} · {p.performers.length} performers · {holders(w, p.rootId).length} keep it · {Object.keys(p.variants).length} variant{Object.keys(p.variants).length === 1 ? '' : 's'}</small></span></button>)}
    </>}
  </div>;
}

function savedText(ui: typeof game.ui): string {
  if (ui.saved === 'unavailable') return 'Not saved: this browser is blocking storage';
  if (ui.saved === 'never') return 'Not saved yet';
  const s = Math.max(0, Math.round((Date.now() - ui.savedAt) / 1000));
  return s < 8 ? 'Saved just now' : s < 90 ? `Saved ${s}s ago` : `Saved ${Math.round(s / 60)} min ago`;
}

export function App() {
  useGame();
  const ui = game.ui, w = game.world;
  const [menu, setMenu] = useState(false);
  useEffect(() => { game.boot(); }, []);
  useEffect(() => { if (!ui.toast) return; const t = setTimeout(() => game.set({ toast: null }), 3200); return () => clearTimeout(t); }, [ui.toast?.id]);
  useEffect(() => { if (!ui.notice) return; const t = setTimeout(() => game.set({ notice: null }), 9000); return () => clearTimeout(t); }, [ui.notice]);
  const latest = useMemo(() => { for (let i = w.events.length - 1; i >= Math.max(0, w.events.length - 400); i--) { const d = describeEvent(w, w.events[i]); if (d && d.weight === 'major') return { id: w.events[i].id, ...d }; } return null; }, [w, w.events.length]);
  const sel = ui.selected ? w.creatures.find(c => c.id === ui.selected) : null;
  const phase = phaseOf(w.tick);
  const setMode = (mode: Mode) => game.set({ mode, held: null, sheet: mode !== 'influence' });
  const tool = TOOLS.find(t => t.id === ui.tool)!;
  const sheetOpen = ui.sheet && ui.mode !== 'influence';
  return (
    <div className={'app' + (sheetOpen ? ' with-sheet' : '') + (ui.reduced ? ' reduced' : '')}>
      <WorldCanvas />
      <header className="top">
        <div className="brand"><h1>Elsewhere</h1><p>Tallowmere · {dayLabel(w.tick)} · <span className="phase">{phase}</span></p></div>
        <div className="time" role="group" aria-label="Time">
          {[[0, 'Pause', '❙❙'], [1, 'Normal speed', '1×'], [4, 'Four times speed', '4×'], [16, 'Sixteen times speed', '16×']].map(([s, label, text]) =>
            <button key={s} aria-label={label as string} aria-pressed={ui.speed === s} onClick={() => game.set({ speed: s as number })}>{text}</button>)}
        </div>
        <div className="menu-wrap">
          <button className="menu-btn" aria-expanded={menu} aria-label="Island menu" onClick={() => setMenu(!menu)}>⋯</button>
          {menu && <div className="menu">
            <p className="saved">{savedText(ui)}</p>
            <button onClick={() => { game.save(); setMenu(false); }}>Save now</button>
            <label className="check"><input id="reduced-motion" type="checkbox" checked={ui.reduced} onChange={e => game.set({ reduced: e.target.checked })} /> Reduce motion</label>
            {ui.confirmNew
              ? <div className="confirm"><p>Start over? This island and its history will be erased.</p><button className="danger" onClick={() => { game.newWorld(); setMenu(false); }}>Erase and begin anew</button><button onClick={() => game.set({ confirmNew: false })}>Keep this island</button></div>
              : <button onClick={() => game.set({ confirmNew: true })}>New island…</button>}
          </div>}
        </div>
      </header>

      {ui.notice && <div className="notice" role="status">{ui.notice}</div>}
      {ui.hint && ui.mode === 'influence' && <div className="hint">You cannot command anyone here. Pick up a stone and set it down near a wick. Someone may be watching.</div>}

      {ui.mode !== 'discover' && latest && !sheetOpen && <button className="latest" onClick={() => game.set({ mode: 'discover', entry: latest.id, sheet: true })}>
        <span>Latest in the Chronicle</span><strong>{latest.title}</strong></button>}

      {sheetOpen && <aside className="sheet" aria-label={ui.mode === 'observe' ? 'Creature' : 'Chronicle'}>
        <button className="close" aria-label="Close panel" onClick={() => game.set({ sheet: false })}>×</button>
        {ui.mode === 'observe' ? (sel ? <CreaturePanel c={sel} w={w} /> : <Roster w={w} />) : <Discover w={w} />}
      </aside>}

      <footer className="dock">
        {ui.mode === 'influence' && <div className="tray">
          <p className="tool-help" aria-live="polite">{ui.tool === 'move' && ui.held ? `Holding a ${w.objects[ui.held]?.kind ?? 'thing'}. Tap dry ground to set it down.` : tool.help}</p>
          <div className="tools" role="group" aria-label="Ways to influence">
            {TOOLS.map(t => <button key={t.id} aria-pressed={ui.tool === t.id} onClick={() => game.set({ tool: t.id, held: null })}><Icon name={t.id} /><span>{t.label}</span></button>)}
          </div>
        </div>}
        <nav className="modes" aria-label="Mode">
          {(['observe', 'influence', 'discover'] as Mode[]).map(m => <button key={m} aria-pressed={ui.mode === m} onClick={() => (ui.mode === m && m !== 'influence' ? game.set({ sheet: !ui.sheet }) : setMode(m))}><Icon name={m} /><span>{m[0].toUpperCase() + m.slice(1)}</span></button>)}
        </nav>
      </footer>

      <div className="toasts" role="status" aria-live="polite">{ui.toast && <div className="toast" key={ui.toast.id}>{ui.toast.text}</div>}</div>
    </div>
  );
}
