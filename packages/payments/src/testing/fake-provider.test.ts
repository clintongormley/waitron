import { beforeEach, describe, expect, it, vi } from "vitest";
import { sql } from "drizzle-orm";
import { CORE_MIGRATIONS } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { openIncidents } from "@waitron/core";
import {
  AppError,
  decimal,
  tillId as brandTillId,
  workingOrderId as brandWorkingOrderId,
  deviceOrigin,
} from "@waitron/shared";
import { PAYMENTS_MIGRATIONS } from "../migrations.js";
import {
  associatePaymentWithSale,
  findPaymentByRef,
  getPaymentByRef,
  insertAttempting,
} from "../store.js";
import { FakePaymentProvider } from "./fake-provider.js";
import {
  billPaymentOfRow,
  freshNif,
  seedBillPayment,
  seedPaymentPolicy,
  seedSale,
  seedWorkingOrder,
} from "../../test/seed.js";
import type { Seeded } from "../../test/seed.js";

const suite = useVenueDb({ migrations: [CORE_MIGRATIONS, PAYMENTS_MIGRATIONS] });

beforeEach(async () => {
  // Child before parent: a `payment_refunds` row points at its payment. A resolved payment stays:
  // its `payment_resolutions` row is append-only.
  await suite.db.execute(sql`delete from payment_refunds`);
  await suite.db.execute(
    sql`delete from payments where id not in (select payment_id from payment_resolutions)`,
  );
});

async function seedTenant(): Promise<Seeded> {
  return seedWorkingOrder(suite.db, freshNif());
}

async function collect(
  provider: FakePaymentProvider,
  s: Seeded,
  amount = "10.00",
  allowOffline?: boolean,
) {
  return provider.collect({
    origin: deviceOrigin(s.deviceId),
    workingOrderId: brandWorkingOrderId(s.workingOrderId),
    amount: decimal(amount),
    ...(allowOffline === undefined ? {} : { allowOffline }),
  });
}

describe("FakePaymentProvider.collect", () => {
  it("returns a captured result with a settledAt and persists it", async () => {
    const s = await seedTenant();
    await seedTenant();
    const provider = new FakePaymentProvider(suite.db);
    const r = await collect(provider, s);
    expect(r.state).toBe("captured");
    expect(r.settledAt).not.toBeNull();
    expect(r.provider).toBe("fake");
    const row = await suite.db.transaction((tx) => findPaymentByRef(tx, "fake", r.paymentRef));
    expect(row?.state).toBe("captured");
    expect(row?.amount).toBe("10.00");
  });

  it("returns a failed result with a null settledAt after failNextCollect, then recovers on the next call", async () => {
    const s = await seedTenant();
    await seedTenant();
    const provider = new FakePaymentProvider(suite.db);
    provider.failNextCollect();
    const failed = await collect(provider, s);
    expect(failed.state).toBe("failed");
    expect(failed.settledAt).toBeNull();
    const row = await suite.db.transaction((tx) => findPaymentByRef(tx, "fake", failed.paymentRef));
    expect(row?.state).toBe("failed");

    const recovered = await collect(provider, s);
    expect(recovered.state).toBe("captured");
    expect(recovered.settledAt).not.toBeNull();
  });
});

describe("FakePaymentProvider.void", () => {
  it("reverses a captured payment to voided", async () => {
    const s = await seedTenant();
    await seedTenant();
    const provider = new FakePaymentProvider(suite.db);
    const paid = await collect(provider, s);
    const voided = await provider.void(paid.paymentRef);
    expect(voided.state).toBe("voided");
  });

  it("throws payment.not_found for an unknown ref", async () => {
    const provider = new FakePaymentProvider(suite.db);
    const error = await provider.void("unknown").catch((e: unknown) => e);
    expect(error).toBeInstanceOf(AppError);
    expect((error as AppError).code).toBe("payment.not_found");
  });
});

