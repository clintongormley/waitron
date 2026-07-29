import { beforeEach, describe, expect, it } from "vitest";
import { CORE_MIGRATIONS, createPgliteDb, runMigrations, stampDeployment } from "@waitron/db";
import type { Database } from "@waitron/db";
import { captureError } from "@waitron/db";
import { assertDeploymentMatches } from "./deployment-guard.js";

let db: Database;

beforeEach(async () => {
  db = await createPgliteDb();
  await runMigrations(db, CORE_MIGRATIONS);
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
