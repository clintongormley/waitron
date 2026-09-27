import type { Database } from "@waitron/db";

/**
 * One value per venue store, made on first use: here, the work each store has running in this
 * process. One process owns a venue at a time, so an id missing from such a registry belongs to
 * work that has ended, in this process or in one that died.
 */
export function perDatabase<T>(make: () => T): (db: Database) => T {
  const byDatabase = new WeakMap<Database, T>();
  return (db) => {
    let value = byDatabase.get(db);
    if (value === undefined) {
      value = make();
      byDatabase.set(db, value);
    }
    return value;
  };
}

/** Put `id` in `live`, answering what takes it out again. */
export function claimLive(live: Set<string>, id: string): () => void {
  live.add(id);
  return () => {
    live.delete(id);
  };
}