describe("FakePaymentProvider.refund", () => {
  it("refund of the full amount marks the payment refunded", async () => {
    const s = await seedTenant();
    await seedTenant();
    const provider = new FakePaymentProvider(suite.db);
    const paid = await collect(provider, s);
    const refunded = await provider.refund(paid.paymentRef);
    expect(refunded.state).toBe("refunded");
  });

  it("throws payment.not_found for an unknown ref", async () => {
    const provider = new FakePaymentProvider(suite.db);
    const error = await provider.refund("unknown").catch((e: unknown) => e);
    expect(error).toBeInstanceOf(AppError);
    expect((error as AppError).code).toBe("payment.not_found");
  });
});

describe("FakePaymentProvider.partialRefund", () => {
  it("refunding part of the captured amount marks the payment partially_refunded", async () => {
    const s = await seedTenant();
    await seedTenant();
    const provider = new FakePaymentProvider(suite.db);
    const paid = await collect(provider, s, "20.00");
    const partial = await provider.partialRefund(paid.paymentRef, decimal("12.00"));
    expect(partial.state).toBe("partially_refunded");
  });

  it("partialRefund reports the refunded amount, not the captured total", async () => {
    const seeded = await seedTenant();
    const provider = new FakePaymentProvider(suite.db);
    const paid = await provider.collect({
      origin: deviceOrigin(seeded.deviceId),
      workingOrderId: brandWorkingOrderId(seeded.workingOrderId),
      amount: decimal("20.00"),
    });
    const refunded = await provider.partialRefund(paid.paymentRef, decimal("5.00"));
    expect(refunded.amount).toBe(decimal("5.00"));
    expect(refunded.state).toBe("partially_refunded");
  });
});

describe("FakePaymentProvider.capabilities", () => {
  it("advertises partialRefund support", () => {
    expect(new FakePaymentProvider(suite.db).capabilities.partialRefund).toBe(true);
  });
});

