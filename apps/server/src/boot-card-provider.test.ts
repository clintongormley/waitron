import { describe, expect, it } from "vitest";
import { CORE_MIGRATIONS } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { CREDENTIALS_MIGRATIONS } from "@waitron/credentials";
import { SimulatorPaymentProvider } from "@waitron/payments";
import { buildCardProvider } from "./boot.js";

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
    const provider = await buildCardProvider(suite.db, "prepare", true);
    expect(provider).toBeUndefined();
  });
});
