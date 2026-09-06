// Real PostgreSQL: exercises the node-postgres driver, including connection and close behavior.
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { createPgliteDb, createPostgresDb } from "./client.js";
import { dockerAvailable, resolveTargets } from "./testing/harness.js";
import { POSTGRES_IMAGE } from "./testing/postgres.js";
import { sql } from "drizzle-orm";

describe("createPgliteDb", () => {
  const dirs: string[] = [];

  afterEach(() => {
    for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
  });

  it("returns a database that answers a query", async () => {
    const db = await createPgliteDb();
    const result = await db.execute(sql`select 1 as one`);
    expect(result.rows[0]).toEqual({ one: 1 });
    await db.close();
  });

  it("tags itself as the pglite driver", async () => {
    // runMigrations dispatches on this tag, because drizzle ships a separate
    // migrator per driver and the shared Database type deliberately erases
    // which one it is.
    const db = await createPgliteDb();
    expect(db.driver).toBe("pglite");
    await db.close();
  });

  it("persists to a data directory across close and reopen", async () => {
    // The standalone backup story in spec §3 is "copy one data directory", so
    // an in-memory-only client would not be the thing we ship.
    const dir = mkdtempSync(join(tmpdir(), "waitron-db-"));
    dirs.push(dir);
    const first = await createPgliteDb(dir);
    await first.execute(sql`create table persisted (id integer primary key)`);
    await first.execute(sql`insert into persisted (id) values (7)`);
    await first.close();

    const second = await createPgliteDb(dir);
    const result = await second.execute(sql`select id from persisted`);
    expect(result.rows).toEqual([{ id: 7 }]);
    await second.close();
  });

  it("rejects a query after close", async () => {
    const db = await createPgliteDb();
    await db.close();
    await expect(db.execute(sql`select 1`)).rejects.toThrow();
  });

  it("is in-memory when no data directory is given", async () => {
    // Two no-arg clients must not see each other's tables, or every test in
    // this package would share state with every other and the isolation the
    // harness promises would be fictional.
    const first = await createPgliteDb();
    await first.execute(sql`create table only_in_first (id integer primary key)`);
    const second = await createPgliteDb();
    await expect(second.execute(sql`select id from only_in_first`)).rejects.toThrow();
    await first.close();
    await second.close();
  });
});

// No container needed for this one: the connect-probe in createPostgresDb
// (`const probe = await pool.connect(); probe.release();`) exists so a bad
// connection string fails here, at construction, rather than surfacing at
// the first query as what looks like a schema fault. That claim was
// previously unasserted — deleting the probe left all tests green. A
// connection nothing is listening on is enough to exercise it; it needs no
// Docker daemon, so unlike the block below this runs unconditionally.
it("createPostgresDb fails fast on a connection that cannot succeed", async () => {
  await expect(createPostgresDb("postgresql://nobody@127.0.0.1:1/none")).rejects.toThrow();
});

// Whether this run covers the real-Postgres target, decided once via the same
// loud-skip/hard-fail logic every dual-target suite in this package uses (see
// src/testing/harness.ts's resolveTargets). A silent `it.skip` with no
// explanation is exactly the failure mode that logic exists to prevent: on a
// developer machine without Docker this warns and skips below; under CI's
// REQUIRE_DOCKER=1 with no daemon it throws here, at collection time.
const POSTGRES_COVERED = resolveTargets({
  dockerAvailable: dockerAvailable(),
  requireDocker: process.env.REQUIRE_DOCKER === "1",
}).some((target) => target.name === "postgres");

// This block starts its own Testcontainers Postgres instead of going through
// Target.create() (src/testing/harness.ts). That is not an oversight: these
// are unit tests of createPostgresDb itself, the function Target.create() is
// built on top of, so they cannot use the seam without testing the seam
// instead of the constructor. migrate.test.ts's postgres block has the same
// shape for the same reason.
describe.runIf(POSTGRES_COVERED)("createPostgresDb", () => {
  let container: StartedPostgreSqlContainer;

  beforeAll(async () => {
    container = await new PostgreSqlContainer(POSTGRES_IMAGE).start();
  });

  afterAll(async () => {
    if (container !== undefined) await container.stop();
  });

  it("returns a database that answers a query", async () => {
    const db = await createPostgresDb(container.getConnectionUri());
    const result = await db.execute(sql`select 1 as one`);
    expect(result.rows[0]).toEqual({ one: 1 });
    await db.close();
  });

  it("tags itself as the postgres driver", async () => {
    const db = await createPostgresDb(container.getConnectionUri());
    expect(db.driver).toBe("postgres");
    await db.close();
  });

  it("rejects a query after close", async () => {
    const db = await createPostgresDb(container.getConnectionUri());
    await db.close();
    await expect(db.execute(sql`select 1`)).rejects.toThrow();
  });
});
