// Core data model. Everything in World is plain JSON so it can be hashed,
// snapshotted and replayed deterministically.

export const T_WATER = 0, T_SHALLOWS = 1, T_SAND = 2, T_GRASS = 3, T_GROVE = 4, T_ROCK = 5;

export type Phase = 'dawn' | 'day' | 'dusk' | 'night';
export type ObjKind = 'stone' | 'shell' | 'bush' | 'fruit' | 'clam' | 'log' | 'lumen';
export type Step = 'place:stone' | 'place:shell' | 'place:lumen' | 'splash' | 'call' | 'dance';
export type Shape = 'pile' | 'ring' | 'line';

export interface Obj {
  id: string;
  kind: ObjKind;
  x: number; y: number;            // tile
  carriedBy: string | null;
  food: number;                    // berries on a bush / 1 for fruit & clam
  regrowAt: number;
  byHand: boolean;                 // placed by the player
  novelTick: number;               // last tick the hand touched it (-1 = never)
  causeEvent: string | null;       // the event that made it novel
}

export interface Traits { curiosity: number; sociability: number; creativity: number; conformity: number; caution: number }
export interface Needs { food: number; rest: number; safety: number; belonging: number; exploration: number }

export interface Memory {
  id: number;
  kind: 'behavior' | 'novelty' | 'food';
  actor: string;                   // who was seen ('hand' for the player)
  actors: string[];                // distinct actors seen doing it
  behaviorId: string | null;
  objId: string | null;
  x: number; y: number;
  tick: number;                    // last reinforced
  salience: number;
  confidence: number;
  outcome: number;                 // perceived usefulness 0..1
  count: number;
  sourceEvents: string[];          // perception evidence
}

export interface Relation { trust: number; familiarity: number }

export interface RepEntry {
  behaviorId: string;
  value: number;                   // learned expectation of reward
  from: string;                    // actor it was learned from ('self' = invented)
  adoptEvent: string;
  performances: number;
  last: number;
  depth: number;                   // transmission depth (0 = origin)
}

export interface Act {
  type: 'idle' | 'wander' | 'forage' | 'rest' | 'socialize' | 'investigate' | 'perform' | 'experiment';
  stage: number;
  timer: number;
  tx: number; ty: number;
  targetId: string | null;
  bId: string | null;
  idx: number;                     // step cursor inside a performance
  yielded: boolean;
  cause: string | null;
  since: number;
}

export interface Creature {
  id: string;
  name: string;
  x: number; y: number;
  hx: number; hy: number;          // home
  hue: number;
  traits: Traits;
  needs: Needs;
  perception: number;
  memories: Memory[];
  memSeq: number;
  seen: Record<string, number>;
  relations: Record<string, Relation>;
  repertoire: RepEntry[];
  act: Act;
  path: number[];
  carrying: string | null;
  asleep: boolean;
  scores: Record<string, number>;  // last decision, for the inspector
  inspired: { x: number; y: number; cause: string } | null;
  lastExperimentDay: number;
  face: number;
}

export interface Behavior {
  id: string;
  rootId: string;
  parentId: string | null;
  steps: Step[];
  x: number; y: number;
  phase: Phase | 'any';
  count: number;
  shape: Shape;
  creator: string;
  origin: string;                  // event id
  change: string | null;           // what mutated relative to the parent
  bornTick: number;
}

export interface VariantStat { performers: string[]; performances: number; branched: boolean }

export type PracticeStatus = 'emerging' | 'custom' | 'tradition' | 'declining' | 'forgotten';

export interface Practice {
  id: string;
  rootId: string;
  name: string;
  originEvent: string;
  status: PracticeStatus;
  peak: PracticeStatus;
  performers: string[];
  performances: number;
  performEvents: string[];         // most recent, capped
  transmissions: string[];
  days: number[];
  maxDepth: number;
  lastDay: number;
  variants: Record<string, VariantStat>;
}

export interface Site { id: string; x: number; y: number; name: string; event: string }

export interface SimEvent {
  id: string;
  tick: number;
  type: string;
  actor: string;
  x: number; y: number;
  data: Record<string, any>;
  parents: string[];
}

export type PlayerAction =
  | { kind: 'move'; objId: string; x: number; y: number }
  | { kind: 'food'; x: number; y: number }
  | { kind: 'signal'; x: number; y: number }
  | { kind: 'log'; x: number; y: number }
  | { kind: 'lumen'; x: number; y: number }
  | { kind: 'catchup'; ticks: number; capped: boolean };

export interface Fx { type: 'splash' | 'call' | 'dance' | 'hand' | 'eat' | 'drop'; x: number; y: number; tick: number; id?: string }

export interface World {
  version: number;
  seed: number;
  rng: number;
  tick: number;
  w: number; h: number;
  terrain: number[];
  objects: Record<string, Obj>;
  nextId: number;
  creatures: Creature[];
  behaviors: Record<string, Behavior>;
  practices: Record<string, Practice>;
  sites: Site[];
  siteTally: Record<string, { n: number; last: number; events: string[] }>;
  eventSeq: number;
  schedule: { tick: number; action: PlayerAction }[];
  // not part of the snapshot body:
  events: SimEvent[];
  fx: Fx[];
}
