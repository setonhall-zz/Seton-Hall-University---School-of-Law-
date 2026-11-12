import { CFG } from '../sim/config';
import { fnv } from '../sim/rng';
import { restoreWorld, snapshotBody } from '../sim/world';
import type { SimEvent, World } from '../sim/types';

// IndexedDB persistence: one versioned snapshot record plus an append-only
// event store. Snapshot and new events are written in a single transaction so
// a save is all-or-nothing.

const DB = 'elsewhere', SNAP = 'snapshot', EV = 'events';
export const SCHEMA = 1;

export interface SnapshotRecord { key: 'current'; schema: number; simVersion: number; runId: string; body: string; eventOffset: number; checksum: string; savedAt: number }
export type LoadResult = { status: 'ok'; world: World; runId: string; savedAt: number } | { status: 'empty' } | { status: 'invalid'; reason: string };

function open(idb: IDBFactory): Promise<IDBDatabase> {
  return new Promise((res, rej) => {
    const r = idb.open(DB, 1);
    r.onupgradeneeded = () => { const d = r.result; if (!d.objectStoreNames.contains(SNAP)) d.createObjectStore(SNAP, { keyPath: 'key' }); if (!d.objectStoreNames.contains(EV)) d.createObjectStore(EV); };
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
}
const req = <T>(r: IDBRequest<T>) => new Promise<T>((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });

export async function saveWorld(w: World, runId: string, idb: IDBFactory = indexedDB): Promise<number> {
  const db = await open(idb);
  try {
    const tx = db.transaction([SNAP, EV], 'readwrite');
    const done = new Promise<void>((res, rej) => { tx.oncomplete = () => res(); tx.onerror = () => rej(tx.error); tx.onabort = () => rej(tx.error); });
    const prev = (await req(tx.objectStore(SNAP).get('current'))) as SnapshotRecord | undefined;
    let from = 0;
    if (prev && prev.runId === runId && prev.eventOffset <= w.events.length) from = prev.eventOffset;
    else tx.objectStore(EV).clear();
    for (let i = from; i < w.events.length; i++) tx.objectStore(EV).put(w.events[i], i);
    const body = snapshotBody(w);
    const rec: SnapshotRecord = { key: 'current', schema: SCHEMA, simVersion: CFG.SIM_VERSION, runId, body, eventOffset: w.events.length, checksum: fnv(body), savedAt: Date.now() };
    tx.objectStore(SNAP).put(rec);
    await done;
    return rec.savedAt;
  } finally { db.close(); }
}

// Explicit, per-version migrations. Unknown versions are refused, never guessed at.
export function migrate(rec: SnapshotRecord): SnapshotRecord {
  if (rec.schema === SCHEMA) return rec;
  throw new Error(`save schema ${rec.schema} is not supported by this build`);
}

export async function loadWorld(idb: IDBFactory = indexedDB): Promise<LoadResult> {
  const db = await open(idb);
  try {
    const tx = db.transaction([SNAP, EV], 'readonly');
    const raw = (await req(tx.objectStore(SNAP).get('current'))) as SnapshotRecord | undefined;
    if (!raw) return { status: 'empty' };
    let rec: SnapshotRecord;
    try { rec = migrate(raw); } catch (e: any) { return { status: 'invalid', reason: e.message }; }
    if (typeof rec.body !== 'string' || fnv(rec.body) !== rec.checksum) return { status: 'invalid', reason: 'snapshot checksum mismatch' };
    if (rec.simVersion !== CFG.SIM_VERSION) return { status: 'invalid', reason: 'saved by a different simulation version' };
    const events = (await req(tx.objectStore(EV).getAll(IDBKeyRange.bound(0, rec.eventOffset, false, true)))) as SimEvent[];
    if (events.length !== rec.eventOffset || events.some((e, i) => e.id !== 'e' + i)) return { status: 'invalid', reason: 'event history is incomplete' };
    let world: World;
    try { world = restoreWorld(rec.body, events); } catch { return { status: 'invalid', reason: 'snapshot could not be parsed' }; }
    if (!Array.isArray(world.creatures) || world.eventSeq !== events.length) return { status: 'invalid', reason: 'snapshot and history disagree' };
    return { status: 'ok', world, runId: rec.runId, savedAt: rec.savedAt };
  } finally { db.close(); }
}

export async function clearSave(idb: IDBFactory = indexedDB): Promise<void> {
  const db = await open(idb);
  try {
    const tx = db.transaction([SNAP, EV], 'readwrite');
    const done = new Promise<void>((res, rej) => { tx.oncomplete = () => res(); tx.onerror = () => rej(tx.error); });
    tx.objectStore(SNAP).clear(); tx.objectStore(EV).clear();
    await done;
  } finally { db.close(); }
}