describe("FakePaymentProvider.collect for a bill payment", () => {
  function collectFor(provider: FakePaymentProvider, s: Seeded, billPaymentId: string) {
    return provider.collect({
      origin: deviceOrigin(s.deviceId),
      workingOrderId: brandWorkingOrderId(s.workingOrderId),
      amount: decimal("10.00"),
      billPaymentId,
    });
  }

  it("names the bill payment on a captured row and on a failed one", async () => {
    const s = await seedTenant();
    const provider = new FakePaymentProvider(suite.db);
    const first = await seedBillPayment(suite.db, s);
    const second = await seedBillPayment(suite.db, s);

    const captured = await collectFor(provider, s, first);
    provider.failNextCollect();
    const failed = await collectFor(provider, s, second);

    expect(await billPaymentOfRow(suite.db, captured.paymentRef)).toBe(first);
    expect(await billPaymentOfRow(suite.db, failed.paymentRef)).toBe(second);
  });

  it("names the bill payment on a row accepted offline", async () => {
    const s = await seedTenant();
    await seedPaymentPolicy(suite.db, "accept_offline", "50.00");
    const provider = new FakePaymentProvider(suite.db);
    const billPaymentId = await seedBillPayment(suite.db, s);
    provider.offlineNextCollect();

    const r = await provider.collect({
      origin: deviceOrigin(s.deviceId),
      workingOrderId: brandWorkingOrderId(s.workingOrderId),
      amount: decimal("10.00"),
      allowOffline: true,
      billPaymentId,
    });

    expect(r.state).toBe("accepted_offline");
    expect(await billPaymentOfRow(suite.db, r.paymentRef)).toBe(billPaymentId);
  });

  it("records every collect it is asked for, with its parameters", async () => {
    const s = await seedTenant();
    const provider = new FakePaymentProvider(suite.db);
    const billPaymentId = await seedBillPayment(suite.db, s);

    await collectFor(provider, s, billPaymentId);

    expect(provider.collectCalls).toEqual([
      expect.objectContaining({ amount: "10.00", billPaymentId }),
    ]);
  });

  it("stallNextCollect leaves an attempting row and answers attempting, once", async () => {
    const s = await seedTenant();
    const provider = new FakePaymentProvider(suite.db);
    const billPaymentId = await seedBillPayment(suite.db, s);
    provider.stallNextCollect();

    const stalled = await collectFor(provider, s, billPaymentId);
    const next = await collect(provider, s);

    expect(stalled).toMatchObject({ state: "attempting", settledAt: null });
    const row = await suite.db.transaction((tx) =>
      findPaymentByRef(tx, "fake", stalled.paymentRef),
    );
    expect(row?.state).toBe("attempting");
    expect(await billPaymentOfRow(suite.db, stalled.paymentRef)).toBe(billPaymentId);
    expect(next.state).toBe("captured");
  });

  it.each(["captured", "attempting"] as const)(
    "crashNextCollect writes a %s row and then throws, as a process dying after the provider wrote",
    async (state) => {
      const s = await seedTenant();
      const provider = new FakePaymentProvider(suite.db);
      const billPaymentId = await seedBillPayment(suite.db, s);
      provider.crashNextCollect(state);

      const error = await collectFor(provider, s, billPaymentId).catch((e: unknown) => e);

      expect(error).toBeInstanceOf(Error);
      const rows = await suite.db.execute<{ state: string }>(
        sql`select state from payments where bill_payment_id = ${billPaymentId}`,
      );
      expect(rows.rows).toEqual([{ state }]);
      expect((await collect(provider, s)).state).toBe("captured");
    },
  );

  it("holdNextCollect waits, having recorded the call, until released", async () => {
    const s = await seedTenant();
    const provider = new FakePaymentProvider(suite.db);
    const billPaymentId = await seedBillPayment(suite.db, s);
    const release = provider.holdNextCollect();

    const pending = collectFor(provider, s, billPaymentId);
    await vi.waitFor(() => expect(provider.collectCalls).toHaveLength(1));
    const before = await suite.db.execute<{ n: number }>(
      sql`select count(*) as n from payments where bill_payment_id = ${billPaymentId}`,
    );
    release();
    const result = await pending;

    expect(before.rows[0]!.n).toBe(0);
    expect(result.state).toBe("captured");
  });
});

describe("FakePaymentProvider.collect offline", () => {
  it("accepts offline when policy allows, staff opt in, and amount is within the cap", async () => {
    const s = await seedTenant();
    await seedTenant();
    await seedPaymentPolicy(suite.db, "accept_offline", "50.00");
    const provider = new FakePaymentProvider(suite.db);
    provider.offlineNextCollect();
    const r = await collect(provider, s, "10.00", true);
    expect(r.state).toBe("accepted_offline");
    expect(r.offline).toBe(true);
    expect(r.settledAt).not.toBeNull();
    const row = await suite.db.transaction((tx) => findPaymentByRef(tx, "fake", r.paymentRef));
    expect(row?.state).toBe("accepted_offline");
    expect(row?.settledAt).not.toBeNull();
  });

  it("returns network_unavailable and writes nothing when staff did not opt in", async () => {
    const s = await seedTenant();
    await seedTenant();
    await seedPaymentPolicy(suite.db, "accept_offline", "50.00");
    const provider = new FakePaymentProvider(suite.db);
    provider.offlineNextCollect();
    const r = await collect(provider, s, "10.00", false);
    expect(r.state).toBe("network_unavailable");
    expect(r.settledAt).toBeNull();
    const row = await suite.db.transaction((tx) => findPaymentByRef(tx, "fake", r.paymentRef));
    expect(row).toBeUndefined();
  });

  it("returns network_unavailable when there is no policy row (fail-safe)", async () => {
    const s = await seedTenant();
    await seedTenant();
    const provider = new FakePaymentProvider(suite.db);
    provider.offlineNextCollect();
    const r = await collect(provider, s, "10.00", true);
    expect(r.state).toBe("network_unavailable");
  });

  it("returns network_unavailable over the cap", async () => {
    const s = await seedTenant();
    await seedTenant();
    await seedPaymentPolicy(suite.db, "accept_offline", "50.00");
    const provider = new FakePaymentProvider(suite.db);
    provider.offlineNextCollect();
    const r = await collect(provider, s, "50.01", true);
    expect(r.state).toBe("network_unavailable");
  });

  it("offlineNextCollect is one-shot — the next collect is a normal online capture", async () => {
    const s = await seedTenant();
    await seedTenant();
    await seedPaymentPolicy(suite.db, "accept_offline", "50.00");
    const provider = new FakePaymentProvider(suite.db);
    provider.offlineNextCollect();
    await collect(provider, s, "10.00", true);
    const online = await collect(provider, s, "10.00", true);
    expect(online.state).toBe("captured");
  });
});

