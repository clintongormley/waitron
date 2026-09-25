import { rm } from "node:fs/promises";
import { join } from "node:path";
import { litestreamMetaDir } from "@waitron/stream/litestream.js";

/** A committed row can live in `-wal` alone, so the sidecars are part of the database. */
const VENUE_FILES = ["venue.db", "node.db"] as const;
const SIDECARS = ["", "-wal", "-shm"] as const;

/**
 * Discard this node's whole local database, for rejoin. The caller re-migrates the directory
 * afterwards.
 *
 * `migrations.lock` and `venue.lock` are deliberately left where they are: they carry no data, and
 * unlinking a held lock file lets another opener take a new one beside the holder. Measured with a
 * control: while one connection holds `begin immediate` on `migrations.lock`, a second opener of
 * the same path is refused `database is locked` (errcode 5), and a second opener after the path is
 * unlinked acquires it at once. The wipe runs under the venue lock (`rejoin-command.ts`).
 *
 * Each removal is `force`, so a box that never migrated, or a half-wiped one being re-run, succeeds.
 */
export async function wipeVenueDatabases(venueDir: string): Promise<void> {
  for (const file of VENUE_FILES) {
    for (const suffix of SIDECARS) {
      await rm(join(venueDir, `${file}${suffix}`), { force: true });
    }
  }
  await rm(litestreamMetaDir(join(venueDir, "venue.db")), { recursive: true, force: true });
}
