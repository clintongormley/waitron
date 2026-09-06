// Real PostgreSQL: checks real node-postgres error propagation after closing its pool.
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { captureError, createPostgresDb, type Database } from "@waitron/db";
import { POSTGRES_IMAGE } from "@waitron/db/testing/postgres.js";
import { isAppError } from "@waitron/shared";
import { applyMigrations } from "./apply.js";
import { manifestSets, migrationOptionsFor } from "./manifest.js";
import { appliedSchemaVersion, expectedSchemaVersion } from "./schema-version.js";

describe("expectedSchemaVersion", () => {
  it("equals a fixture journal's entry count", () => {
    // Resolve under an absolute bundle-style root, so the fixture folder can live in a temp dir
    // and this stays a pure unit test with no container. The `from` field is unused in the root
    // branch (see migrationOptionsFor's doc comment), so any value does.
    const root = mkdtempSync(join(tmpdir(), "waitron-schema-version-"));
    try {
      mkdirSync(join(root, "core", "meta"), { recursive: true });
      writeFileSync(
        join(root, "core", "meta", "_journal.json"),
        JSON.stringify({
          version: "7",
          dialect: "postgresql",
          entries: [
            { idx: 0, tag: "0000_a" },
            { idx: 1, tag: "0001_b" },
            { idx: 2, tag: "0002_c" },
          ],
        }),
      );
      const set = { name: "core", table: "__drizzle_migrations_x", from: "unused" };
      expect(expectedSchemaVersion(set, root)).toBe(3);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("reads the real core journal head when run from source (root === null)", () => {
    // Cross-check against the on-disk journal read a second, independent way — the same ground
    // truth apply.concurrency.test.ts uses. Proves the null (from-source) resolution branch.
    const core = manifestSets()[0]!;
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
        table: 'users"; drop table registros_facturacion --',
        from: "x",
      }),
    );
    expect(isAppError(error) && error.code).toBe("migrations.invalid_table");
  });
});

describe("appliedSchemaVersion — against a real Postgres", () => {
  let container: StartedPostgreSqlContainer;
  let uri: string;
  let db: Database;

  beforeAll(async () => {
    container = await new PostgreSqlContainer(POSTGRES_IMAGE).start();
    uri = container.getConnectionUri();
    await applyMigrations(uri, migrationOptionsFor(manifestSets(), null));
    db = await createPostgresDb(uri);
  }, 180_000);

  afterAll(async () => {
    if (db !== undefined) await db.close();
    if (container !== undefined) await container.stop();
  });

  it("equals expectedSchemaVersion after a full migrate", async () => {
    const core = manifestSets()[0]!;
    expect(await appliedSchemaVersion(db, core)).toBe(expectedSchemaVersion(core, null));
  });

  it("reports N on a partially-applied table, visibly LOWER than expected", async () => {
    // A hand-built journal table holding only the first N rows — the state where the two answers
    // DIFFER (CLAUDE.md §1: a measurement where both answers look alike measures nothing). The
    // schema mirrors drizzle's own journal table (id/hash/created_at); only the row COUNT matters.
    const partialTable = "__drizzle_migrations_partial";
    await db.execute(
      sql.raw(
        `create table "${partialTable}" ` +
          `(id serial primary key, hash text not null, created_at bigint)`,
      ),
    );
    // Core ships a two-file baseline (generated + custom), so its journal head is 2; N must stay
    // strictly below that shipped head for the partial state to read as behind.
    const n = 1;
    for (let i = 0; i < n; i++) {
      await db.execute(sql.raw(`insert into "${partialTable}" (hash, created_at) values ('h', 0)`));
    }
    const partialSet = { name: "core", table: partialTable, from: "../db/drizzle" };
    const applied = await appliedSchemaVersion(db, partialSet);
    const expected = expectedSchemaVersion(manifestSets()[0]!, null);

    expect(applied).toBe(n);
    // The comparison this test exists for: a partial DB is behind the shipped code. If both numbers
    // were read the same way this would be a tautology; they are computed by different primitives.
    expect(applied).toBeLessThan(expected);
    expect(expected).toBeGreaterThan(n); // guards the control: expected must exceed N to be lower-able
  });

  it("returns 0 when the table is absent (42P01)", async () => {
    const absentSet = { name: "nope", table: "__drizzle_migrations_absent", from: "x" };
    expect(await appliedSchemaVersion(db, absentSet)).toBe(0);
  });

  it("rethrows a non-42P01 driver error rather than swallowing it as 0", async () => {
    // A closed connection fails with a connection error, not undefined_table — the function must
    // NOT report that as "zero migrations applied". captureError throws if the call succeeds.
    const dead = await createPostgresDb(uri);
    await dead.close();
    const error = await captureError(() => appliedSchemaVersion(dead, manifestSets()[0]!));
    expect(error).toBeInstanceOf(Error);
    expect(isAppError(error) && error.code).not.toBe("migrations.invalid_table");
  });
});
