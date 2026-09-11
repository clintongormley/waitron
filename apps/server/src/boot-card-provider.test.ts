import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { CORE_MIGRATIONS } from "@waitron/db";
import { usePgliteDb } from "@waitron/db/testing/lifecycle.js";
import { CREDENTIALS_MIGRATIONS } from "@waitron/credentials";
import {
  locationId as brandLocationId,
  nodeId as brandNodeId,
  seriesId as brandSeriesId,
  tillId as brandTillId,
} from "@waitron/shared";
import type { TenantId } from "@waitron/shared";
import { SimulatorPaymentProvider } from "@waitron/payments";
import { seedTenant } from "@waitron/db/testing/seed.js";
import { buildCardProvider } from "./boot.js";
import type { TillConfig } from "./till-config.js";

// Since the Task 12 cutover `buildCardProvider` builds only the DEMO/PREPARE local simulator; every
// other card sale routes to its reader's own provider through the pool at collect time, so a
// live/integration till returns `undefined` here. The simulator needs only `db` + `tenantId`, so
// PGlite (superuser, one backend) is the right target — nothing on this path depends on the
// deployment role or on concurrency. `boot.test.ts` boots against a real container in a non-demo mode,
// exercising only the `undefined` branch; this file reaches the simulator branch directly.
const suite = usePgliteDb({
  migrations: [CORE_MIGRATIONS, CREDENTIALS_MIGRATIONS],
  timeoutMs: 60_000,
});

/** A TillConfig for `tenantId` — only `tenantId` is read by `buildCardProvider`; the rest are fresh
 * throwaway brands so the object is a well-formed `TillConfig`. */
function cfgFor(tenantId: TenantId): TillConfig {
  return {
    tenantId,
    tillId: brandTillId(randomUUID()),
    nodeId: brandNodeId(randomUUID()),
    seriesId: brandSeriesId(randomUUID()),
    locationId: brandLocationId(randomUUID()),
    locale: "es-ES",
    invoiceLocales: ["es-ES"],
    tipsEnabled: false,
    orderFlow: "prepay",
  };
}

describe("buildCardProvider", () => {
  it.each(["demo", "prepare"] as const)("builds the local simulator for %s", async (intent) => {
    const tenantId = await seedTenant(suite.db);
    const provider = await buildCardProvider(cfgFor(tenantId), suite.db, intent);
    expect(provider).toBeInstanceOf(SimulatorPaymentProvider);
    expect(provider?.provider).toBe("simulator");
  });

  it("returns undefined with no onboarding intent (a live till uses the pool, not a per-till provider)", async () => {
    const tenantId = await seedTenant(suite.db);
    const provider = await buildCardProvider(cfgFor(tenantId), suite.db);
    expect(provider).toBeUndefined();
  });

  it("returns undefined for Prepare with test providers enabled (real readers via the pool)", async () => {
    // Prepare that explicitly opts into real test providers uses real readers through the pool, so
    // there is no per-till simulator to build here.
    const tenantId = await seedTenant(suite.db);
    const provider = await buildCardProvider(cfgFor(tenantId), suite.db, "prepare", true);
    expect(provider).toBeUndefined();
  });
});
