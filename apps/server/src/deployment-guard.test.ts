import { beforeAll, describe, expect, it } from "vitest";
import { CORE_MIGRATIONS, captureError, stampDeployment } from "@waitron/db";
import type { Database } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { assertDeploymentMatches } from "./deployment-guard.js";

// Each case needs an EMPTY `deployment` table at its start, which the helper's default per-test
// reset provides.
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
