// Real PostgreSQL: inspects database existence and PostgreSQL role attributes.
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createPostgresDb, type Database } from "@waitron/db";
import { withDatabase } from "./instance-apply.js";
import { readInstanceState } from "./instance-state.js";
import { roleUrl, startBarePostgres, type RealPostgres } from "./testing/postgres.js";

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
    // No database, no owner to name — distinct from a database owned by someone the planner must
    // refuse.
    expect(state.databaseOwner).toBeNull();
  });

  it("reports role attributes, not merely the name", async () => {
    // Probe true and false attributes and a membership whose name only starts
    // with app_user, so the reader must return an actual array of exact names.
    await admin.execute(
      sql.raw(`create role waitron_migrator login password 'x' createrole superuser`),
    );
    await admin.execute(
      sql.raw(`create role waitron_app login password 'x' in role app_user_probe`),
    );
    const state = await readInstanceState(admin, "waitron_absent", null);
    // Spec §4: verify ATTRIBUTES, not just the name. A `waitron_migrator` that exists NOLOGIN is
    // a broken deployment that a name-only check would report as provisioned. `toEqual`, not
    // `toMatchObject`: every field of RoleFacts is pinned, including `memberOf`, so deleting the
    // `pg_auth_members` join (or hardcoding any of these fields) fails this test rather than
    // passing it silently. `adminCanSetRole` is `true` for both here because the reader is the
    // container SUPERUSER, which holds SET-membership on every role.
    expect(state.roles.waitron_migrator).toEqual({
      canLogin: true,
      createRole: true,
      superuser: true,
      memberOf: [],
      adminCanSetRole: true,
    });
    expect(state.roles.waitron_app).toEqual({
      canLogin: true,
      createRole: false,
      superuser: false,
      memberOf: ["app_user_probe"],
      adminCanSetRole: true,
    });
    expect(Object.keys(state.roles).sort()).toEqual(["waitron_app", "waitron_migrator"]);
  });

  it("reports adminCanSetRole false for a role the reader cannot SET ROLE to", async () => {
    // The property the migrator refusal (instance-plan.ts) rests on: a role created by a DIFFERENT
    // admin, with no SET-membership granted to the reader, reads `false`. Read as a non-superuser
    // that did not create it, since a superuser sees `true` for everything.
    await admin.execute(sql.raw(`create role reader_admin login createrole password 'r'`));
    // waitron_migrator may already exist (created by an earlier test as the superuser); guard the
    // create so this test is order-independent, and leave the shared role in place.
    await admin.execute(
      sql.raw(
        `do $$ begin
           if not exists (select 1 from pg_roles where rolname = 'waitron_migrator') then
             create role waitron_migrator login createrole password 'm';
           end if;
         end $$`,
      ),
    );
    const reader = await createPostgresDb(roleUrl(pg.uri, "reader_admin", "r"));
    try {
      const state = await readInstanceState(reader, "waitron_absent", null);
      expect(state.roles.waitron_migrator?.adminCanSetRole).toBe(false);
    } finally {
      await reader.close();
      await admin.execute(sql.raw(`drop role reader_admin`));
    }
  });

  it("reports the migrated sets, the stamp, and the owner once the database exists", async () => {
    await admin.execute(sql.raw(`create database waitron_present`));
    const target = await createPostgresDb(withDatabase(pg.uri, "waitron_present"));
    try {
      const empty = await readInstanceState(admin, "waitron_present", target);
      expect(empty.databaseExists).toBe(true);
      expect(empty.inside).toEqual({ migratedSets: [], stamp: null });
      // The owner is the role that created it — read back so the planner can refuse a database
      // owned by anyone but the migrator.
      const who = await admin.execute<{ me: string }>(sql`select current_user as me`);
      expect(empty.databaseOwner).toBe(who.rows[0]?.me);
    } finally {
      await target.close();
    }
  });
});
