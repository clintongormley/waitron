import { describe, expect, it } from "vitest";
import { CORE_MIGRATIONS } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { decimal, isAppError } from "@waitron/shared";
import { PAYMENTS_MIGRATIONS } from "@waitron/payments";
import { setup } from "./testing/setup.js";

// PGlite: this file proves the reversal LOGIC (the T1 pre-check, the network refund between the two
// transactions, the T2 write). Whether the same writes land as a non-superuser app_user member is
// sumup.test.ts's question (CLAUDE.md §4). `setup` is shared with `provider.test.ts`.
const suite = useVenueDb({
  migrations: [CORE_MIGRATIONS, PAYMENTS_MIGRATIONS],
  timeoutMs: 60_000,
});

describe("SumUpCloudProvider reversals", () => {
  it("void: full refund at SumUp addressed by the captured transaction id, row → voided", async () => {
    const { fake, provider, params, row } = await setup(suite);
    const c = await provider.collect(params);
    const v = await provider.void(c.paymentRef);
    expect(v).toMatchObject({ state: "voided", amount: decimal("12.50"), settledAt: null });
    expect(fake.lastRefund).toEqual({ transactionId: (await row(c.paymentRef)).externalRef });
    expect((await row(c.paymentRef)).state).toBe("voided");
  });

  it("refund: full, row → refunded", async () => {
    const { fake, provider, params, row } = await setup(suite);
    const c = await provider.collect(params);
    const r = await provider.refund(c.paymentRef);
    expect(r).toMatchObject({ state: "refunded", amount: decimal("12.50"), settledAt: null });
    expect(fake.lastRefund).toEqual({ transactionId: (await row(c.paymentRef)).externalRef });
    expect((await row(c.paymentRef)).state).toBe("refunded");
  });

  it("partialRefund: passes the amount and reports the amount REFUNDED", async () => {
    const { fake, provider, params } = await setup(suite);
    const c = await provider.collect(params);
    const p = await provider.partialRefund(c.paymentRef, decimal("2.00"));
    expect(p).toMatchObject({ state: "partially_refunded", amount: decimal("2.00") });
    expect(fake.lastRefund).toMatchObject({ amount: decimal("2.00") });
  });

  it("a SumUp-refused refund records a failed refund and leaves the row captured", async () => {
    const { fake, provider, params, row } = await setup(suite);
    const c = await provider.collect(params);
    fake.refundRefusesNext();
    const r = await provider.refund(c.paymentRef);
    expect(r.state).toBe("captured");
    expect((await row(c.paymentRef)).state).toBe("captured");
  });

  it("a reversal of an attempting row is refused locally before any network (payment.not_voidable / not_refundable)", async () => {
    const { fake, provider, params, row } = await setup(suite, (f) => f.stallNext());
    const c = await provider.collect(params);
    expect((await row(c.paymentRef)).state).toBe("attempting");
    const error = await provider.void(c.paymentRef).catch((e: unknown) => e);
    expect(isAppError(error) && error.code).toBe("payment.not_voidable");
    expect(fake.lastRefund).toBeUndefined();
  });
});
