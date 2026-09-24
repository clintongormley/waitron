import type { Database } from "@waitron/db";
import { AppError } from "@waitron/shared";
import { imageMigrationHashes, journalHashes, type MigrationSetSource } from "@waitron/migrations";
import "./errors.js";

export interface AheadSet {
  set: string;
  /** Drizzle hashes present in the database's journal that this image ships no file for. */
  unknownMigrations: string[];
}

/**
 * One direction only: a database BEHIND the image is an ordinary upgrade, and only the ahead
 * direction is unrecoverable. That is what lets the container entrypoint
 * (`apps/server/src/node-entry.ts`) run this check BEFORE anything migrates.
 */
export function unknownHashes(inDatabase: readonly string[], inImage: readonly string[]): string[] {
  const shipped = new Set(inImage);
  return inDatabase.filter((hash) => !shipped.has(hash));
}

/**
 * A set with no journal table has never been migrated here — the normal state of a module this
 * deployment does not enable — so it is skipped before the image's files are read, and a packaging
 * fault in an unused module's folder cannot fail a boot that never needed it.
 */
export async function findAheadSets(
  db: Pick<Database, "execute">,
  sets: readonly MigrationSetSource[],
  root: string | null,
): Promise<AheadSet[]> {
  const ahead: AheadSet[] = [];
  for (const set of sets) {
    const inDatabase = await journalHashes(db, set);
    if (inDatabase === null) continue;
    const unknownMigrations = unknownHashes(inDatabase, imageMigrationHashes(set, root));
    if (unknownMigrations.length > 0) ahead.push({ set: set.name, unknownMigrations });
  }
  return ahead;
}

/** Reports only the FIRST ahead set: one named set with its unknown hashes is what an installer
 * acts on. */
export async function assertNotAhead(
  db: Pick<Database, "execute">,
  sets: readonly MigrationSetSource[],
  root: string | null,
): Promise<void> {
  const ahead = await findAheadSets(db, sets, root);
  const first = ahead[0];
  if (first !== undefined) throw new AppError("provisioning.database_ahead", first);
}
