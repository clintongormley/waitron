import { dirname, join } from "node:path";
import { sql } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { CORE_MIGRATIONS, captureError, stampDeployment } from "@waitron/db";
import type { Database } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { FISCAL_SLOT } from "@waitron/fiscal-verifactu";
import { seedPendingEnvios } from "@waitron/fiscal-verifactu/test/drain-fixtures.js";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { startServer } from "./boot.js";
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

  it("passes an empty unstamped database", async () => {
    await expect(assertDeploymentMatches(db, "production")).resolves.toBeUndefined();
  });

  it("allows an empty setup before the fiscal tables are migrated", async () => {
    await expect(assertDeploymentMatches(db, "production", [FISCAL_SLOT])).resolves.toBeUndefined();
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

describe("an unstamped venue's fiscal history", () => {
  const venue = useVenueDb({ migrations: migrationOptionsFor(manifestSets(), null) });

  it("refuses production when a retained record was generated for preproduction", async () => {
    await seedPendingEnvios(venue.db, { count: 1, entorno: "preproduction" });
    const error = await captureError(() =>
      assertDeploymentMatches(venue.db, "production", [FISCAL_SLOT]),
    );
    expect(error).toMatchObject({
      code: "deployment.environment_mismatch",
      params: { databaseEnvironment: "nonproduction", hostEnvironment: "production" },
    });
  });

  it("refuses production when a retained record's environment is unknown", async () => {
    await seedPendingEnvios(venue.db, { count: 1, entorno: null });
    const error = await captureError(() =>
      assertDeploymentMatches(venue.db, "production", [FISCAL_SLOT]),
    );
    expect(error).toMatchObject({ code: "deployment.environment_mismatch" });
  });

  it("refuses the real startup before migrations and preserves the retained record", async () => {
    await seedPendingEnvios(venue.db, { count: 1, entorno: "preproduction" });
    const directory = dirname(
      venue.db
        .all<{ name: string; file: string }>(sql`pragma database_list`)
        .find((row) => row.name === "main")!.file,
    );
    const before = venue.db.all(sql`select * from registros_facturacion`);
    const error = await captureError(() =>
      startServer({
        WAITRON_VENUE_DIR: directory,
        WAITRON_STATE_DIR: join(directory, "state"),
        WAITRON_LOG_DIR: join(directory, "logs"),
        WAITRON_MIGRATIONS_DIR: join(directory, "missing-migrations"),
        WAITRON_ENV: "production",
        WAITRON_MANAGEMENT_RP_ID: "dashboard.example.test",
        WAITRON_MANAGEMENT_ORIGIN: "https://dashboard.example.test",
      }),
    );
    expect(error).toMatchObject({ code: "deployment.environment_mismatch" });
    expect(venue.db.all(sql`select * from registros_facturacion`)).toEqual(before);
    expect(venue.db.all(sql`select * from deployment`)).toEqual([]);
  });

  it("keeps an empty production setup available", async () => {
    await expect(
      assertDeploymentMatches(venue.db, "production", [FISCAL_SLOT]),
    ).resolves.toBeUndefined();
  });

  it("permits preproduction records on their preproduction host", async () => {
    await seedPendingEnvios(venue.db, { count: 1, entorno: "preproduction" });
    await expect(
      assertDeploymentMatches(venue.db, "preproduction", [FISCAL_SLOT]),
    ).resolves.toBeUndefined();
  });

  it("does not confuse production records with preproduction records", async () => {
    await seedPendingEnvios(venue.db, { count: 1, entorno: "production" });
    await expect(
      assertDeploymentMatches(venue.db, "production", [FISCAL_SLOT]),
    ).resolves.toBeUndefined();
  });
});
