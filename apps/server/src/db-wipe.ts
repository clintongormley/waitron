import { rm } from "node:fs/promises";
import { join } from "node:path";

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
 * **BOTH files go, and that is the whole point rather than tidiness.** The class a table is
 * declared with chooses the file it lives in — `local` in `node.db`, `ledger` and `state` in
 * `venue.db` (`packages/sync-enrolment/src/classification.ts`) — and `node_membership`, the
 * fenced standing this command exists to discard, is `local`
 * (`packages/db/src/classification.ts:85`). A wipe that kept `node.db` would leave the wiped box
 * holding its own membership record, its sessions and its pairing codes, and the next boot's
 * setup mode would be adopting a node that still believes it is a member.
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
 * migrators would no longer be serialised (`packages/migrations/src/apply.ts`).
 *
 * The directory itself stays too; `applyMigrations` would recreate it, but nothing here needs it
 * gone and removing a directory an operator configured is wider than this command's remit.
 *
 * Each removal is `force`, so a box that never migrated — or a half-wiped one being re-run — is a
 * success and not an `ENOENT`. What this costs is stated in `rejoin.ts`: nothing confirms that the
 * rows this node originated reached the carrier before the wipe, so the caller wipes without that
 * confirmation.
 */
export async function wipeVenueDatabases(venueDir: string): Promise<void> {
  for (const file of VENUE_FILES) {
    for (const suffix of SIDECARS) {
      await rm(join(venueDir, `${file}${suffix}`), { force: true });
    }
  }
}
