import { rm } from "node:fs/promises";
import { join } from "node:path";
import { litestreamMetaDir } from "@waitron/stream/litestream.js";

/**
 * The two database files `openVenueStore` opens in a venue directory
 * (`packages/store/src/index.ts`), and the write-ahead sidecars each of them is kept with.
 *
 * The sidecars are part of the database rather than scratch: a committed row can live in `-wal`
 * alone, which is what a box killed mid-service leaves behind. Measured on Node v26.7.0 against a
 * SIGKILLed writer — removing `venue.db-wal` alone, with `venue.db` untouched, already loses the
 * row the crashed writer committed.
 */
const VENUE_FILES = ["venue.db", "node.db"] as const;
const SIDECARS = ["", "-wal", "-shm"] as const;

/**
 * Discard this node's whole local database — the wipe half of R3 rejoin (spec §4.4). The caller
 * re-migrates the directory afterwards, and `applyMigrations` recreates both files.
 *
 * **BOTH files go, and today only one of them holds anything.** `applyMigrations` sends every set
 * to the VENUE handle and leaves the node file empty (`packages/migrations/src/apply.ts`) — the
 * same fact `rejoin-command.ts` and `break-glass-command.ts` record where they open their own
 * handles. Measured on this tree: a migrate of every manifest set into an empty directory leaves
 * `node.db` created but with ZERO rows in `sqlite_master`, against hundreds in `venue.db`. So
 * `node_membership` — the fenced standing this command exists to discard — is removed with
 * `venue.db`, and `node.db` goes because it is the other file the venue directory is made of, not
 * because emptying it discards anything.
 *
 * Keeping the second removal costs one line and stays right if a later slice puts tables into
 * `node.db` (slice-2 spec §2 reserves it); until then the claim to hold onto is the measured one
 * above.
 *
 * **What a leftover sidecar does NOT do here, stated so nobody carries `restore.ts`'s reading
 * across.** A restore REPLACES `venue.db` with another database, and there a stale `-wal` is
 * recovered over the incoming file and silently wins. A wipe UNLINKS instead, and that case does
 * not arise: measured on Node v26.7.0, four ways — a SIGKILLed writer's directory and a directory
 * whose connection is still open, each with the main file removed alone and with all three removed
 * — every one of them answers `no such table` on the next open, and a re-migrate afterwards lands
 * cleanly. So the sidecars are removed because they ARE the database by name and a file claiming
 * to belong to a path this command has emptied is a trap for the next reader, not because a probe
 * showed data coming back. The proof that they go is the filesystem assertion in `db-wipe.test.ts`,
 * which is what fails if the suffixes are dropped.
 *
 * **`migrations.lock` is deliberately left where it is.** It carries no data, and unlinking it
 * breaks the one thing it does: measured, with a control — while one connection holds
 * `begin immediate` on the file, a second opener of the same path is refused `database is locked`
 * (errcode 5), and a second opener after the path is unlinked acquires it at once, so two
 * migrators would no longer be serialised (`packages/migrations/src/apply.ts`). `venue.lock`, and
 * `venue.lock-journal` while it is held, stay for the same reason: unlinking `venue.lock` while held
 * let another process take it at once (measured, `docs/developers/conventions-data.md`, "One
 * process per venue folder"). The wipe runs under that lock (`rejoin-command.ts`).
 *
 * The directory itself stays too; `applyMigrations` would recreate it, but nothing here needs it
 * gone and removing a directory an operator configured is wider than this command's remit.
 *
 * Each removal is `force`, so a box that never migrated — or a half-wiped one being re-run — is a
 * success and not an `ENOENT`. What this costs is stated in `rejoin.ts`: nothing confirms that the
 * rows this node originated reached the carrier before the wipe, so the caller wipes without that
 * confirmation.
 *
 * Litestream's folder beside `venue.db`: slice-2 plan, Reconciliation L3.
 */
export async function wipeVenueDatabases(venueDir: string): Promise<void> {
  for (const file of VENUE_FILES) {
    for (const suffix of SIDECARS) {
      await rm(join(venueDir, `${file}${suffix}`), { force: true });
    }
  }
  await rm(litestreamMetaDir(join(venueDir, "venue.db")), { recursive: true, force: true });
}
