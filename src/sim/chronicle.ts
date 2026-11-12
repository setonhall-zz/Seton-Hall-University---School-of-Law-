import { CFG, dayOf } from './config';
import { describeBehavior, shortName } from './behavior';
import { placeName } from './nav';
import { actorName, getEvent } from './world';
import type { SimEvent, World } from './types';

// The Chronicle is a pure function of the event log. It never adds facts:
// every sentence is a template filled from one event and its ids.

export interface Entry { id: string; tick: number; day: number; weight: 'major' | 'minor'; title: string; text: string; evidence: string[]; x: number; y: number }

const pname = (w: World, rootId: string) => { const p = w.practices[rootId]; return p ? `${p.name}` : 'an unnamed act'; };

export function describeEvent(w: World, e: SimEvent): { title: string; text: string; weight: 'major' | 'minor' } | null {
  const who = actorName(w, e.actor);
  const at = placeName(w, Math.round(e.x), Math.round(e.y));
  const b = e.data.behaviorId ? w.behaviors[e.data.behaviorId] : undefined;
  const d = e.data;
  const m = (title: string, text: string) => ({ title, text, weight: 'major' as const });
  const n = (title: string, text: string) => ({ title, text, weight: 'minor' as const });
  switch (e.type) {
    case 'world.begin': return n('The island wakes', `Tallowmere begins. Eight wicks, no customs, nothing remembered.`);
    case 'world.catchup': return n('Time passed while you were away', `The island lived ${(d.ticks / CFG.DAY).toFixed(1)} days on its own${d.capped ? ' (catch-up is capped at three days; anything longer is not simulated)' : ''}.`);
    case 'hand.arrange': return n('The hand moved a ' + d.kind, `A ${d.kind} was set down at ${at}.`);
    case 'hand.food': return n('The hand left fruit', `Fruit appeared at ${at}.`);
    case 'hand.splash': return n('The water was stirred', `Something unseen splashed at ${at}.`);
    case 'hand.call': return n('A sound rang out', `A clear note sounded over ${at}.`);
    case 'hand.block': return n('A log fell across the way', `A log now lies at ${at}.`);
    case 'hand.clear': return n('A log was lifted', `The way at ${at} is open again.`);
    case 'hand.lumen': return n('A lumen arrived', `A small light no wick has seen before rests at ${at}.`);
    case 'notice': return n(`${who} noticed something`, `${who} saw that a ${d.kind} at ${at} was not as it had been.`);
    case 'hear': return null;
    case 'call': return null;
    case 'gather': return n('A gathering', `${d.present.length} wicks were together at ${at}.`);
    case 'investigate': return n(`${who} went to look`, `${who} walked to ${at} to inspect what had changed.`);
    case 'eat.gift': return n(`${who} ate the gift`, `${who} ate fruit the hand left at ${at} and trusts the hand a little more.`);
    case 'observe': return d.actor === 'hand' ? n(`${who} was watching`, `${who} saw the hand at work at ${at}.`) : n(`${who} watched ${actorName(w, d.actor)}`, `${who} saw ${actorName(w, d.actor)} perform ${pname(w, d.rootId)}.`);
    case 'reject': return n(`${who} was not convinced`, `${who} watched ${actorName(w, d.actor)} and decided against copying.`);
    case 'innovate': return m(`${who} tried something new`, `${who} ${d.inspired ? 'came away from looking with an idea' : 'had an idea'}: ${who} ${b ? describeBehavior(w, b) : d.what}.`);
    case 'adopt': return d.from === 'hand'
      ? m(`${who} took up the hand's gesture`, `After watching, ${who} decided to try it: ${b ? describeBehavior(w, b) : ''}.`)
      : n(`${who} decided to copy ${actorName(w, d.from)}`, `${who} will try ${pname(w, d.rootId)}.`);
    case 'mutate': return m(`${who}'s copy came out different`, `${who} did not copy faithfully: ${d.change}. A new variant of ${pname(w, d.rootId)} exists.`);
    case 'transmit': return m(`${actorName(w, d.from)} → ${actorName(w, d.to)}`, `${actorName(w, d.to)} learned ${pname(w, d.rootId)} by watching ${actorName(w, d.from)}${d.depth > 1 ? `, ${d.depth} hands removed from its origin` : ''}.`);
    case 'perform':
      if (!d.first) return null;
      return d.from === 'hand' ? m(`First imitation by ${who}`, `${who} repeated what the hand had shown: ${who} ${b ? describeBehavior(w, b) : ''}. Nobody asked for this.`)
        : d.from === 'self' ? null
        : m(`${who} performed ${pname(w, d.rootId)}`, `${who}'s first time, learned from ${actorName(w, d.from)}${d.present.length ? `, with ${d.present.length} nearby` : ''}.`);
    case 'practice.begin': { const root = w.behaviors[d.practiceId]; return m(`A practice begins: ${d.name}`, `${shortName(w, root)}. ${who} was first to perform it.`); }
    case 'practice.status': {
      const name = pname(w, d.practiceId);
      const facts = `${d.performers} wicks have performed it ${d.performances} times across ${d.days} days, with ${d.transmissions} learnings from one wick to another.`;
      if (d.to === 'custom') return m(`${name} is now a custom`, facts);
      if (d.to === 'tradition') return m(`${name} has become a tradition`, `${facts} It has passed ${d.depth} hands from its origin.`);
      if (d.to === 'declining') return m(`${name} is fading`, `Nobody has performed it for ${CFG.declineDays} days.`);
      if (d.to === 'forgotten') return m(`${name} is forgotten`, `No wick keeps it any longer.`);
      return m(`${name} stirs again`, `It is being performed once more. ${facts}`);
    }
    case 'practice.branch': return m(`${pname(w, d.practiceId)} has branched`, `${d.performers.length} wicks now keep a variant: ${d.change}.`);
    case 'site.new': return m('A gathering place', `Wicks have met at ${at} ${d.gatherings} separate times. They now head there for company.`);
    case 'forget': return n(`${who} let ${pname(w, d.rootId)} go`, `${who} no longer keeps it: ${d.why}.`);
  }
  return null;
}

