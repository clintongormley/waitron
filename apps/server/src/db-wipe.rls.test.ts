import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createPostgresDb, type Database } from "@waitron/db";
import { resolveSharedHandle } from "@waitron/db/testing/lifecycle.js";
import { databaseUrl } from "@waitron/db/testing/postgres.js";
import { quoteIdent } from "@waitron/provisioning";
import { dropAndCreateDatabase } from "./db-wipe.js";

// Real Postgres, not PGlite: DROP DATABASE / CREATE DATABASE are cluster-level utility statements
// that need a privileged connection to a MAINTENANCE database (a different db from the one being
// dropped), which PGlite's single embedded database cannot model at all. CLAUDE.md §4.
//
// The shared container's admin handle (`resolveSharedHandle(undefined).uri`) is the container
// SUPERUSER connection pointed at the default `test` maintenance database — exactly the privileged,
// maintenance-db-connected `admin` this test needs, and reusing it keeps this suite on the repo's
// one-container-per-package rollout (#112–#123) rather than booting its own. The wipe only ever
// drops throwaway TARGET databases built with `databaseUrl(adminUrl, name)` — never the shared `test` db
// or any template — so the shared container is safe. Only `admin` (a raw connection this suite opens
// itself, not a lifecycle-owned resource) needs a guarded teardown, per §4.
describe("dropAndCreateDatabase (real Postgres)", () => {
  let admin: Database | undefined;
  let adminUrl: string; // shared container admin URI: superuser on the default `test` maintenance db

  beforeAll(async () => {
    adminUrl = resolveSharedHandle(undefined).uri;
    admin = await createPostgresDb(adminUrl);
  });

  afterAll(async () => {
    if (admin !== undefined) await admin.close();
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
    // (which would otherwise be REJECTED — "database … is being accessed by other users" — on the
    // open connection) and the recreate succeeded. Proven by deletion: remove `with (force)` from
    // db-wipe.ts and this test fails with exactly that error.
    await expect(dropAndCreateDatabase({ admin: admin!, database: name })).resolves.toBeUndefined();
    await lingering.close().catch(() => {});
  });
});
