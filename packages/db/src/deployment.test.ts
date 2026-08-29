import { sql } from "drizzle-orm";
import { afterEach, beforeEach, expect, it } from "vitest";
import { isAppError } from "@waitron/shared";
import { createPgliteDb, type Database } from "./client.js";
import {
  readDeploymentEnvironment,
  readDeploymentMode,
  readSingletonRole,
  setDeploymentMode,
  setSingletonRole,
  stampDeployment,
} from "./deployment.js";
import { captureError, pgErrorCode, pgErrorMessage } from "./testing/errors.js";
import { describeEachTarget } from "./testing/harness.js";

// Deliberately outside describeEachTarget: every target's create() (testing/harness.ts)
// migrates before handing back a database, so a suite built on it can never observe a
// database the table-creating migration has not reached yet — the exact state of a
// first-ever boot, and the state Task 3's boot-time guard must handle without throwing.
// migrate.test.ts's own top-level "fails loudly when a module folder is migrated before
// the core folder" test uses the same bare createPgliteDb() (no target, no
// runMigrations(..., CORE_MIGRATIONS)) for the identical reason: a pre-migration handle
// is a fixture describeEachTarget's contract cannot produce.
it("reads as unstamped when the table has not been created yet", async () => {
  const bare = await createPgliteDb();
  expect(await readDeploymentEnvironment(bare)).toBeNull();
  // Same pre-migration handle: readDeploymentMode's `to_regclass` probe must see the table as
  // absent and answer "primary" (an unstamped database is a primary) rather than throw, the exact
  // state of a first-ever boot before the table-creating migration has run.
  expect(await readDeploymentMode(bare)).toBe("primary");
  // Same pre-migration handle: readSingletonRole must see the table as absent and answer "primary"
  // (an unstamped database is a sole primary) rather than throw.
  expect(await readSingletonRole(bare)).toBe("primary");
  await bare.close();
});