async function acceptOfflineAndAssociate(
  provider: FakePaymentProvider,
  s: Seeded,
  amount = "10.00",
): Promise<string> {
  provider.offlineNextCollect();
  const r = await collect(provider, s, amount, true);
  const saleId = await seedSale(suite.db, s);
  await suite.db.transaction((tx) =>
    associatePaymentWithSale(tx, {
      provider: "fake",
      paymentRef: r.paymentRef,
      saleId,
    }),
  );
  return r.paymentRef;
}

describe("FakePaymentProvider.forward", () => {
  it("settles an accepted_offline payment the network clears", async () => {
    const s = await seedTenant();
    await seedTenant();
    await seedPaymentPolicy(suite.db, "accept_offline", "50.00");
    const provider = new FakePaymentProvider(suite.db);
    const ref = await acceptOfflineAndAssociate(provider, s);
    const result = await provider.forward(new Date());
    expect(result).toMatchObject({
      forwarded: 1,
      declined: 0,
      incidentsRaised: 0,
      nextDueAt: null,
    });
    const row = await suite.db.transaction((tx) => findPaymentByRef(tx, "fake", ref));
    expect(row?.state).toBe("settled");
  });

  it("declines a payment the network refuses, raising one incident, without touching the sale", async () => {
    const s = await seedTenant();
    await seedTenant();
    await seedPaymentPolicy(suite.db, "accept_offline", "50.00");
    const provider = new FakePaymentProvider(suite.db);
    const ref = await acceptOfflineAndAssociate(provider, s);
    provider.declineForwardFor(ref);
    const result = await provider.forward(new Date());
    expect(result).toMatchObject({ forwarded: 0, declined: 1, incidentsRaised: 1 });
    const row = await suite.db.transaction((tx) => findPaymentByRef(tx, "fake", ref));
    expect(row?.state).toBe("declined");
    const incidents = await suite.db.transaction((tx) => openIncidents(tx, brandTillId(s.tillId)));
    expect(incidents).toHaveLength(1);
    expect(incidents[0].code).toBe("payment.offline_forward_declined");
  });

  it("is idempotent — a second forward advances nothing and raises no duplicate incident", async () => {
    const s = await seedTenant();
    await seedTenant();
    await seedPaymentPolicy(suite.db, "accept_offline", "50.00");
    const provider = new FakePaymentProvider(suite.db);
    const ref = await acceptOfflineAndAssociate(provider, s);
    provider.declineForwardFor(ref);
    await provider.forward(new Date());
    const second = await provider.forward(new Date());
    expect(second).toMatchObject({ forwarded: 0, declined: 0, incidentsRaised: 0 });
    const incidents = await suite.db.transaction((tx) => openIncidents(tx, brandTillId(s.tillId)));
    expect(incidents).toHaveLength(1);
  });

  it("returns all-zeros when there is nothing to forward", async () => {
    await seedTenant();
    const provider = new FakePaymentProvider(suite.db);
    const result = await provider.forward(new Date());
    expect(result).toEqual({ nextDueAt: null, forwarded: 0, declined: 0, incidentsRaised: 0 });
  });

  it("resolvePending is all-zeros (the fake's collect resolves in one transaction)", async () => {
    await seedTenant();
    const provider = new FakePaymentProvider(suite.db);
    await expect(provider.resolvePending(new Date())).resolves.toEqual({
      nextDueAt: null,
      forwarded: 0,
      declined: 0,
      incidentsRaised: 0,
    });
  });
});

