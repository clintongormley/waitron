import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll } from "vitest";
import { openVenueDatabase } from "@waitron/db";
import { applyMigrationSet, type VenueMigrationSet } from "@waitron/db/testing/venue-db.js";

/**
 * A folder whose `venue.db` and `node.db` hold `sets`, migrated once per test file and removed
 * after it. Call it at a file's top level: the parent folder is read then, before a suite can
 * point TMPDIR at a small disk it fills on purpose.
 */
export function migratedTemplate(
  prefix: string,
  sets: readonly VenueMigrationSet[],
): () => Promise<string> {
  const parent = tmpdir();
  let template: Promise<string> | undefined;
  let templateFolder: string | undefined;
  afterAll(async () => {
    // A template that failed has already failed every test that awaited it.
    await template?.catch(() => {});
    if (templateFolder !== undefined) await rm(templateFolder, { recursive: true, force: true });
    template = templateFolder = undefined;
  });
  return () => {
    template ??= (async () => {
      const folder = (templateFolder = await mkdtemp(join(parent, prefix)));
      const migrated = await openVenueDatabase(folder);
      try {
        for (const set of sets)
          await applyMigrationSet(set.database === "node" ? migrated.node : migrated.venue, set);
      } finally {
        // Closing the last connection checkpoints each file and deletes its -wal, so the two
        // database files alone hold everything.
        await migrated.close();
      }
      return folder;
    })();
    return template;
  };
}
