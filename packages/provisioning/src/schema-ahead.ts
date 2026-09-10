import type { Database } from "@waitron/db";
import { AppError } from "@waitron/shared";
import { imageMigrationHashes, journalHashes, type MigrationSet } from "@waitron/migrations";
import "./errors.js";

export interface AheadSet {
  set: string;
  /** Drizzle hashes present in the database's journal that this image ships no file for. */
  unknownMigrations: string[];
}

/**
 * The database hashes this image has no file for. Set difference in ONE direction only: a database
 * BEHIND the image is an ordinary upgrade, which `ensureInstance` has already migrated forward by
 * the time this runs, and only the ahead direction is unrecoverable.
 */
export function unknownHashes(inDatabase: readonly string[], inImage: readonly string[]): string[] {
  const shipped = new Set(inImage);
  return inDatabase.filter((hash) => !shipped.has(hash));
}

/**
 * Every migration set whose database journal carries a migration this image cannot account for.
 *
 * A set with no journal table is skipped rather than reported: it has simply never been migrated
 * here, which is the normal state of a module this deployment does not enable. The image's files are
 * not even read for such a set — cheaper, and it keeps a packaging fault in an unused module's
 * folder from failing a boot that never needed it.
 */
export async function findAheadSets(
  db: Pick<Database, "execute">,
  sets: readonly MigrationSet[],
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

/**
 * Refuse to boot against a database a different image migrated.
 *
 * Runs AFTER `ensureInstance` so a legitimately behind database has already been brought forward,
 * and BEFORE `startServer` so the failure is named here rather than surfacing as an unclassified
 * driver error in whatever query first touches the changed schema. Reports the FIRST ahead set: one
 * named set with its unknown hashes is what an installer acts on, and every set after it tells the
 * same story.
 */
export async function assertNotAhead(
  db: Pick<Database, "execute">,
  sets: readonly MigrationSet[],
  root: string | null,
): Promise<void> {
  const ahead = await findAheadSets(db, sets, root);
  const first = ahead[0];
  if (first !== undefined) throw new AppError("provisioning.database_ahead", first);
}