describeEachTarget("the deployment stamp", (target) => {
  let db: Database;

  beforeEach(async () => {
    // target.create() (testing/harness.ts) already returns a freshly migrated
    // database — CORE_MIGRATIONS included — per test, matching every other
    // suite in this package (see allocate-number.test.ts's beforeEach for why
    // a suite should never build its own migrated handle by hand).
    db = await target.create();
  });

  // This package's convention (see tenancy.test.ts): without it, a pg Pool
  // per test is left open when the postgres target's container stops at
  // describe-level teardown, and it surfaces as an unhandled FATAL 57P01
  // rejection rather than a test failure.
  afterEach(async () => {
    if (db !== undefined) await db.close();
  });

  it("reads as unstamped on a freshly migrated database", async () => {
    expect(await readDeploymentEnvironment(db)).toBeNull();
  });

  it("reads back what was stamped", async () => {
    await stampDeployment(db, "preproduction");
    expect(await readDeploymentEnvironment(db)).toBe("preproduction");
  });

  it("is idempotent for the same value", async () => {
    await stampDeployment(db, "production");
    await stampDeployment(db, "production");
    expect(await readDeploymentEnvironment(db)).toBe("production");
  });

  it("refuses to restamp a database as a different environment", async () => {
    await stampDeployment(db, "preproduction");
    const error = await captureError(() => stampDeployment(db, "production"));
    expect(error).toMatchObject({
      code: "deployment.already_stamped",
      params: { stamped: "preproduction", requested: "production" },
    });
    expect(await readDeploymentEnvironment(db)).toBe("preproduction");
  });

  it("permits at most one row, so there is never an ambiguous answer", async () => {
    await stampDeployment(db, "production");
    const error = await captureError(() =>
      db.execute(sql`insert into deployment (id, environment) values (2, 'preproduction')`),
    );
    expect(error).toBeDefined();
  });

  it("readDeploymentMode returns 'primary' by default and 'mirror' after setDeploymentMode", async () => {
    // Fresh migrated DB, unstamped: an unstamped database is a primary.
    expect(await readDeploymentMode(db)).toBe("primary");
    await stampDeployment(db, "preproduction"); // creates the id=1 row
    expect(await readDeploymentMode(db)).toBe("primary"); // default on the new row
    await setDeploymentMode(db, "mirror");
    expect(await readDeploymentMode(db)).toBe("mirror");
    await setDeploymentMode(db, "primary"); // promotion is a legitimate reverse
    expect(await readDeploymentMode(db)).toBe("primary");
  });

  it("setDeploymentMode fails loud on an unstamped database (no silent 0-row no-op)", async () => {
    // Fresh migrated DB: the deployment singleton row does not exist yet. setDeploymentMode is a
    // promotion primitive, so a mis-sequenced call (before stampDeployment) must THROW, not silently
    // succeed while leaving the database unpromoted. Proven by deletion: dropping the rows.length guard
    // makes the UPDATE a 0-row no-op and captureError sees no error, reddening this.
    const error = await captureError(() => setDeploymentMode(db, "mirror"));
    expect(error).toMatchObject({ code: "deployment.not_stamped" });
    // Nothing was written — still reads the unstamped default.
    expect(await readDeploymentMode(db)).toBe("primary");
  });

  it("the mode CHECK rejects any value outside primary/mirror", async () => {
    await stampDeployment(db, "preproduction");
    // Not `.rejects.toThrow(/deployment_mode_ck|23514/)`: drizzle-orm@0.45.2 wraps every failed
    // query in a DrizzleQueryError whose own `.message` is `Failed query: <sql>` — the CHECK name
    // and SQLSTATE live on `.cause`, which `toThrow` never reads (see tenancy.test.ts's
    // `rejectsWithCauseMatching` / series.test.ts). Read the reason off the cause instead: 23514 is
    // check_violation.
    const error = await captureError(() =>
      db.execute(sql`update deployment set mode = 'bogus' where id = 1`),
    );
    expect(pgErrorCode(error)).toBe("23514");
    expect(pgErrorMessage(error)).toMatch(/deployment_mode_ck/);
  });

  it("app_user may SELECT deployment but may NOT write it (the mode write is owner-only)", async () => {
    // Read the ACL back both directions: the SELECT app_user should hold is present, and the
    // INSERT/UPDATE it must NOT hold are absent (the mode write is an owner-role write — no new
    // grant was added, so app_user's only privilege on deployment is 0010's table-wide SELECT).
    // has_table_privilege reads pg_class.relacl regardless of the connected role, so this is the
    // authoritative answer on the postgres target as much as on pglite.
    const rows = await db.execute<{ sel: boolean; ins: boolean; upd: boolean }>(sql`
      select
        has_table_privilege('app_user', 'deployment', 'SELECT') as sel,
        has_table_privilege('app_user', 'deployment', 'INSERT') as ins,
        has_table_privilege('app_user', 'deployment', 'UPDATE') as upd
    `);
    expect(rows.rows[0]).toEqual({ sel: true, ins: false, upd: false });
  });

  it("reads singleton_role as 'primary' on a freshly stamped database", async () => {
    await stampDeployment(db, "preproduction");
    expect(await readSingletonRole(db)).toBe("primary");
  });

  it("reads back a singleton_role that was set to 'secondary'", async () => {
    await stampDeployment(db, "preproduction");
    await setSingletonRole(db, "secondary");
    expect(await readSingletonRole(db)).toBe("secondary");
  });

  it("demoting to mirror co-sets singleton_role to 'secondary'", async () => {
    await stampDeployment(db, "preproduction");
    await setDeploymentMode(db, "mirror");
    expect(await readDeploymentMode(db)).toBe("mirror");
    expect(await readSingletonRole(db)).toBe("secondary");
  });

  it("refuses singleton_role='primary' on a mirror (deployment_role_valid_ck)", async () => {
    await stampDeployment(db, "preproduction");
    await setDeploymentMode(db, "mirror");
    const error = await captureError(() => setSingletonRole(db, "primary"));
    expect(pgErrorCode(error)).toBe("23514"); // check_violation
  });

  it("setSingletonRole fails loudly on an unstamped database", async () => {
    const error = await captureError(() => setSingletonRole(db, "secondary"));
    expect(isAppError(error) && error.code).toBe("deployment.not_stamped");
  });
});
