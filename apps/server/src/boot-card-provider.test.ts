import { describe, expect, it } from "vitest";
import { CORE_MIGRATIONS } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { CREDENTIALS_MIGRATIONS } from "@waitron/credentials";
import { SimulatorPaymentProvider } from "@waitron/payments";
import { buildCardProvider } from "./boot.js";

// Since the Task 12 cutover `buildCardProvider` builds only the DEMO/PREPARE local simulator; every
// other card sale routes to its reader's own provider through the pool at collect time, so a
// live/integration till returns `undefined` here. The simulator needs only `db`, so PGlite
// (superuser, one backend) is the right target — nothing on this path depends on the deployment role
// or on concurrency. `boot.test.ts` boots against a real container in a non-demo mode, exercising
// only the `undefined` branch; this file reaches the simulator branch directly.
const suite = useVenueDb({
  migrations: [CORE_MIGRATIONS, CREDENTIALS_MIGRATIONS],
  timeoutMs: 60_000,
});

describe("buildCardProvider", () => {
  it.each(["demo", "prepare"] as const)("builds the local simulator for %s", async (intent) => {
    const provider = await buildCardProvider(suite.db, intent);
    expect(provider).toBeInstanceOf(SimulatorPaymentProvider);
    expect(provider?.provider).toBe("simulator");
  });

  it("returns undefined with no onboarding intent (a live till uses the pool, not a per-till provider)", async () => {
    const provider = await buildCardProvider(suite.db);
    expect(provider).toBeUndefined();
  });

  it("returns undefined for Prepare with test providers enabled (real readers via the pool)", async () => {
    // Prepare that explicitly opts into real test providers uses real readers through the pool, so
    // there is no per-till simulator to build here.
    const provider = await buildCardProvider(suite.db, "prepare", true);
    expect(provider).toBeUndefined();
  });
});
