import { mkdir, mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { sql } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { openVenueDatabase, type VenueDatabase } from "@waitron/db";
import { wipeVenueDatabases } from "./db-wipe.js";

const WIPED = [
  "venue.db",
  "venue.db-wal",
  "venue.db-shm",
  "node.db",
  "node.db-wal",
  "node.db-shm",
] as const;

let venueDir: string;
let open: VenueDatabase | undefined;

beforeEach(async () => {
  venueDir = await mkdtemp(join(tmpdir(), "waitron-wipe-"));
});

afterEach(async () => {
  if (open !== undefined) await open.close().catch(() => {});
  open = undefined;
  await rm(venueDir, { recursive: true, force: true });
});

async function exists(name: string): Promise<boolean> {
  return stat(join(venueDir, name)).then(
    () => true,
    () => false,
  );
}

/**
 * Both files carrying a row, with the handle left open: a clean `close()` checkpoints and deletes
 * the sidecars, leaving nothing for the sidecar half of the wipe to remove.
 */
async function venueWithBothFilesWritten(): Promise<VenueDatabase> {
  const store = await openVenueDatabase(venueDir);
  store.venue.run(sql`create table venue_marker (v text)`);
  store.venue.run(sql`insert into venue_marker (v) values ('VENUE-ROW')`);
  store.node.run(sql`create table node_marker (v text)`);
  store.node.run(sql`insert into node_marker (v) values ('NODE-ROW')`);
  return store;
}

describe("wipeVenueDatabases", () => {
  it("removes BOTH database files and both write-ahead sidecars of each", async () => {
    open = await venueWithBothFilesWritten();
    // Without this the assertions after the wipe would pass over a directory that never held a sidecar.
    for (const name of WIPED) expect(await exists(name), `fixture: ${name}`).toBe(true);
    expect((await stat(join(venueDir, "venue.db-wal"))).size).toBeGreaterThan(0);
    expect((await stat(join(venueDir, "node.db-wal"))).size).toBeGreaterThan(0);

    await wipeVenueDatabases(venueDir);

    for (const name of WIPED) expect(await exists(name), `after the wipe: ${name}`).toBe(false);
  });

  it("leaves the venue file with nothing in it — a row committed only to the sidecar is gone", async () => {
    open = await venueWithBothFilesWritten();

    await wipeVenueDatabases(venueDir);
    await open.close();
    open = undefined;

    const fresh = await openVenueDatabase(venueDir);
    try {
      expect(() => fresh.venue.all(sql`select v from venue_marker`)).toThrow(/no such table/);
      expect(() => fresh.node.all(sql`select v from node_marker`)).toThrow(/no such table/);
    } finally {
      await fresh.close();
    }
  });

  it("removes Litestream's own folder beside venue.db too", async () => {
    open = await venueWithBothFilesWritten();
    const ltx = join(venueDir, ".venue.db-litestream", "ltx", "0");
    await mkdir(ltx, { recursive: true });
    await writeFile(join(ltx, "0000000000000001-0000000000000001.ltx"), "from the wiped database");
    await wipeVenueDatabases(venueDir);
    expect(await exists(".venue.db-litestream")).toBe(false);
  });

  it("leaves the migration lock file alone", async () => {
    open = await venueWithBothFilesWritten();
    await writeFile(join(venueDir, "migrations.lock"), "");

    await wipeVenueDatabases(venueDir);

    expect(await exists("migrations.lock")).toBe(true);
  });

  it("succeeds on a venue directory that holds nothing, and on one that is not there", async () => {
    await expect(wipeVenueDatabases(venueDir)).resolves.toBeUndefined();
    await expect(wipeVenueDatabases(join(venueDir, "never-created"))).resolves.toBeUndefined();
  });
});
