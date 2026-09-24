import { describe, expect, it } from "vitest";
import { imageMigrationHashes, manifestSets, type MigrationSetSource } from "@waitron/migrations";
import { assertNotAhead, findAheadSets, unknownHashes } from "./schema-ahead.js";

const CORE: MigrationSetSource = manifestSets().find((set) => set.name === "core")!;
/** What this image really ships for `core` — read from disk, so nothing here restates drizzle's hash rule. */
const SHIPPED = imageMigrationHashes(CORE, null);

/** A set this image ships no migrations folder for: reading its files throws `migrations.set_missing`. */
const PHANTOM: MigrationSetSource = {
  name: "phantom",
  table: "__drizzle_migrations_phantom",
  from: "../phantom/drizzle",
};

/** Answers the TWO queries `journalHashes` makes per set, in order: the `sqlite_master` presence
 * probe, then the journal read. */
function dbWith(hashes: readonly string[]) {
  let call = 0;
  return {
    execute: () =>
      Promise.resolve(
        call++ % 2 === 0 ? { rows: [{ n: 1 }] } : { rows: hashes.map((hash) => ({ hash })) },
      ),
  } as never;
}

/** A database whose journal table does not exist: the catalogue reports it absent, and the journal
 *  read is never reached — the never-migrated set. */
const dbWithoutJournal = { execute: () => Promise.resolve({ rows: [{ n: 0 }] }) } as never;

describe("unknownHashes", () => {
  it("returns the database hashes the image has no file for", () => {
    expect(unknownHashes(["a", "b", "c"], ["a", "b"])).toEqual(["c"]);
  });

  it("reports nothing for a database behind the image", () => {
    expect(unknownHashes(["a"], ["a", "b", "c"])).toEqual([]);
  });

  it("reports nothing when the two agree exactly", () => {
    expect(unknownHashes(["a", "b"], ["a", "b"])).toEqual([]);
  });

  it("reports an EDITED migration, whose hash changed although the count did not", () => {
    expect(unknownHashes(["a", "edited"], ["a", "b"])).toEqual(["edited"]);
  });
});

describe("findAheadSets", () => {
  it("skips a set whose journal table does not exist", async () => {
    expect(await findAheadSets(dbWithoutJournal, [CORE], null)).toEqual([]);
  });

  // The skip is a `continue` BEFORE the image's files are read, not a comparison against an empty
  // journal: `PHANTOM` has no folder on disk, so a run that read its files would throw here.
  it("does not read the image's files for a set whose journal table is absent", async () => {
    expect(await findAheadSets(dbWithoutJournal, [PHANTOM], null)).toEqual([]);
  });

  // Control for the test above: without it, `[]` is also what a `findAheadSets` that never reads
  // files at all would return.
  it("reads the image's files for a set whose journal table exists", async () => {
    await expect(findAheadSets(dbWith(["a"]), [PHANTOM], null)).rejects.toMatchObject({
      code: "migrations.set_missing",
    });
  });

  it("reports nothing for a database carrying exactly what this image ships", async () => {
    expect(await findAheadSets(dbWith(SHIPPED), [CORE], null)).toEqual([]);
  });

  it("reports nothing for a database behind this image", async () => {
    expect(await findAheadSets(dbWith(SHIPPED.slice(0, 1)), [CORE], null)).toEqual([]);
  });

  it("names the set and the unknown hashes when the database is ahead", async () => {
    const unknown = "f".repeat(64);
    expect(await findAheadSets(dbWith([...SHIPPED, unknown]), [CORE], null)).toEqual([
      { set: "core", unknownMigrations: [unknown] },
    ]);
  });
});

describe("assertNotAhead", () => {
  it("throws provisioning.database_ahead naming the set and the unknown migrations", async () => {
    const unknown = "f".repeat(64);
    await expect(assertNotAhead(dbWith([...SHIPPED, unknown]), [CORE], null)).rejects.toMatchObject(
      {
        code: "provisioning.database_ahead",
        params: { set: "core", unknownMigrations: [unknown] },
      },
    );
  });

  // The stub answers every set with the same journal, so both sets are ahead.
  it("reports the first ahead set when several are ahead", async () => {
    const unknown = "f".repeat(64);
    const sets = manifestSets().filter((set) => set.name === "core" || set.name === "catalogue");
    await expect(assertNotAhead(dbWith([unknown]), sets, null)).rejects.toMatchObject({
      code: "provisioning.database_ahead",
      params: { set: "core" },
    });
  });

  it("resolves for a database this image can serve", async () => {
    await expect(assertNotAhead(dbWith(SHIPPED), [CORE], null)).resolves.toBeUndefined();
  });
});