describe("FakePaymentProvider.resolveAbandonedAttempt", () => {
  const NOW = new Date("2026-09-26T12:00:00Z");
  const MANAGER = "22222222-2222-4222-8222-222222222222";
  const AUDIT = { personId: MANAGER };

  async function abandoned(paymentRef: string): Promise<void> {
    const s = await seedTenant();
    await suite.db.transaction((tx) =>
      insertAttempting(tx, {
        origin: deviceOrigin(s.deviceId),
        workingOrderId: s.workingOrderId,
        provider: "fake",
        paymentRef,
        amount: decimal("10.00"),
      }),
    );
  }
  const rowOf = (paymentRef: string) =>
    suite.db.transaction((tx) => getPaymentByRef(tx, { provider: "fake", paymentRef }));

  it("unscripted, answers unknown/unreachable and leaves the row attempting", async () => {
    await abandoned("ab-1");
    const provider = new FakePaymentProvider(suite.db);
    expect(await provider.resolveAbandonedAttempt("ab-1", NOW, AUDIT)).toEqual({
      outcome: "unknown",
      reason: "unreachable",
    });
    expect((await rowOf("ab-1"))?.state).toBe("attempting");
    expect(provider.abandonedAttemptCalls).toEqual([{ paymentRef: "ab-1", now: NOW }]);
  });

  it("scripted captured, captures the row at `now` with a processor reference", async () => {
    await abandoned("ab-2");
    const provider = new FakePaymentProvider(suite.db);
    provider.scriptAbandonedAttempt({ outcome: "captured" });
    expect(await provider.resolveAbandonedAttempt("ab-2", NOW, AUDIT)).toEqual({
      outcome: "captured",
    });
    const row = await rowOf("ab-2");
    expect(row?.state).toBe("captured");
    expect(row?.settledAt).toBe(NOW.toISOString());
    expect(row?.externalRef).toBe("fake-ext-ab-2");
  });

  it("scripted failed, fails the row and echoes whether the provider cancelled", async () => {
    await abandoned("ab-3");
    const provider = new FakePaymentProvider(suite.db);
    provider.scriptAbandonedAttempt({ outcome: "failed", cancelledAtProvider: true });
    expect(await provider.resolveAbandonedAttempt("ab-3", NOW, AUDIT)).toEqual({
      outcome: "failed",
      cancelledAtProvider: true,
    });
    expect((await rowOf("ab-3"))?.state).toBe("failed");
  });

  it("scripted unknown, echoes the reason and status and leaves the row attempting", async () => {
    await abandoned("ab-4");
    const provider = new FakePaymentProvider(suite.db);
    provider.scriptAbandonedAttempt({
      outcome: "unknown",
      reason: "ambiguous",
      providerStatus: "processing",
    });
    expect(await provider.resolveAbandonedAttempt("ab-4", NOW, AUDIT)).toEqual({
      outcome: "unknown",
      reason: "ambiguous",
      providerStatus: "processing",
    });
    expect((await rowOf("ab-4"))?.state).toBe("attempting");
  });

  function resolutionsOf(paymentRef: string) {
    return suite.db.execute<Record<string, unknown>>(
      sql`select r.person_id, r.outcome, r.cancelled_at_provider, r.provider_status, r.resolved_at
            from payment_resolutions r join payments p on p.id = r.payment_id
           where p.provider = 'fake' and p.payment_ref = ${paymentRef}`,
    );
  }

  it.each([
    {
      answer: { outcome: "captured" as const },
      recorded: { outcome: "captured", cancelled_at_provider: 0 },
    },
    {
      answer: { outcome: "failed" as const, cancelledAtProvider: true },
      recorded: { outcome: "failed", cancelled_at_provider: 1 },
    },
  ])("scripted $answer.outcome, records who resolved it", async ({ answer, recorded }) => {
    const ref = `ab-audit-${answer.outcome}`;
    await abandoned(ref);
    const provider = new FakePaymentProvider(suite.db);
    provider.scriptAbandonedAttempt(answer);
    await provider.resolveAbandonedAttempt(ref, NOW, AUDIT);
    expect((await resolutionsOf(ref)).rows).toEqual([
      { person_id: MANAGER, provider_status: null, resolved_at: NOW.toISOString(), ...recorded },
    ]);
  });

  it("scripted unknown, records nothing", async () => {
    await abandoned("ab-audit-unknown");
    const provider = new FakePaymentProvider(suite.db);
    await provider.resolveAbandonedAttempt("ab-audit-unknown", NOW, AUDIT);
    expect((await resolutionsOf("ab-audit-unknown")).rows).toEqual([]);
  });

  it.each([
    { outcome: "captured" as const },
    { outcome: "failed" as const, cancelledAtProvider: true },
  ])(
    "scripted $outcome: when the resolution cannot be recorded, the row stays attempting",
    async (answer) => {
      const ref = `ab-probe-${answer.outcome}`;
      await abandoned(ref);
      const provider = new FakePaymentProvider(suite.db);
      provider.scriptAbandonedAttempt(answer);
      await suite.db.execute(
        sql`create trigger refuse_resolutions before insert on payment_resolutions
          begin select raise(abort, 'probe: resolution refused'); end`,
      );
      try {
        await expect(provider.resolveAbandonedAttempt(ref, NOW, AUDIT)).rejects.toThrow(
          /probe: resolution refused/,
        );
      } finally {
        await suite.db.execute(sql`drop trigger refuse_resolutions`);
      }
      expect((await rowOf(ref))?.state).toBe("attempting");
    },
  );

  it("refuses payment.not_found for a row that is no longer attempting", async () => {
    await abandoned("ab-5");
    const provider = new FakePaymentProvider(suite.db);
    provider.scriptAbandonedAttempt({ outcome: "failed", cancelledAtProvider: false });
    await provider.resolveAbandonedAttempt("ab-5", NOW, AUDIT);
    const error = await provider
      .resolveAbandonedAttempt("ab-5", NOW, AUDIT)
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(AppError);
    expect((error as AppError).code).toBe("payment.not_found");
  });
});

