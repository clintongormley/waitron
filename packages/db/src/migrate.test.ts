import { join } from "node:path";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { createPgliteDb, createPostgresDb, type Database } from "./client.js";
import { runMigrations } from "./migrate.js";
import { dockerAvailable, resolveTargets } from "./testing/harness.js";
import { POSTGRES_IMAGE } from "./testing/postgres.js";

const FOLDER_A = join(import.meta.dirname, "..", "test", "migrations-a");
const FOLDER_B = join(import.meta.dirname, "..", "test", "migrations-b");
const TABLE_A = "__drizzle_migrations_a";
const TABLE_B = "__drizzle_migrations_b";

async function countIn(db: Database, table: string): Promise<number> {
  const result = await db.execute(sql`select count(*)::int as n from ${sql.identifier(table)}`);
  return (result.rows[0] as { n: number }).n;
}

describe("runMigrations", () => {
  it("applies a migration folder", async () => {
    const db = await createPgliteDb();
    await runMigrations(db, { migrationsFolder: FOLDER_A, migrationsTable: TABLE_A });
    const result = await db.execute(sql`select count(*)::int as n from probe_a`);
    expect((result.rows[0] as { n: number }).n).toBe(0);
    await db.close();
  });

  it("records the applied migration in the journal table it was given", async () => {
    const db = await createPgliteDb();
    await runMigrations(db, { migrationsFolder: FOLDER_A, migrationsTable: TABLE_A });
    expect(await countIn(db, TABLE_A)).toBe(1);
    await db.close();
  });

  it("does not create drizzle's default journal table", async () => {
    // If the migrationsTable option were dropped, drizzle silently falls back
    // to __drizzle_migrations — and everything still passes, right up until a
    // second package migrates into the same history.
    const db = await createPgliteDb();
    await runMigrations(db, { migrationsFolder: FOLDER_A, migrationsTable: TABLE_A });
    const result = await db.execute(
      sql`select to_regclass('public.__drizzle_migrations') as present`,
    );
    expect((result.rows[0] as { present: string | null }).present).toBeNull();
    await db.close();
  });

  it("is idempotent — a second run applies nothing", async () => {
    const db = await createPgliteDb();
    await runMigrations(db, { migrationsFolder: FOLDER_A, migrationsTable: TABLE_A });
    await runMigrations(db, { migrationsFolder: FOLDER_A, migrationsTable: TABLE_A });
    expect(await countIn(db, TABLE_A)).toBe(1);
    await db.close();
  });

  it("keeps two packages' journals independent", async () => {
    const db = await createPgliteDb();
    await runMigrations(db, { migrationsFolder: FOLDER_A, migrationsTable: TABLE_A });
    await runMigrations(db, { migrationsFolder: FOLDER_B, migrationsTable: TABLE_B });
    // One row each, not two in one table: each package can replay its own
    // history without the other's rows in it.
    expect(await countIn(db, TABLE_A)).toBe(1);
    expect(await countIn(db, TABLE_B)).toBe(1);
    await db.close();
  });

  it("emits a cross-package foreign key that actually holds", async () => {
    const db = await createPgliteDb();
    await runMigrations(db, { migrationsFolder: FOLDER_A, migrationsTable: TABLE_A });
    await runMigrations(db, { migrationsFolder: FOLDER_B, migrationsTable: TABLE_B });
    await expect(db.execute(sql`insert into probe_b (id, a_id) values (1, 99)`)).rejects.toThrow();
    await db.close();
  });

  it("fails loudly when a module folder is migrated before the core folder", async () => {
    // Migration ordering is the runtime's responsibility — nothing in drizzle
    // enforces that core runs before a module. This test pins the failure to a
    // clear error at migrate time rather than a missing table at first write.
    const db = await createPgliteDb();
    await expect(
      runMigrations(db, { migrationsFolder: FOLDER_B, migrationsTable: TABLE_B }),
    ).rejects.toThrow(/probe_a/);
    await db.close();
  });
});

// Same gating as client.test.ts's createPostgresDb block: loud skip locally
// without Docker, hard failure under CI's REQUIRE_DOCKER=1. Without this,
// runMigrations' postgres branch (the migratePg call) would be entirely
// unexercised — the pglite branch above proves the migrator dispatches
// correctly for one driver, not both.
const POSTGRES_COVERED = resolveTargets({
  dockerAvailable: dockerAvailable(),
  requireDocker: process.env.REQUIRE_DOCKER === "1",
}).some((target) => target.name === "postgres");

// This block starts its own Testcontainers Postgres rather than going
// through Target.create() (src/testing/harness.ts), whose create() already
// calls runMigrations internally. Using the seam here would mean testing
// runMigrations by way of a function that calls runMigrations — this suite
// needs to call it directly, with its own migrationsFolder/migrationsTable,
// to exercise the migratePg branch on its own terms. client.test.ts's
// createPostgresDb block has the same shape for the analogous reason.
describe.runIf(POSTGRES_COVERED)("runMigrations against real PostgreSQL", () => {
  let container: StartedPostgreSqlContainer;

  beforeAll(async () => {
    container = await new PostgreSqlContainer(POSTGRES_IMAGE).start();
  });

  afterAll(async () => {
    await container.stop();
  });

  it("applies a migration folder via the node-postgres driver", async () => {
    const db = await createPostgresDb(container.getConnectionUri());
    await runMigrations(db, { migrationsFolder: FOLDER_A, migrationsTable: TABLE_A });
    expect(await countIn(db, TABLE_A)).toBe(1);
    await db.close();
  });
});
