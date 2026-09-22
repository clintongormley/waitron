import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { captureError, openVenueDatabase } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { isAppError } from "@waitron/shared";
import { manifestSets, migrationOptionsFor } from "./manifest.js";
import { imageMigrationHashes, journalHashes } from "./journal-hashes.js";

const core = manifestSets().find((set) => set.name === "core")!;

describe("imageMigrationHashes", () => {
  it("returns one hash per journal entry, in journal order", () => {
    const folder = fileURLToPath(new URL("../../db/drizzle", import.meta.url));
    const journal = JSON.parse(readFileSync(join(folder, "meta", "_journal.json"), "utf8")) as {
      entries: { tag: string }[];
    };
    const hashes = imageMigrationHashes(core, null);
    expect(hashes).toHaveLength(journal.entries.length);
    // Pins the hash RULE against drizzle's own, rather than restating it: sha256 of the whole .sql
    // file text. If drizzle ever changes it, this fails instead of the ahead check silently
    // reporting every migration as unknown.
    const first = createHash("sha256")
      .update(readFileSync(join(folder, `${journal.entries[0]!.tag}.sql`), "utf8"))
      .digest("hex");
    expect(hashes[0]).toBe(first);
  });

  it("throws the classified migrations.set_missing for a set with no journal", () => {
    const missing = { name: "nope", table: "__drizzle_migrations_nope", from: "../nope/drizzle" };
    const thrown = (() => {
      try {
        imageMigrationHashes(missing, null);
        return null;
      } catch (error) {
        return error;
      }
    })();
    expect(isAppError(thrown)).toBe(true);
    expect((thrown as { code: string }).code).toBe("migrations.set_missing");
  });
});

describe("journalHashes", () => {
  it("refuses a table name that is not a drizzle journal table", async () => {
    const db = { execute: () => Promise.reject(new Error("must not be reached")) };
    const bad = { name: "x", table: 'evil"; drop table tenants; --', from: "../db/drizzle" };
    await expect(journalHashes(db as never, bad)).rejects.toMatchObject({
      code: "migrations.invalid_table",
    });
  });

  it("returns the hashes the journal carries", async () => {
    const db = {
      execute: () => Promise.resolve({ rows: [{ hash: "aa" }, { hash: "bb" }] }),
    };
    expect(await journalHashes(db as never, core)).toEqual(["aa", "bb"]);
  });
});

// The absent-table and driver-error cases run against the REAL engine. They used to hand the
// function a fake rejecting with PostgreSQL's SQLSTATE `42P01`, a value `node:sqlite` never
// produces — so they passed while the product threw `no such table` on every first boot.
describe("journalHashes — against a real database", () => {
  const suite = useVenueDb({ migrations: migrationOptionsFor([core], null) });

  it("returns null when the journal table is absent, rather than throwing", async () => {
    const absentSet = { name: "nope", table: "__drizzle_migrations_absent", from: "x" };
    expect(await journalHashes(suite.db, absentSet)).toBeNull();
  });

  it("reads the hashes a real migrate wrote", async () => {
    const hashes = await journalHashes(suite.db, core);
    expect(hashes).toEqual(imageMigrationHashes(core, null));
  });

  it("rethrows a driver error rather than reporting an unmigrated set", async () => {
    // A closed connection fails with `ERR_INVALID_STATE`, not a missing table — reported as "no
    // journal" it would let the ahead check read a fully-migrated database as virgin. The code is
    // asserted, not merely `toBeInstanceOf(Error)`: the absent-table path RETURNS rather than
    // throwing, so "an Error" would pass against the wrong error too.
    const directory = mkdtempSync(join(tmpdir(), "waitron-journal-hashes-dead-"));
    try {
      const store = await openVenueDatabase(directory);
      const dead = store.venue;
      await store.close();
      const error = await captureError(() => journalHashes(dead, core));
      expect((error as { code?: string }).code).toBe("ERR_INVALID_STATE");
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("is not fooled by a same-named view", async () => {
    // `sqlite_master` holds views too, so the probe asks for `type = 'table'`. Without that
    // predicate a view named like a journal table would be read as a journal.
    const viewSet = { name: "v", table: "__drizzle_migrations_view", from: "x" };
    suite.db.run(sql.raw(`create view "${viewSet.table}" as select 'x' as "hash"`));
    expect(await journalHashes(suite.db, viewSet)).toBeNull();
  });
});
