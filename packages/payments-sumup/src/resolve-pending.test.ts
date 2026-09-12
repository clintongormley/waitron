import { describe, expect, it } from "vitest";
import { CORE_MIGRATIONS, withTenant } from "@waitron/db";
import { usePgliteDb } from "@waitron/db/testing/lifecycle.js";
import { AppError, decimal, tenantId as brandTenantId } from "@waitron/shared";
import {
  PAYMENTS_MIGRATIONS,
  getPaymentByRef,
  insertAttempting,
  stampAttemptingRef,
} from "@waitron/payments";
import type { IncidentSink } from "@waitron/payments";
import { freshNif, seedWorkingOrder } from "@waitron/payments/test/seed.js";
import { FakeSumUp } from "./testing/fake-sumup.js";
import { NOT_FOUND_GRACE_MS, RESOLVE_RETRY_MS, SumUpCloudProvider } from "./provider.js";

// PGlite — the sweep's logic. The grant/tenant questions are sumup.test.ts's (real PG).
const suite = usePgliteDb({
  migrations: [CORE_MIGRATIONS, PAYMENTS_MIGRATIONS],
  timeoutMs: 60_000,
});
const T0 = new Date("2026-09-11T10:00:00Z");

async function setup() {
  const t = await seedWorkingOrder(suite.db, freshNif());
  const fake = new FakeSumUp();
  const raised: Parameters<IncidentSink>[1][] = [];
  const incidents: IncidentSink = (_tx, input) => {
    raised.push(input);
    return Promise.resolve(true);
  };
  const provider = new SumUpCloudProvider({
    client: fake,
    db: suite.db,
    tenantId: brandTenantId(t.tenantId),
    nodeId: "11111111-1111-4111-8111-111111111111",
    incidents,
    poll: { maxAttempts: 1, intervalMs: 0, sleep: () => Promise.resolve() },
    now: () => T0,
  });
  /** An attempting row as `collect` leaves one after a timeout: T1 + T1.5 done, poll key stamped. */
  const attempting = async (
    paymentRef: string,
    opts: { stamped?: boolean; status?: string } = {},
  ) => {
    await withTenant(suite.db, t.tenantId, (tx) =>
      insertAttempting(tx, {
        tenantId: t.tenantId,
        workingOrderId: t.workingOrderId,
        provider: "sumup",
        paymentRef,
        amount: decimal("7.00"),
      }),
    );
    const ctx = fake.hold({
      foreignTransactionId: paymentRef,
      status: opts.status ?? "PENDING",
      amount: decimal("7.00"),
    });
    if (opts.stamped !== false)
      await withTenant(suite.db, t.tenantId, (tx) =>
        stampAttemptingRef(tx, { tenantId: t.tenantId, provider: "sumup", paymentRef }, ctx),
      );
    return ctx;
  };
  const state = async (ref: string) => {
    const r = await withTenant(suite.db, t.tenantId, (tx) =>
      getPaymentByRef(tx, { tenantId: t.tenantId, provider: "sumup", paymentRef: ref }),
    );
    if (r === undefined) throw new Error(`no payments row for ref ${ref}`);
    return r;
  };
  return { t, fake, provider, raised, attempting, state };
}

