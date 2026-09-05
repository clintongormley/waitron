import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createPostgresDb, type Database } from "@waitron/db";
import { databaseUrl, startPostgresContainer } from "@waitron/db/testing/postgres.js";
import type { StartedContainer } from "@waitron/db/testing/postgres.js";
import { quoteIdent } from "@waitron/provisioning";
import { dropAndCreateDatabase } from "./db-wipe.js";

// Real Postgres, not PGlite: DROP DATABASE / CREATE DATABASE are cluster-level utility statements
// that need a privileged connection to a MAINTENANCE database (a different db from the one being
// dropped), which PGlite's single embedded database cannot model at all. CLAUDE.md §4.
//
// This suite legitimately owns its own container + admin connection rather than using
// `useRealPostgres`/`useTemplateDb` (CLAUDE.md §4's "builds its own resource" exception): those
// helpers hand back an app-role accessor bound to a single per-suite database, whereas this test
// needs the container SUPERUSER connected to the default maintenance database (`test`) so it can
// create, drop and recreate throwaway target databases beside it. The raw beforeAll/afterAll below
// is therefore correct, and the teardown is guarded (`if (admin !== undefined)`) per §4.
describe("dropAndCreateDatabase (real Postgres)", () => {
  let container: StartedContainer | undefined;
  let admin: Database | undefined;
  let adminUrl: string; // connection to the container's default maintenance db, never to a target

  beforeAll(async () => {
    container = await startPostgresContainer();
    adminUrl = container.uri; // superuser, path points at the default `test` database
    admin = await createPostgresDb(adminUrl);
  }, 120_000);

  afterAll(async () => {
    if (admin !== undefined) await admin.close();
    if (container !== undefined) await container.stop();
  });

  it("drops a database with data and recreates it empty and usable", async () => {
    const name = "rejoin_wipe_probe";
    await admin!.execute(sql.raw(`create database ${quoteIdent(name)}`));
    const target = await createPostgresDb(databaseUrl(adminUrl, name));
    await target.execute(sql.raw(`create table t (x int)`));
    await target.execute(sql.raw(`insert into t values (1)`));
    await target.close(); // close before the FORCE drop terminates it

    await dropAndCreateDatabase({ admin: admin!, database: name });

    const fresh = await createPostgresDb(databaseUrl(adminUrl, name));
    const rows = await fresh.execute<{ present: boolean }>(
      sql`select exists (select 1 from information_schema.tables where table_name = 't') as present`,
    );
    expect(rows.rows[0]?.present).toBe(false); // recreated empty
    await fresh.close();
  });

  it("terminates a live backend on the target (WITH FORCE)", async () => {
    const name = "rejoin_wipe_force";
    await admin!.execute(sql.raw(`create database ${quoteIdent(name)}`));
    const lingering = await createPostgresDb(databaseUrl(adminUrl, name)); // stays open
    // The FORCE drop terminates the lingering backend; the call resolving proves both the drop
    // (which would otherwise hang on the open connection) and the recreate succeeded.
    await expect(dropAndCreateDatabase({ admin: admin!, database: name })).resolves.toBeUndefined();
    await lingering.close().catch(() => {});
  });
});