describe("FakePaymentProvider.sendRefund and lookupRefund", () => {
  const send = (refundId: string, key = `bpr_${refundId}`, amount = "4.00") => ({
    processorRef: "fake-ext-1",
    amount: decimal(amount),
    idempotencyKey: key,
    refundId,
  });
  const query = (refundId: string, amount = "4.00") => ({
    processorRef: "fake-ext-1",
    refundId,
    amount: decimal(amount),
    sentAt: new Date("2026-09-27T10:00:00Z"),
    excludeRefs: [],
  });

  it("refunds by default, answering the refund's own outcome, and records the call", async () => {
    const provider = new FakePaymentProvider(suite.db);

    const answer = await provider.sendRefund(send("r-1"));

    expect(answer).toEqual({
      kind: "outcome",
      outcome: "completed",
      providerRefundRef: expect.stringMatching(/^fake-re-/) as unknown as string,
      providerStatus: "succeeded",
    });
    expect(provider.refundCalls).toEqual([send("r-1")]);
    expect(await provider.lookupRefund(query("r-1"))).toEqual({
      kind: "match",
      providerRefundRef: (answer as { providerRefundRef: string }).providerRefundRef,
      outcome: "completed",
      providerStatus: "succeeded",
    });
  });

  it("answers a resend with the same key with the first refund, making no second one", async () => {
    const provider = new FakePaymentProvider(suite.db);

    const first = await provider.sendRefund(send("r-2"));
    const again = await provider.sendRefund(send("r-2"));

    expect(again).toEqual(first);
    expect(provider.refundCalls).toHaveLength(2);
    expect((await provider.lookupRefund(query("r-2"))).kind).toBe("match");
  });

  it("finds nothing for a refund it was never asked for", async () => {
    const provider = new FakePaymentProvider(suite.db);
    expect(await provider.lookupRefund(query("r-none"))).toEqual({ kind: "none" });
    expect(provider.lookupCalls).toEqual([query("r-none")]);
  });

  it("scriptNextRefund answers as told, once, and makes the refund only when told to", async () => {
    const provider = new FakePaymentProvider(suite.db);
    provider.scriptNextRefund({
      made: "completed",
      answer: { kind: "uncertain", reason: "timeout" },
    });

    const lost = await provider.sendRefund(send("r-3"));
    const next = await provider.sendRefund(send("r-4"));
    provider.scriptNextRefund({
      made: false,
      answer: { kind: "refused", httpStatus: 400, documented: true },
    });
    const refused = await provider.sendRefund(send("r-5"));

    expect(lost).toEqual({ kind: "uncertain", reason: "timeout" });
    expect((await provider.lookupRefund(query("r-3"))).kind).toBe("match");
    expect(next.kind).toBe("outcome");
    expect(refused).toEqual({ kind: "refused", httpStatus: 400, documented: true });
    expect(await provider.lookupRefund(query("r-5"))).toEqual({ kind: "none" });
  });

  it("scriptNextRefund can make a refund in another state, and throw after making it", async () => {
    const provider = new FakePaymentProvider(suite.db);
    provider.scriptNextRefund({ made: "failed", status: "canceled", answer: "made" });
    const failed = await provider.sendRefund(send("r-6"));
    provider.scriptNextRefund({ made: "completed", answer: "throw" });

    await expect(provider.sendRefund(send("r-7"))).rejects.toThrow(/stopped/);
    expect(failed).toMatchObject({
      kind: "outcome",
      outcome: "failed",
      providerStatus: "canceled",
    });
    expect(await provider.lookupRefund(query("r-7"))).toMatchObject({
      kind: "match",
      outcome: "completed",
    });
  });

  it("scriptLookups answers every lookup as told until cleared", async () => {
    const provider = new FakePaymentProvider(suite.db);
    await provider.sendRefund(send("r-8"));
    provider.scriptLookups({ kind: "ambiguous", candidates: 2 });

    const scripted = [
      await provider.lookupRefund(query("r-8")),
      await provider.lookupRefund(query("r-8")),
    ];
    provider.scriptLookups(null);

    expect(scripted).toEqual([
      { kind: "ambiguous", candidates: 2 },
      { kind: "ambiguous", candidates: 2 },
    ]);
    expect((await provider.lookupRefund(query("r-8"))).kind).toBe("match");
  });

  it("holdNextRefund waits, having recorded the call, until released", async () => {
    const provider = new FakePaymentProvider(suite.db);
    const release = provider.holdNextRefund();

    const pending = provider.sendRefund(send("r-9"));
    await vi.waitFor(() => expect(provider.refundCalls).toHaveLength(1));
    const during = await provider.lookupRefund(query("r-9"));
    release();

    expect(during).toEqual({ kind: "none" });
    expect((await pending).kind).toBe("outcome");
  });

  it("resends safely for a day by default, and can be told otherwise", () => {
    const provider = new FakePaymentProvider(suite.db);
    expect(provider.refundResendWindowMs).toBe(24 * 60 * 60 * 1000);
    provider.refundResendWindowMs = null;
    expect(provider.refundResendWindowMs).toBeNull();
  });
});
