import { describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { CORE_MIGRATIONS, withTransaction } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { decimal, deviceOrigin } from "@waitron/shared";
import * as payment from "./index.js";
import { paymentRefunds } from "./schema/payment-refunds.js";
import { freshNif, seedWorkingOrder } from "../test/seed.js";

const suite = useVenueDb({ migrations: [CORE_MIGRATIONS, payment.PAYMENTS_MIGRATIONS] });

async function captured(externalRef: string | null = "processor-1") {
  const seeded = await seedWorkingOrder(suite.db, freshNif());
  const key = { provider: "example", paymentRef: randomUUID() };
  await withTransaction(suite.db, (tx) =>
    payment.insertCapturedPayment(tx, {
      ...key,
      origin: deviceOrigin(seeded.deviceId),
      workingOrderId: seeded.workingOrderId,
      nodeId: seeded.nodeId,
      amount: decimal("12.50"),
      settledAt: new Date(),
      ...(externalRef === null ? {} : { externalRef }),
    }),
  );
  const row = () => withTransaction(suite.db, (tx) => payment.getPaymentByRef(tx, key));
  const refunds = () =>
    suite.db
      .select({ amount: paymentRefunds.amount, state: paymentRefunds.state })
      .from(paymentRefunds)
      .where(eq(paymentRefunds.paymentRef, key.paymentRef));
  return { key, row, refunds };
}

describe("provider-neutral reversal", () => {
  it.each([
    { kind: "void" as const, amount: undefined, state: "voided", refunded: [] },
    {
      kind: "refund" as const,
      amount: undefined,
      state: "refunded",
      refunded: [{ amount: 1250, state: "succeeded" }],
    },
    {
      kind: "refund" as const,
      amount: decimal("2.00"),
      state: "partially_refunded",
      refunded: [{ amount: 200, state: "succeeded" }],
    },
  ])(
    "records accepted $kind of $amount after the provider call",
    async ({ kind, amount, state, refunded }) => {
      const { key, row, refunds } = await captured();
      const called: string[] = [];
      const result = await payment.reversePayment(
        suite.db,
        { ...key, kind, amount },
        async (externalRef) => {
          called.push(externalRef);
          expect((await row())?.state).toBe("captured");
          expect(await refunds()).toEqual([]);
          return "accepted";
        },
      );
      expect(called).toEqual(["processor-1"]);
      expect(result).toEqual({ ...key, state, amount: amount ?? "12.50", settledAt: null });
      expect((await row())?.state).toBe(state);
      expect(await refunds()).toEqual(refunded);
    },
  );

  it.each([undefined, decimal("2.00")])(
    "records a refusal of amount %s without refunding the payment",
    async (amount) => {
      const { key, row, refunds } = await captured();
      const result = await payment.reversePayment(
        suite.db,
        { ...key, kind: "refund", amount },
        () => Promise.resolve("refused"),
      );
      expect(result).toEqual({
        ...key,
        state: "captured",
        amount: amount ?? "12.50",
        settledAt: null,
      });
      expect((await row())?.state).toBe("captured");
      expect(await refunds()).toEqual([
        { amount: amount === undefined ? 1250 : 200, state: "failed" },
      ]);
    },
  );

  it("refuses an excessive refund before calling the provider", async () => {
    const { key, row, refunds } = await captured();
    let called = false;
    await expect(
      payment.reversePayment(suite.db, { ...key, kind: "refund", amount: decimal("13.00") }, () => {
        called = true;
        return Promise.resolve("accepted");
      }),
    ).rejects.toMatchObject({ code: "payment.refund_exceeds_capture" });
    expect(called).toBe(false);
    expect((await row())?.state).toBe("captured");
    expect(await refunds()).toEqual([]);
  });

  it.each(["missing", "unstamped"])(
    "refuses a %s payment before calling the provider",
    async (condition) => {
      const { key } = await captured(null);
      const paymentRef = condition === "missing" ? "no-such-payment" : key.paymentRef;
      let called = false;
      await expect(
        payment.reversePayment(
          suite.db,
          { ...key, paymentRef, kind: "refund", amount: undefined },
          () => {
            called = true;
            return Promise.resolve("accepted");
          },
        ),
      ).rejects.toMatchObject({
        code: "payment.not_found",
        params: { provider: key.provider, paymentRef },
      });
      expect(called).toBe(false);
    },
  );

  it("propagates an uncertain provider failure without writing a refund", async () => {
    const { key, row, refunds } = await captured();
    const failure = new Error("provider unanswered");
    await expect(
      payment.reversePayment(suite.db, { ...key, kind: "refund", amount: undefined }, () =>
        Promise.reject(failure),
      ),
    ).rejects.toBe(failure);
    expect((await row())?.state).toBe("captured");
    expect(await refunds()).toEqual([]);
  });
});
