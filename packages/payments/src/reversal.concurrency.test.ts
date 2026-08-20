import { describe, expect, it } from "vitest";
import { withTenant } from "@waitron/db";
import { useTemplateDb } from "@waitron/db/testing/lifecycle.js";
import { decimal } from "@waitron/shared";
import { insertCapturedPayment, recordRefund } from "./store.js";
import { freshNif, seedWorkingOrder } from "../test/seed.js";

// A clone of the `core_payments` template (CORE + PAYMENTS) from the shared container the package
// globalSetup boots.
const postgres = useTemplateDb({ template: "core_payments" });

const SETTLED = new Date("2026-07-23T10:00:00Z");

describe("concurrent reversals serialise on the payment row's FOR UPDATE lock", () => {
  it("a second recordRefund blocks until the first transaction commits, then sees the updated total", async () => {
    const seeded = await seedWorkingOrder(postgres.admin, freshNif());
    const key = { tenantId: seeded.tenantId, provider: "fake", paymentRef: "c1" };
    await postgres.admin.transaction((tx) =>
      insertCapturedPayment(tx, {
        ...key,
        workingOrderId: seeded.workingOrderId,
        amount: decimal("20.00"),
        settledAt: SETTLED,
      }),
    );

    const holder = await postgres.pg.connect();
    const waiter = await postgres.pg.connect();
    let release: () => void = () => {};
    let holding: Promise<unknown> | undefined;
    try {
      const held = new Promise<void>((resolve) => (release = resolve));
      let acquire!: () => void;
      const acquired = new Promise<void>((resolve) => (acquire = resolve));
      holding = withTenant(holder, seeded.tenantId, async (tx) => {
        await recordRefund(tx, { ...key, amount: decimal("12.00") }); // takes FOR UPDATE on the row
        acquire(); // signal the lock is held
        await held; // hold the tx open
      });
      await acquired; // do not race before the lock is actually held

      const start = Date.now();
      const secondDone = withTenant(waiter, seeded.tenantId, (tx) =>
        recordRefund(tx, { ...key, amount: decimal("8.00") }),
      );
      // Give the waiter a beat; it must still be blocked on the lock.
      await new Promise((r) => setTimeout(r, 200));
      let settledEarly = false;
      await Promise.race([
        secondDone.then(() => (settledEarly = true)),
        new Promise((r) => setTimeout(r, 0)),
      ]);
      expect(settledEarly).toBe(false);

      release();
      const second = await secondDone;
      expect(second.state).toBe("refunded"); // 12 + 8 = 20 = capture
      expect(Date.now() - start).toBeGreaterThanOrEqual(150);
    } finally {
      release();
      if (holding) await holding.catch(() => {});
      await holder.close();
      await waiter.close();
    }
  });
});
