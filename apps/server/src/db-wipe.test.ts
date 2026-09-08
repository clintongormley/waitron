import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { captureError, createPostgresDb, type Database } from "@waitron/db";
import { resolveSharedHandle } from "@waitron/db/testing/lifecycle.js";
import { databaseUrl } from "@waitron/db/testing/postgres.js";
import { quoteIdent, withRole } from "@waitron/provisioning";
import { dropAndCreateDatabase } from "./db-wipe.js";

// drizzle-orm wraps a failed query in a DrizzleQueryError whose own `.message` is `Failed query: …`;
// the pg SQLSTATE message ("permission denied to create database") lives on `.cause`. `@waitron/db`'s
// enumerated exports map publishes no `testing/errors.js` path to apps/server, so walk the cause chain
// here (the same field `deployment.test.ts`'s `pgErrorMessage` reads inside the db package).
function messageChain(err: unknown): string {
  const parts: string[] = [];
  let e: unknown = err;
  while (e instanceof Error) {
    parts.push(e.message);
    e = e.cause;
  }
  return parts.join(" | ");
}

// Real Postgres, not PGlite: DROP DATABASE / CREATE DATABASE are cluster-level utility statements that
// need a privileged connection to a MAINTENANCE database (a different db from the one dropped), which
// PGlite's single embedded database cannot model at all. And the TWO-HANDLE split is a PRIVILEGE fact:
// the wipe DROPs as the migrator-OWNER (probe F — the owner can drop its own inactive-slot database) but
// CREATEs as the plain admin holding CREATEDB, which the migrator lacks (probe A). PGlite is a
// superuser everywhere, so it cannot observe either. CLAUDE.md §4.
//
// The shared container's admin handle (`resolveSharedHandle(undefined).uri`) is the container SUPERUSER
// pointed at the default `test` maintenance database — the privileged, maintenance-db-connected handle
// this test needs. The wipe only ever drops throwaway TARGET databases built with `databaseUrl` — never
// the shared `test` db or a template. Only handles this suite opens itself need a guarded teardown.
describe("dropAndCreateDatabase (real Postgres, two handles)", () => {
  let admin: Database | undefined;
  let adminUrl: string; // shared container admin URI: superuser on the default `test` maintenance db

  beforeAll(async () => {
    adminUrl = resolveSharedHandle(undefined).uri;
    admin = await createPostgresDb(adminUrl);
    // A cluster-level owner role for the recreated database, and a LOGIN NOCREATEDB role standing in for
    // `waitron_migrator` (probe A: the migrator can DROP its own db but cannot CREATE one).
    await admin.execute(
      sql.raw(
        `do $$ begin if not exists (select from pg_roles where rolname = 'wipe_owner') then create role wipe_owner; end if; end $$`,
      ),
    );
    await admin.execute(
      sql.raw(
        `do $$ begin if not exists (select from pg_roles where rolname = 'wipe_migrator') then create role wipe_migrator login nocreatedb; end if; end $$`,
      ),
    );
  });

  afterAll(async () => {
    if (admin !== undefined) await admin.close();
  });

  it("drops over `dropAs` and recreates the database OWNED by `owner` over `createAs`", async () => {
    const name = "rejoin_wipe_two_handle";
    await admin!.execute(sql.raw(`create database ${quoteIdent(name)} owner wipe_owner`));
    const target = await createPostgresDb(databaseUrl(adminUrl, name));
    await target.execute(sql.raw(`create table t (x int)`));
    await target.execute(sql.raw(`insert into t values (1)`));
    await target.close(); // close before the FORCE drop terminates it

    await dropAndCreateDatabase({
      dropAs: admin!,
      createAs: admin!,
      database: name,
      owner: "wipe_owner",
    });

    const owner = await admin!.execute<{ owner: string }>(
      sql`select pg_get_userbyid(datdba) as owner from pg_database where datname = ${name}`,
    );
    expect(owner.rows[0]?.owner).toBe("wipe_owner"); // recreated with the OWNER clause
    const fresh = await createPostgresDb(databaseUrl(adminUrl, name));
    const rows = await fresh.execute<{ present: boolean }>(
      sql`select exists (select 1 from information_schema.tables where table_name = 't') as present`,
    );
    expect(rows.rows[0]?.present).toBe(false); // recreated empty
    await fresh.close();
  });

  it("the CREATE needs a CREATEDB handle: a single NOCREATEDB handle fails permission denied to create database", async () => {
    // The two-handle split proven by contradiction (probe A): pass the migrator-owner handle as BOTH
    // dropAs AND createAs. It OWNS the db so the DROP succeeds, but it has no CREATEDB so the recreate
    // fails "permission denied to create database" — which is exactly why the real wipe hands the CREATE
    // to the plain maintenance admin, not the migrator. Proven by deletion: give wipe_migrator CREATEDB
    // and this stops throwing.
    const name = "rejoin_wipe_one_handle";
    await admin!.execute(sql.raw(`create database ${quoteIdent(name)} owner wipe_migrator`));
    const migratorHandle = await createPostgresDb(withRole(adminUrl, "wipe_migrator"));
    try {
      const err = await captureError(() =>
        dropAndCreateDatabase({
          dropAs: migratorHandle,
          createAs: migratorHandle,
          database: name,
          owner: "wipe_migrator",
        }),
      );
      expect(messageChain(err)).toMatch(/permission denied to create database/);
    } finally {
      await migratorHandle.close().catch(() => {});
    }
  });

  it("terminates a live backend on the target (WITH FORCE)", async () => {
    const name = "rejoin_wipe_force";
    await admin!.execute(sql.raw(`create database ${quoteIdent(name)} owner wipe_owner`));
    const lingering = await createPostgresDb(databaseUrl(adminUrl, name)); // stays open
    // The FORCE drop terminates the lingering backend; the call resolving proves the drop (which would
    // otherwise be REJECTED on the open connection) and the recreate both succeeded. Proven by deletion:
    // remove `with (force)` from db-wipe.ts and this test fails with the "being accessed" error.
    await expect(
      dropAndCreateDatabase({
        dropAs: admin!,
        createAs: admin!,
        database: name,
        owner: "wipe_owner",
      }),
    ).resolves.toBeUndefined();
    await lingering.close().catch(() => {});
  });
});
