import type { Phase } from './types';

// Every threshold that decides what counts as "culture" lives here so it is
// explicit, testable and tunable.
export const CFG = {
  SIM_VERSION: 1,
  TPS: 10,
  DAY: 1800,                 // ticks per island day (3 minutes at 1x)
  W: 24, H: 24,
  perception: 6.5,
  hearRadius: 8,
  speed: 0.085,              // tiles per tick
  memoryCap: 20,
  repertoireCap: 3,
  maxLogs: 6,
  maxLumens: 3,
  custom: { performers: 3, transmissions: 2, performances: 6, days: 2 },
  tradition: { performers: 5, performances: 24, days: 4, depth: 2 },
  declineDays: 2,
  mutation: { maxShift: 3, maxCount: 3, maxSteps: 3 },
  offlineCapTicks: 3 * 1800, // offline catch-up never exceeds three island days
  learningEnabled: true,     // tests switch this off to prove culture needs transmission
};

export function dayOf(tick: number): number { return Math.floor(tick / CFG.DAY); }
export function dayFrac(tick: number): number { return (tick % CFG.DAY) / CFG.DAY; }
export function phaseOf(tick: number): Phase {
  const f = dayFrac(tick);
  if (f < 0.1) return 'dawn';
  if (f < 0.62) return 'day';
  if (f < 0.78) return 'dusk';
  return 'night';
}
export const PHASES: Phase[] = ['dawn', 'day', 'dusk', 'night'];
