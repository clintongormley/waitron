import { expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { CORE_MIGRATIONS, captureError, triggerRaised } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { PAYMENTS_MIGRATIONS } from "../migrations.js";
import { PAYMENT_CHANGE_REFUSAL } from "../trigger-refusals.js";
import { payments } from "../schema/payments.js";
import { seedWorkingOrder } from "../../test/seed.js";
import { liftPaymentGuard } from "./lift-payment-guard.js";

const suite = useVenueDb({ migrations: [CORE_MIGRATIONS, PAYMENTS_MIGRATIONS] });

it.each([false, true])(
  "restores the guard after a write, including a throwing write (%s)",
  async (throws) => {
    const seeded = await seedWorkingOrder(suite.db);
    await suite.db.insert(payments).values({
      workingOrderId: seeded.workingOrderId,
      source: "device",
      deviceId: seeded.deviceId,
      provider: "fake",
      paymentRef: "lift",
      amount: 1000,
      state: "captured",
    });
    const failure = new Error("write failed");
    const write = liftPaymentGuard(suite.db, async () => {
      await suite.db.execute(sql`update payments set provider = 'other'`);
      if (throws) throw failure;
    });
    if (throws) await expect(write).rejects.toBe(failure);
    else await write;
    expect((await suite.db.select().from(payments))[0]!.provider).toBe("other");
    const error = await captureError(() =>
      suite.db.execute(sql`update payments set provider = 'fake'`),
    );
    expect(triggerRaised(error, PAYMENT_CHANGE_REFUSAL)).toBe(true);
  },
);
