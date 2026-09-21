// Real PostgreSQL: checks app_user SELECT and withheld write privileges on deployment.
import { sql } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { isAppError } from "@waitron/shared";
import type { Database } from "./client.js";
import {
  readDeploymentAxes,
  readDeploymentEnvironment,
  readDeploymentMode,
  readSingletonRole,
  setDeploymentMode,
  setDeploymentModeTx,
  setSingletonRole,
  setSingletonRoleTx,
  stampDeployment,
} from "./deployment.js";
import { captureError, pgErrorCode, pgErrorMessage } from "./testing/errors.js";
import { describeEachTarget } from "./testing/harness.js";
import { useVenueDb } from "./testing/venue-db.js";

// A database with NO migration set applied, so `deployment` does not exist — the state of a
// first-ever boot, before the set that creates the table has run, and the state the boot-time
// readers must answer without throwing. It needs its own handle: `useVenueDb` applies the sets it
// is given in `beforeAll`, and every other fixture in this file hands back an already-migrated
// database, so no suite built on one of those can observe this state.
describe("before any migration set has run", () => {
  const bare = useVenueDb({ migrations: [] });

  it("reads as unstamped when the table has not been created yet", async () => {
    expect(await readDeploymentEnvironment(bare.db)).toBeNull();
    // Same pre-migration handle: readDeploymentMode must see the table as absent and answer
    // "primary" (an unstamped database is a primary) rather than throw.
    expect(await readDeploymentMode(bare.db)).toBe("primary");
    // Same pre-migration handle: readSingletonRole must see the table as absent and answer
    // "primary" (an unstamped database is a sole primary) rather than throw.
    expect(await readSingletonRole(bare.db)).toBe("primary");
    // readDeploymentAxes answers for both axes at once, so an unstamped database must read primary
    // on both rather than throwing halfway.
    expect(await readDeploymentAxes(bare.db)).toEqual({
      mode: "primary",
      singletonRole: "primary",
    });
  });
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

  it("reads as a sole primary on a migrated database nothing has stamped", async () => {
    // The table exists but holds no row — no migration seeds one, only stampDeployment does — so
    // the readers fall back rather than reading an absent row. A box between its first migration
    // and its first stamp is in exactly this state, and it must still sell.
    expect(await readSingletonRole(db)).toBe("primary");
    expect(await readDeploymentMode(db)).toBe("primary");
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

  it("setDeploymentMode('primary') leaves an already-'secondary' singleton_role untouched", async () => {
    // Backs the setDeploymentMode doc comment's claim (deployment.ts): flipping mode to 'primary'
    // does NOT co-set singleton_role, unlike the 'mirror' direction proven above. This is the
    // (primary, secondary) sell-only-local-secondary transition — a read-write node holding no
    // singletons — which the 'mirror' co-set test does not exercise.
    await stampDeployment(db, "preproduction");
    await setSingletonRole(db, "secondary"); // a (primary, secondary) sell-only node
    await setDeploymentMode(db, "primary");
    expect(await readDeploymentMode(db)).toBe("primary");
    expect(await readSingletonRole(db)).toBe("secondary"); // NOT reset by the mode write
  });

  it("setDeploymentMode('primary') leaves a sole primary holding the singletons", async () => {
    // The other half of the case above, and the one that matters more: there the node was already
    // a secondary, so a mode write that wrongly co-set singleton_role to 'secondary' would have
    // written the value that was there anyway and nothing would have noticed. Here the node holds
    // the singletons, so the same wrong write demotes it — a venue whose only node stops being the
    // one that sells.
    await stampDeployment(db, "preproduction");
    await setDeploymentMode(db, "primary");
    expect(await readSingletonRole(db)).toBe("primary");
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

  it("setSingletonRoleTx flips the role inside a caller transaction", async () => {
    // The tx-taking form (Task 4 commits this flip and a membership-document write in ONE
    // transaction): stamp first, run it on a caller-provided tx, confirm the flip persists.
    await stampDeployment(db, "preproduction");
    await db.transaction(async (tx) => {
      await setSingletonRoleTx(tx, "secondary");
    });
    expect(await readSingletonRole(db)).toBe("secondary");
  });

  it("setDeploymentModeTx flips mode on a caller tx and co-sets singleton_role for mirror", async () => {
    await stampDeployment(db, "preproduction");
    await db.transaction((tx) => setDeploymentModeTx(tx, "mirror"));
    expect(await readDeploymentMode(db)).toBe("mirror");
    expect(await readSingletonRole(db)).toBe("secondary");
  });

  it("setDeploymentModeTx to primary leaves singleton_role untouched", async () => {
    await stampDeployment(db, "preproduction");
    await setSingletonRole(db, "secondary");
    await setDeploymentMode(db, "mirror"); // (mirror, secondary)
    await db.transaction(async (tx) => {
      await setDeploymentModeTx(tx, "primary"); // (primary, secondary) — valid, no CHECK violation
      await setSingletonRoleTx(tx, "primary"); // (primary, primary)
    });
    expect(await readDeploymentMode(db)).toBe("primary");
    expect(await readSingletonRole(db)).toBe("primary");
  });

  it("readDeploymentAxes returns both axes in one read", async () => {
    // A (primary, secondary) sell-only-local-secondary node: a read-write primary holding no
    // singletons. The single read must return exactly this pair — asserted with toEqual so a
    // stray extra key or a wrong field fails.
    await stampDeployment(db, "preproduction");
    await setSingletonRole(db, "secondary");
    expect(await readDeploymentAxes(db)).toEqual({ mode: "primary", singletonRole: "secondary" });
  });

  it("readDeploymentAxes reflects a mirror's co-set (mirror, secondary) pair", async () => {
    await stampDeployment(db, "preproduction");
    await setSingletonRole(db, "secondary");
    await setDeploymentMode(db, "mirror");
    expect(await readDeploymentAxes(db)).toEqual({ mode: "mirror", singletonRole: "secondary" });
  });

  it("readDeploymentAxes returns (primary, primary) on a freshly migrated, unstamped database", async () => {
    // Unstamped: the singleton row does not exist. Each field falls back to 'primary', matching
    // readDeploymentMode/readSingletonRole — an unstamped database is a sole primary.
    expect(await readDeploymentAxes(db)).toEqual({ mode: "primary", singletonRole: "primary" });
  });
});
