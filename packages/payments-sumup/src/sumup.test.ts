import { describe, expect, it } from "vitest";
import { CORE_MIGRATIONS } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { decimal, workingOrderId as brandWorkingOrderId, deviceOrigin } from "@waitron/shared";
import { PAYMENTS_MIGRATIONS } from "@waitron/payments";
import { freshNif, seedWorkingOrder } from "@waitron/payments/test/seed.js";
import { FakeSumUp } from "./testing/fake-sumup.js";
import { SumUpCloudProvider } from "./provider.js";

const suite = useVenueDb({ migrations: [CORE_MIGRATIONS, PAYMENTS_MIGRATIONS] });

describe("the sumup cloud adapter's reader requirement", () => {
  it("collect() throws when no readerRef is supplied — a SumUp collect cannot proceed without a reader", async () => {
    // The reader is a per-collect input; a collect with none is a host wiring error, not a
    // decline. Thrown before any DB write or network call — no attempting row.
    const t = await seedWorkingOrder(suite.db, freshNif());
    const provider = new SumUpCloudProvider({
      client: new FakeSumUp(),
      db: suite.db,
      incidents: () => Promise.resolve(true),
      poll: { maxAttempts: 3, intervalMs: 0, sleep: () => Promise.resolve() },
    });
    await expect(
      provider.collect({
        origin: deviceOrigin(t.deviceId),
        workingOrderId: brandWorkingOrderId(t.workingOrderId),
        amount: decimal("10.00"),
      }),
    ).rejects.toThrow(/readerRef/);
  });
});
