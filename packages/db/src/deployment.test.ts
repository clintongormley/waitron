import { sql } from "drizzle-orm";
import { afterEach, beforeEach, expect, it } from "vitest";
import { createPgliteDb, type Database } from "./client.js";
import { readDeploymentEnvironment, stampDeployment } from "./deployment.js";
import { captureError } from "./testing/errors.js";
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
});
