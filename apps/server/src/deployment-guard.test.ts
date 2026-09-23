import { beforeAll, describe, expect, it } from "vitest";
import { CORE_MIGRATIONS, captureError, stampDeployment } from "@waitron/db";
import type { Database } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { assertDeploymentMatches } from "./deployment-guard.js";

// One migrated SQLite venue file for the whole suite, where this used to build a fresh PGlite
// database in `beforeEach`. Each case still needs an EMPTY `deployment` table at its start; that
// isolation now comes from the helper's per-test reset (`resetPerTest` defaults to true) rather
// than from a new database.
//
// Measured, not assumed. With `resetPerTest: false` added to the options below,
// `pnpm --filter @waitron/server exec vitest run src/deployment-guard.test.ts` reports
// `1 failed | 3 passed`: the "refuses a production host" case throws
// `deployment.already_stamped` from `packages/db/src/deployment.ts:91`, because the first case's
// `production` row is still sitting there. With the default it reports `4 passed`. The unstamped
// case is NOT the case that shows this — a surviving `production` row reads as a match and it
// passes either way, which is why the control was read off the third case.
//
// Nothing here closes the database: `useVenueDb` owns the file. The guarded `afterEach` close
// this suite carried, and its note on why the guard was needed, have no subject any more.
const suite = useVenueDb({ migrations: [CORE_MIGRATIONS], timeoutMs: 60_000 });

let db: Database;
beforeAll(() => {
  db = suite.db;
});

describe("the deployment guard", () => {
  it("passes when the stamp matches the host", async () => {
    await stampDeployment(db, "production");
    await expect(assertDeploymentMatches(db, "production")).resolves.toBeUndefined();
  });

  it("passes an unstamped database, which every existing deployment is", async () => {
    await expect(assertDeploymentMatches(db, "production")).resolves.toBeUndefined();
  });

  it("refuses a production host against a pre-production database", async () => {
    await stampDeployment(db, "preproduction");
    const error = await captureError(() => assertDeploymentMatches(db, "production"));
    expect(error).toMatchObject({
      code: "deployment.environment_mismatch",
      params: { databaseEnvironment: "preproduction", hostEnvironment: "production" },
    });
  });

  it("refuses the reverse too", async () => {
    await stampDeployment(db, "production");
    const error = await captureError(() => assertDeploymentMatches(db, "preproduction"));
    expect(error).toMatchObject({ code: "deployment.environment_mismatch" });
  });
});