export function chronicle(w: World, from = 0): Entry[] {
  const out: Entry[] = [];
  for (let i = from; i < w.events.length; i++) {
    const e = w.events[i];
    if (e.type === 'observe' && e.data.actor !== 'hand') continue;
    const d = describeEvent(w, e);
    if (d) out.push({ id: e.id, tick: e.tick, day: dayOf(e.tick), ...d, evidence: [e.id, ...e.parents], x: e.x, y: e.y });
  }
  return out;
}

// Walk the causal parents of an event back to their roots.
export function causalChain(w: World, id: string, maxDepth = 10): { event: SimEvent; depth: number }[] {
  const out: { event: SimEvent; depth: number }[] = [];
  const seen = new Set<string>();
  const walk = (eid: string, depth: number) => {
    if (seen.has(eid) || depth > maxDepth || out.length > 40) return;
    seen.add(eid);
    const e = getEvent(w, eid);
    if (!e) return;
    out.push({ event: e, depth });
    for (const p of e.parents) walk(p, depth + 1);
  };
  walk(id, 0);
  return out;
}

// Lineage: variants of a practice as a tree, with who keeps each one.
export interface VariantNode { id: string; change: string | null; creator: string; keepers: string[]; performers: string[]; performances: number; children: VariantNode[] }
export function lineage(w: World, rootId: string): VariantNode {
  const build = (id: string): VariantNode => {
    const b = w.behaviors[id];
    const p = w.practices[rootId];
    const v = p?.variants[id];
    return {
      id, change: b.change, creator: b.creator,
      keepers: w.creatures.filter(c => c.repertoire.some(e => e.behaviorId === id)).map(c => c.id),
      performers: v?.performers ?? [], performances: v?.performances ?? 0,
      children: Object.values(w.behaviors).filter(k => k.parentId === id).map(k => build(k.id)),
    };
  };
  return build(rootId);
}
export function transmissionChain(w: World, rootId: string): { from: string; to: string; tick: number; id: string }[] {
  return w.events.filter(e => e.type === 'transmit' && e.data.rootId === rootId).map(e => ({ from: e.data.from, to: e.data.to, tick: e.tick, id: e.id }));
}