describe("SumUpCloudProvider.resolvePending", () => {
  it("captures a row SumUp now reports SUCCESSFUL, stamping the refundable transaction id", async () => {
    const { provider, attempting, state } = await setup();
    await attempting("a", { status: "SUCCESSFUL" });
    const r = await provider.resolvePending(T0);
    expect(r).toEqual({ nextDueAt: null, forwarded: 1, declined: 0, incidentsRaised: 0 });
    const row = await state("a");
    expect(row.state).toBe("captured");
    expect(row.externalRef).toMatch(/^txn_/);
    expect(row.settledAt).not.toBeNull();
  });

  it("carries the card block onto the payments row it captures", async () => {
    const { provider, attempting, state } = await setup();
    await attempting("card", { status: "SUCCESSFUL" });
    expect((await provider.resolvePending(T0)).forwarded).toBe(1);
    const row = await state("card");
    expect(row.state).toBe("captured");
    expect(row.cardScheme).toBe("VISA");
    expect(row.cardLast4).toBe("5838");
    expect(row.cardEntryMode).toBe("contactless");
    expect(row.cardAuthCode).toBe("328600");
  });

  it("fails a row SumUp reports FAILED or CANCELLED, no incident", async () => {
    const { provider, attempting, state } = await setup();
    await attempting("f", { status: "FAILED" });
    await attempting("c", { status: "CANCELLED" });
    expect(await provider.resolvePending(T0)).toEqual({
      nextDueAt: null,
      forwarded: 0,
      declined: 2,
      incidentsRaised: 0,
    });
    expect((await state("f")).state).toBe("failed");
    expect((await state("c")).state).toBe("failed");
  });

  it("leaves a still-PENDING row alone and asks to be run again in RESOLVE_RETRY_MS", async () => {
    const { provider, attempting, state } = await setup();
    await attempting("p");
    expect(await provider.resolvePending(T0)).toEqual({
      nextDueAt: new Date(T0.getTime() + RESOLVE_RETRY_MS),
      forwarded: 0,
      declined: 0,
      incidentsRaised: 0,
    });
    expect((await state("p")).state).toBe("attempting");
  });

  it("finds a crash-before-stamp row by OUR key (foreign_transaction_id) and resolves it", async () => {
    const { provider, attempting, state } = await setup();
    await attempting("u", { stamped: false, status: "SUCCESSFUL" });
    expect((await provider.resolvePending(T0)).forwarded).toBe(1);
    expect((await state("u")).state).toBe("captured");
  });

  it("a row SumUp holds nothing for is pending inside the grace period, then failed WITH an incident after it", async () => {
    const { t, provider, state, raised } = await setup();
    await withTenant(suite.db, t.tenantId, (tx) =>
      insertAttempting(tx, {
        tenantId: t.tenantId,
        workingOrderId: t.workingOrderId,
        provider: "sumup",
        paymentRef: "ghost",
        amount: decimal("7.00"),
      }),
    );
    // created_at is the DB's now(); swept at ~that same instant the row is inside the grace window,
    // so a not-found is deferred, not failed. (A fixed future `now` would be wall-clock-dependent —
    // past created_at+grace whenever the suite ran before it — so the sweep time is taken live.)
    expect((await provider.resolvePending(new Date())).nextDueAt).not.toBeNull();
    expect((await state("ghost")).state).toBe("attempting");
    expect(raised).toHaveLength(0);
    // …and past created_at + grace the row is failed AND surfaced: a not-found we could not correlate
    // is an uncertain charge, not a proven non-event, so the sweep raises the same unactionable
    // incident (status "not_found") rather than concealing a possible charge.
    const later = new Date(Date.now() + NOT_FOUND_GRACE_MS + 1000);
    expect(await provider.resolvePending(later)).toMatchObject({ declined: 1, incidentsRaised: 1 });
    expect((await state("ghost")).state).toBe("failed");
    expect(raised).toHaveLength(1);
    expect(raised[0]).toMatchObject({ tenantId: t.tenantId, tillId: t.tillId, severity: "error" });
    expect(raised[0]!.error.code).toBe("payment.pending_outcome_unactionable");
    expect(raised[0]!.error.params).toEqual({ paymentRef: "ghost", status: "not_found" });
  });

  it("REFUNDED resolves failed WITH a payment.pending_outcome_unactionable incident naming the till", async () => {
    const { t, provider, attempting, state, raised } = await setup();
    await attempting("r", { status: "REFUNDED" });
    expect(await provider.resolvePending(T0)).toMatchObject({ declined: 1, incidentsRaised: 1 });
    expect((await state("r")).state).toBe("failed");
    expect(raised).toHaveLength(1);
    // toEqual (not toMatchObject) so the incident input's FULL key set is pinned — in particular that
    // no `saleId` is passed (an attempting row has no sale; §4: toMatchObject checks only listed keys).
    expect(raised[0]).toEqual({
      tenantId: t.tenantId,
      tillId: t.tillId,
      error: expect.any(AppError),
      severity: "error",
      detectedAt: T0,
    });
    expect(raised[0]!.error.code).toBe("payment.pending_outcome_unactionable");
    expect(raised[0]!.error.params).toEqual({ paymentRef: "r", status: "REFUNDED" });
  });

  it("an unknown status resolves failed with an incident naming the value", async () => {
    const { provider, attempting, raised } = await setup();
    await attempting("x", { status: "CHARGE_BACK" });
    expect(await provider.resolvePending(T0)).toMatchObject({ declined: 1, incidentsRaised: 1 });
    expect(raised[0]!.error.params).toEqual({ paymentRef: "x", status: "CHARGE_BACK" });
  });

  it("a network error on one row defers that row and still resolves the others", async () => {
    const { fake, provider, attempting, state } = await setup();
    await attempting("first", { status: "SUCCESSFUL" });
    await attempting("second", { status: "SUCCESSFUL" });
    fake.throwOnFindNext();
    const r = await provider.resolvePending(T0);
    expect(r.forwarded).toBe(1);
    expect(r.nextDueAt).not.toBeNull();
    const states = [(await state("first")).state, (await state("second")).state].sort();
    expect(states).toEqual(["attempting", "captured"]);
  });

  it("an empty sweep is all-zeros", async () => {
    const { provider } = await setup();
    expect(await provider.resolvePending(T0)).toEqual({
      nextDueAt: null,
      forwarded: 0,
      declined: 0,
      incidentsRaised: 0,
    });
  });
});
