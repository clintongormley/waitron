import { rm } from "node:fs/promises";
import { join } from "node:path";
import { DATABASE_FILES, SIDE_FILE_SUFFIXES, VENUE_FILE } from "@waitron/store";
import { litestreamMetaDir } from "@waitron/stream/litestream.js";

/**
 * Discard this node's whole local database. The caller holds the venue lock.
 *
 * `migrations.lock` and `venue.lock` are deliberately left where they are: they carry no data, and
 * unlinking a held lock file lets another opener take a new one beside the holder. Measured with a
 * control: while one connection holds `begin immediate` on `migrations.lock`, a second opener of
 * the same path is refused `database is locked` (errcode 5), and a second opener after the path is
 * unlinked acquires it at once. `venue.holder.json`, which names the process holding `venue.lock`, is
 * left too.
 *
 * Each removal is `force`, so a box that never migrated, or a half-wiped one being re-run, succeeds.
 */
export async function wipeVenueDatabases(venueDir: string): Promise<void> {
  for (const file of DATABASE_FILES) {
    for (const suffix of ["", ...SIDE_FILE_SUFFIXES]) {
      await rm(join(venueDir, `${file}${suffix}`), { force: true });
    }
  }
  await rm(litestreamMetaDir(join(venueDir, VENUE_FILE)), { recursive: true, force: true });
}
