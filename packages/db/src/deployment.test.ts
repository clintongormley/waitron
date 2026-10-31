// No case here pins that the application may read `deployment` and not write it: CLAUDE.md §3
// states the rule, and nothing in this package holds it.
import { sql } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import type { Database } from "./client.js";
import { readDeploymentEnvironment, stampDeployment } from "./deployment.js";
import { CORE_MIGRATIONS } from "./migrations.js";
import { CHECK_VIOLATION } from "./sql-state.js";
import { isRefusal } from "./unique-violation.js";
import { captureError, engineErrorMessage } from "./testing/errors.js";
import { useVenueDb } from "./testing/venue-db.js";

// A database with NO migration set applied, so `deployment` does not exist — the state of a
// first-ever boot, before the set that creates the table has run, and the state the boot-time
// readers must answer without throwing.
describe("before any migration set has run", () => {
  const bare = useVenueDb({ migrations: [] });

  it("reads as unstamped when the table has not been created yet", async () => {
    expect(await readDeploymentEnvironment(bare.db)).toBeNull();
  });
});

describe("the deployment stamp", () => {
  const suite = useVenueDb({ migrations: [CORE_MIGRATIONS] });
  let db: Database;

  beforeEach(() => {
    db = suite.db;
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
    // `stamped_at` is stated because it is a `$defaultFn` column Drizzle fills CLIENT-side: a raw
    // insert reaches it not at all, and the row would be refused NOT NULL rather than by the
    // singleton CHECK under test.
    const error = await captureError(() =>
      Promise.resolve(
        db.run(
          sql`insert into deployment (id, environment, stamped_at)
              values (2, 'preproduction', ${new Date().toISOString()})`,
        ),
      ),
    );
    expect(isRefusal(error, CHECK_VIOLATION)).toBe(true);
    expect(engineErrorMessage(error)).toMatch(/deployment_singleton_ck/);
  });
});
