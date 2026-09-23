// A real SQLite venue, opened by the test helper that owns one. No container: the engine is a file.
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { captureError, openVenueDatabase, type Database } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { isAppError } from "@waitron/shared";
import { manifestSets, migrationOptionsFor } from "./manifest.js";
import { appliedSchemaVersion, expectedSchemaVersion } from "./schema-version.js";

const core = manifestSets().find((set) => set.name === "core")!;

/** A fixture root holding one set folder whose journal carries `entries` tags and nothing else. */
function journalRoot(name: string, tags: readonly string[]): string {
  const root = mkdtempSync(join(tmpdir(), "waitron-schema-version-"));
  mkdirSync(join(root, name, "meta"), { recursive: true });
  writeFileSync(
    join(root, name, "meta", "_journal.json"),
    JSON.stringify({
      version: "7",
      dialect: "sqlite",
      entries: tags.map((tag, idx) => ({ idx, tag })),
    }),
  );
  return root;
}

describe("expectedSchemaVersion", () => {
  it("equals a fixture journal's entry count", () => {
    // Resolve under an absolute bundle-style root, so the fixture folder can live in a temp dir.
    // The `from` field is unused in the root branch (see migrationOptionsFor's doc comment), so any
    // value does.
    const root = journalRoot("core", ["0000_a", "0001_b", "0002_c"]);
    try {
      const set = { name: "core", table: "__drizzle_migrations_x", from: "unused" };
      expect(expectedSchemaVersion(set, root)).toBe(3);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("reads the real core journal head when run from source (root === null)", () => {
    // Cross-check against the on-disk journal read a second, independent way. Proves the null
    // (from-source) resolution branch.
    const options = migrationOptionsFor([core], null);
    const journal = JSON.parse(
      readFileSync(join(options[0]!.migrationsFolder, "meta", "_journal.json"), "utf8"),
    ) as { entries: unknown[] };
    expect(expectedSchemaVersion(core, null)).toBe(journal.entries.length);
  });

  it("throws migrations.set_missing for a set whose journal is absent, not a bare ENOENT", async () => {
    // A packaging fault must fail LOUD as a classified domain error — the same one
    // `migrationOptionsFor` throws — not as an unclassified Node `ENOENT`. The temp root exists but
    // holds no `core/meta/_journal.json`.
    const root = mkdtempSync(join(tmpdir(), "waitron-schema-version-missing-"));
    try {
      const set = { name: "core", table: "__drizzle_migrations_x", from: "unused" };
      const error = await captureError(() => Promise.resolve(expectedSchemaVersion(set, root)));
      expect(isAppError(error) && error.code).toBe("migrations.set_missing");
      expect(isAppError(error) && error.params).toMatchObject({ name: "core" });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe("appliedSchemaVersion — input validation", () => {
  it("throws migrations.invalid_table for a name that is not a drizzle journal table", async () => {
    // Validation runs BEFORE any query, so a db that would throw if touched proves the name is
    // rejected without reaching SQL — the §3 utility-statement discipline: never interpolate an
    // unvalidated identifier into `from "<table>"`.
    const neverQueried = {
      execute: () => {
        throw new Error("appliedSchemaVersion must reject a bad table name before querying");
      },
    } as unknown as Database;
    const error = await captureError(() =>
      appliedSchemaVersion(neverQueried, {
        name: "evil",
        table: 'users"; drop table audit_log --',
        from: "x",
      }),
    );
    expect(isAppError(error) && error.code).toBe("migrations.invalid_table");
  });
});

describe("appliedSchemaVersion — against a real database", () => {
  const suite = useVenueDb({ migrations: migrationOptionsFor([core], null) });

  it("equals expectedSchemaVersion after a full migrate", async () => {
    expect(await appliedSchemaVersion(suite.db, core)).toBe(expectedSchemaVersion(core, null));
  });

  it("reports N on a partially-applied table, visibly LOWER than expected", async () => {
    // A hand-built journal table holding fewer rows than the set ships — the state where the two
    // answers DIFFER (CLAUDE.md §1: a measurement where both answers look alike measures nothing).
    // The schema mirrors drizzle's own journal table; only the row COUNT matters. `expected` comes
    // from a fixture journal rather than the core set's, whose length changes as migrations land —
    // a partial state has to be able to sit strictly below it whatever that length is.
    const partialTable = "__drizzle_migrations_partial";
    suite.db.run(
      sql.raw(
        `create table "${partialTable}" ` +
          `(id integer primary key autoincrement, hash text not null, created_at numeric)`,
      ),
    );
    const n = 1;
    for (let i = 0; i < n; i++) {
      suite.db.run(sql.raw(`insert into "${partialTable}" (hash, created_at) values ('h', 0)`));
    }
    const root = journalRoot("core", ["0000_a", "0001_b", "0002_c"]);
    try {
      const partialSet = { name: "core", table: partialTable, from: "unused" };
      const applied = await appliedSchemaVersion(suite.db, partialSet);
      const expected = expectedSchemaVersion(partialSet, root);

      expect(applied).toBe(n);
      // The comparison this test exists for: a partial database is behind the shipped code. If both
      // numbers were read the same way this would be a tautology; they are computed by different
      // primitives — one counts rows, the other counts journal entries.
      expect(applied).toBeLessThan(expected);
      expect(expected).toBeGreaterThan(n); // guards the control: expected must exceed N to be lower-able
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("returns 0 when the table is absent", async () => {
    const absentSet = { name: "nope", table: "__drizzle_migrations_absent", from: "x" };
    expect(await appliedSchemaVersion(suite.db, absentSet)).toBe(0);
  });

  it("rethrows a driver error rather than swallowing it as 0", async () => {
    // A closed connection fails with `ERR_INVALID_STATE`, not a missing table — the function must
    // NOT report that as "zero migrations applied". The code is asserted, not merely
    // `toBeInstanceOf(Error)`: the absent-table path returns 0 rather than throwing, so an
    // assertion that only said "an Error" would pass against the wrong error too.
    const directory = mkdtempSync(join(tmpdir(), "waitron-schema-version-dead-"));
    try {
      const store = await openVenueDatabase(directory);
      const dead = store.venue;
      await store.close();
      const error = await captureError(() => appliedSchemaVersion(dead, core));
      expect((error as { code?: string }).code).toBe("ERR_INVALID_STATE");
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
