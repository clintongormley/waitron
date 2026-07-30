import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createPostgresDb, type Database } from "@waitron/db";
import { readInstanceState } from "./instance-state.js";
import { startBarePostgres, type RealPostgres } from "./testing/postgres.js";

describe("readInstanceState", () => {
  let pg: RealPostgres;
  let admin: Database;

  beforeAll(async () => {
    pg = await startBarePostgres();
    admin = await pg.connect();
    await admin.execute(sql.raw(`create role app_user_probe nologin`));
  });

  afterAll(async () => {
    if (admin !== undefined) await admin.close();
    if (pg !== undefined) await pg.stop();
  });

  it("reports a database that does not exist, with nothing inside observable", async () => {
    const state = await readInstanceState(admin, "waitron_absent", null);
    expect(state.databaseExists).toBe(false);
    // `null`, not an empty InsideState: "the database is not there" and "the database is there and
    // empty" are different facts, and a planner that conflated them would try to migrate a
    // database it had not created.
    expect(state.inside).toBeNull();
  });

  it("reports role attributes, not merely the name", async () => {
    await admin.execute(sql.raw(`create role waitron_migrator login password 'x' createrole`));
    await admin.execute(
      sql.raw(`create role waitron_app login password 'x' in role app_user_probe`),
    );
    const state = await readInstanceState(admin, "waitron_absent", null);
    expect(state.roles.waitron_migrator).toMatchObject({ canLogin: true, createRole: true });
    // Spec §4: verify ATTRIBUTES, not just the name. A `waitron_migrator` that exists NOLOGIN is
    // a broken deployment that a name-only check would report as provisioned.
    expect(state.roles.waitron_app).toMatchObject({ canLogin: true, createRole: false });
    expect(state.roles.waitron_provisioner).toBeUndefined();
  });

  it("reports the migrated sets and the stamp once the database exists", async () => {
    await admin.execute(sql.raw(`create database waitron_present`));
    const target = await createPostgresDb(targetUri(pg.uri, "waitron_present"));
    try {
      const empty = await readInstanceState(admin, "waitron_present", target);
      expect(empty.databaseExists).toBe(true);
      expect(empty.inside).toEqual({ migratedSets: [], stamp: null });
    } finally {
      await target.close();
    }
  });
});

/** The container's own URI with the database path swapped. */
function targetUri(uri: string, database: string): string {
  const u = new URL(uri);
  u.pathname = `/${database}`;
  return u.toString();
}
