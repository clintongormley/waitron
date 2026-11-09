import { paymentRefunds } from "@waitron/payments/src/schema/payment-refunds.js";
import { captureAlerts } from "@waitron/payments/test/capture-alerts.js";
import { eq } from "drizzle-orm";
import { sumupClient } from "./sumup-client.js";
import { describe, expect, it, vi } from "vitest";
import { CORE_MIGRATIONS, withTransaction } from "@waitron/db";
import { seedNode } from "@waitron/db/testing/seed.js";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { AppError, decimal, deviceOrigin, jobOrigin } from "@waitron/shared";
import {
  PAYMENTS_MIGRATIONS,
  payments,
  getPaymentByRef,
  failAttempting,
  insertAttempting,
  stampAttemptingRef,
} from "@waitron/payments";
import type { IncidentSink } from "@waitron/payments";
import { freshNif, ownsEveryPayment, seedWorkingOrder } from "@waitron/payments/test/seed.js";
import { FakeSumUp } from "./testing/fake-sumup.js";
import { NOT_FOUND_GRACE_MS, RESOLVE_RETRY_MS, SumUpCloudProvider } from "./provider.js";

const suite = useVenueDb({
  migrations: [CORE_MIGRATIONS, PAYMENTS_MIGRATIONS],
  timeoutMs: 60_000,
});
const T0 = new Date("2026-09-11T10:00:00Z");

async function setup(incidentRecorded = true) {
  const t = await seedWorkingOrder(suite.db, freshNif());
  const fake = new FakeSumUp();
  const raised: Parameters<IncidentSink>[1][] = [];
  const incidents: IncidentSink = (_tx, input) => {
    raised.push(input);
    return Promise.resolve(incidentRecorded);
  };
  const provider = new SumUpCloudProvider({
    captureAlerts,
    client: fake,
    db: suite.db,
    incidents,
    poll: { maxAttempts: 1, intervalMs: 0, sleep: () => Promise.resolve() },
    now: () => T0,
  });
  /** An attempting row as `collect` leaves one after a timeout: T1 + T1.5 done, poll key stamped. */
  const attempting = async (
    paymentRef: string,
    opts: { stamped?: boolean; status?: string } = {},
  ) => {
    await withTransaction(suite.db, (tx) =>
      insertAttempting(tx, {
        origin: deviceOrigin(t.deviceId),
        workingOrderId: t.workingOrderId,
        nodeId: t.nodeId,
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
      await withTransaction(suite.db, (tx) =>
        stampAttemptingRef(tx, { provider: "sumup", paymentRef }, ctx),
      );
    return ctx;
  };
  const state = async (ref: string) => {
    const r = await withTransaction(suite.db, (tx) =>
      getPaymentByRef(tx, { provider: "sumup", paymentRef: ref }),
    );
    if (r === undefined) throw new Error(`no payments row for ref ${ref}`);
    return r;
  };
  return { t, fake, provider, raised, attempting, state };
}

describe("SumUpCloudProvider.resolvePending", () => {
  it.each([
    { refund: 7, want: "refunded", net: 0 },
    { refund: 2, want: "partially_refunded", net: 500 },
  ])(
    "recovers gross and identified refunds atomically ($want), including replay",
    async ({ refund, want, net }) => {
      const { t, attempting, state, raised } = await setup();
      await attempting("refunded-charge");
      const requests: string[] = [];
      const event = { id: 123, status: "REFUNDED", amount: refund, timestamp: T0.toISOString() };
      const client = sumupClient({
        apiKey: "k",
        merchantCode: "M",
        fetch: async (_url, init) => {
          requests.push(init?.method ?? "GET");
          return Response.json({
            id: "txn_refunded",
            status: "SUCCESSFUL",
            amount: 7,
            transaction_events: [{ ...event, event_type: "REFUND" }],
            events: [{ ...event, type: "REFUND" }],
          });
        },
      });
      const provider = new SumUpCloudProvider({
        client,
        db: suite.db,
        captureAlerts,
        incidents: async (_tx, input) => {
          raised.push(input);
          return true;
        },
      });
      const owners = { nodeId: t.nodeId, takenOverFrom: [], unowned: false };
      await Promise.all([provider.resolvePending(T0, owners), provider.resolvePending(T0, owners)]);
      await provider.resolvePending(T0, owners);
      const saved = await state("refunded-charge");
      expect(saved).toMatchObject({
        state: want,
        amount: decimal("7.00"),
        externalRef: "txn_refunded",
      });
      const [gross] = await suite.db
        .select({ amount: payments.amount, requested: payments.requestedAmount })
        .from(payments)
        .where(eq(payments.id, saved.id));
      const refunds = await suite.db
        .select({
          amount: paymentRefunds.amount,
          state: paymentRefunds.state,
          ref: paymentRefunds.providerRefundRef,
        })
        .from(paymentRefunds)
        .where(eq(paymentRefunds.paymentId, saved.id));
      expect(gross).toEqual({ amount: 700, requested: 700 });
      expect(refunds).toEqual([{ amount: refund * 100, state: "succeeded", ref: "123" }]);
      expect(gross!.amount - refunds[0]!.amount).toBe(net);
      expect(raised.map((i) => i.error.params)).toEqual([
        {
          paymentRef: "refunded-charge",
          status: want === "refunded" ? "refund_completed" : "partial_refund",
        },
      ]);
      expect(requests.every((method) => method === "GET")).toBe(true);
    },
  );

  it.each([
    { events: [{ id: 1, status: "PENDING", amount: 2 }], want: "attempting" },
    { events: [{ id: 1, status: "UNKNOWN", amount: 2 }], want: "attempting" },
    { events: [{ id: 1, status: "REFUNDED" }], want: "attempting" },
    { events: [{ id: 1, status: "REFUNDED", amount: 8 }], want: "attempting" },
    { events: [{ id: 1, status: "REFUNDED", amount: 0 }], want: "attempting" },
    {
      events: [
        { id: 1, status: "REFUNDED", amount: 2 },
        { id: 1, status: "REFUNDED", amount: 3 },
      ],
      want: "attempting",
    },
    { events: [{ id: 1, status: "FAILED", amount: 2 }], want: "captured" },
  ])("keeps uncertain refund evidence for recheck: $events", async ({ events, want }) => {
    const { provider, fake, attempting, state } = await setup();
    await attempting("uncertain-refund");
    const wire = sumupClient({
      apiKey: "k",
      merchantCode: "M",
      fetch: async () =>
        Response.json({
          id: "txn",
          status: "SUCCESSFUL",
          amount: 7,
          events: events.map((e) => ({ ...e, type: "REFUND", timestamp: T0.toISOString() })),
        }),
    });
    vi.spyOn(fake, "findTransaction").mockImplementation((q) => wire.findTransaction(q));
    const result = await provider.resolvePending(T0, await ownsEveryPayment(suite.db));
    expect((await state("uncertain-refund")).state).toBe(want);
    expect(result.nextDueAt).toEqual(
      want === "attempting" ? new Date(T0.getTime() + RESOLVE_RETRY_MS) : null,
    );
    if (want === "attempting") {
      vi.spyOn(fake, "findTransaction").mockResolvedValue({
        id: "txn",
        status: "SUCCESSFUL",
        amount: decimal("7.00"),
        refundEvents: [
          { id: "1", status: "FAILED", amount: decimal("2.00"), timestamp: T0.toISOString() },
        ],
      });
      await provider.resolvePending(T0, await ownsEveryPayment(suite.db));
      expect((await state("uncertain-refund")).state).toBe("captured");
    }
  });

  it("rolls the gross capture and refund back together if the refund incident cannot be saved", async () => {
    const { fake, attempting, state } = await setup();
    await attempting("refund-rollback");
    vi.spyOn(fake, "findTransaction").mockResolvedValue({
      id: "txn",
      status: "SUCCESSFUL",
      amount: decimal("7.00"),
      refundEvents: [
        { id: "refund", status: "REFUNDED", amount: decimal("2.00"), timestamp: T0.toISOString() },
      ],
    });
    const failure = new Error("incident save failed");
    const provider = new SumUpCloudProvider({
      client: fake,
      db: suite.db,
      captureAlerts,
      incidents: async () => {
        throw failure;
      },
    });
    await expect(provider.resolvePending(T0, await ownsEveryPayment(suite.db))).rejects.toBe(
      failure,
    );
    expect((await state("refund-rollback")).state).toBe("attempting");
    expect(await suite.db.select().from(paymentRefunds)).toEqual([]);
  });

  it.each([true, false])(
    "alerts a capture that lost to a contradictory failure and continues, incident recorded %s",
    async (recorded) => {
      const { fake, provider, attempting, state, raised } = await setup(recorded);
      const checkout = await attempting("contradicting", { status: "SUCCESSFUL" });
      await attempting("later", { status: "SUCCESSFUL" });
      const find = fake.findTransaction.bind(fake);
      let changed = false;
      vi.spyOn(fake, "findTransaction").mockImplementation(async (query) => {
        const answer = await find(query);
        if (!changed && "clientTransactionId" in query && query.clientTransactionId === checkout) {
          changed = true;
          await withTransaction(suite.db, (tx) =>
            failAttempting(tx, { provider: "sumup", paymentRef: "contradicting" }),
          );
        }
        return answer;
      });

      const result = await provider.resolvePending(T0, await ownsEveryPayment(suite.db));

      expect(result).toEqual({
        nextDueAt: null,
        forwarded: 1,
        declined: 0,
        incidentsRaised: recorded ? 1 : 0,
      });
      expect((await state("contradicting")).state).toBe("failed");
      expect((await state("later")).state).toBe("captured");
      expect(raised).toHaveLength(1);
      expect(raised[0]).toMatchObject({
        error: {
          code: "payment.pending_outcome_unactionable",
          params: { paymentRef: "contradicting", status: "SUCCESSFUL" },
        },
      });
    },
  );

  it.each([
    { label: "ordinary error", failure: new Error("incident storage failed") },
    {
      label: "the current payment's refusal from incident storage",
      failure: new AppError("payment.not_found", { provider: "sumup", paymentRef: "unrelated" }),
    },
    {
      label: "another domain refusal",
      failure: new AppError("management.request_invalid", { field: "incident" }),
    },
    {
      label: "another provider's refusal",
      failure: new AppError("payment.not_found", {
        provider: "another-provider",
        paymentRef: "unrelated",
      }),
    },
    {
      label: "another payment's refusal",
      failure: new AppError("payment.not_found", {
        provider: "sumup",
        paymentRef: "another-payment",
      }),
    },
  ])(
    "propagates $label from incident storage and leaves the row attempting",
    async ({ failure }) => {
      const { fake, attempting, state } = await setup();
      await attempting("unrelated", { status: "REFUNDED" });
      const provider = new SumUpCloudProvider({
        captureAlerts,
        client: fake,
        db: suite.db,
        incidents: () => Promise.reject(failure),
      });
      await expect(provider.resolvePending(T0, await ownsEveryPayment(suite.db))).rejects.toBe(
        failure,
      );
      expect((await state("unrelated")).state).toBe("attempting");
    },
  );

  it.each(["SUCCESSFUL", "FAILED", "REFUNDED", "missing"])(
    "concurrent passes skip rows already resolved for %s and finish the later rows",
    async (status) => {
      const { fake, provider, attempting, state, raised } = await setup();
      await attempting("race-a", { status });
      await attempting("race-b", { status });
      const find = fake.findTransaction.bind(fake);
      let entered = 0;
      let release!: () => void;
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      vi.spyOn(fake, "findTransaction").mockImplementation(async (query) => {
        entered += 1;
        if (entered === 2) release();
        await gate;
        return status === "missing" ? null : find(query);
      });
      const now = new Date(Date.now() + NOT_FOUND_GRACE_MS + 1);
      const owners = await ownsEveryPayment(suite.db);

      const results = await Promise.allSettled([
        provider.resolvePending(now, owners),
        provider.resolvePending(now, owners),
      ]);

      expect(results.map((result) => result.status)).toEqual(["fulfilled", "fulfilled"]);
      const passes = results.flatMap((result) =>
        result.status === "fulfilled" ? [result.value] : [],
      );
      expect(passes.reduce((sum, pass) => sum + pass.forwarded, 0)).toBe(
        status === "SUCCESSFUL" ? 2 : 0,
      );
      expect(passes.reduce((sum, pass) => sum + pass.declined, 0)).toBe(
        status === "SUCCESSFUL" || status === "REFUNDED" ? 0 : 2,
      );
      expect(passes.map((pass) => pass.nextDueAt)).toEqual(
        status === "REFUNDED"
          ? [new Date(now.getTime() + RESOLVE_RETRY_MS), new Date(now.getTime() + RESOLVE_RETRY_MS)]
          : [null, null],
      );
      expect([(await state("race-a")).state, (await state("race-b")).state]).toEqual(
        status === "SUCCESSFUL"
          ? ["captured", "captured"]
          : status === "REFUNDED"
            ? ["attempting", "attempting"]
            : ["failed", "failed"],
      );
      expect(raised).toHaveLength(status === "REFUNDED" ? 4 : status === "missing" ? 2 : 0);
    },
  );

  it("captures a row SumUp now reports SUCCESSFUL, stamping the refundable transaction id", async () => {
    const { provider, attempting, state } = await setup();
    await attempting("a", { status: "SUCCESSFUL" });
    const r = await provider.resolvePending(T0, await ownsEveryPayment(suite.db));
    expect(r).toEqual({ nextDueAt: null, forwarded: 1, declined: 0, incidentsRaised: 0 });
    const row = await state("a");
    expect(row.state).toBe("captured");
    expect(row.externalRef).toMatch(/^txn_/);
    expect(row.settledAt).not.toBeNull();
  });

  it("leaves an attempting row another box owns alone, and its own box captures it", async () => {
    const { t, provider, attempting, state } = await setup();
    await attempting("theirs", { status: "SUCCESSFUL" });
    const otherBox = await seedNode(suite.db);
    expect(
      await provider.resolvePending(T0, { nodeId: otherBox, takenOverFrom: [], unowned: true }),
    ).toEqual({ nextDueAt: null, forwarded: 0, declined: 0, incidentsRaised: 0 });
    expect((await state("theirs")).state).toBe("attempting");
    expect(
      (await provider.resolvePending(T0, { nodeId: t.nodeId, takenOverFrom: [], unowned: false }))
        .forwarded,
    ).toBe(1);
  });

  it.each([
    { signalled: true, settled: 1 },
    { signalled: false, settled: 2 },
  ])(
    "a signal raised after the first payment settles no second (signalled: $signalled)",
    async ({ signalled, settled }) => {
      const { fake, provider, attempting, state } = await setup();
      await attempting("first", { status: "SUCCESSFUL" });
      await attempting("second", { status: "SUCCESSFUL" });
      const controller = new AbortController();
      const find = fake.findTransaction.bind(fake);
      const reads = vi.spyOn(fake, "findTransaction").mockImplementation(async (query) => {
        controller.abort();
        return find(query);
      });
      const sweep = await provider.resolvePending(
        T0,
        await ownsEveryPayment(suite.db),
        signalled ? controller.signal : undefined,
      );
      expect(sweep.forwarded).toBe(settled);
      expect(reads).toHaveBeenCalledTimes(settled);
      expect((await state("first")).state).toBe("captured");
      expect((await state("second")).state).toBe(signalled ? "attempting" : "captured");
      expect(sweep.nextDueAt).toEqual(signalled ? new Date(T0.getTime() + RESOLVE_RETRY_MS) : null);
    },
  );

  it("carries the card block onto the payments row it captures", async () => {
    const { provider, attempting, state } = await setup();
    await attempting("card", { status: "SUCCESSFUL" });
    expect((await provider.resolvePending(T0, await ownsEveryPayment(suite.db))).forwarded).toBe(1);
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
    expect(await provider.resolvePending(T0, await ownsEveryPayment(suite.db))).toEqual({
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
    expect(await provider.resolvePending(T0, await ownsEveryPayment(suite.db))).toEqual({
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
    expect((await provider.resolvePending(T0, await ownsEveryPayment(suite.db))).forwarded).toBe(1);
    expect((await state("u")).state).toBe("captured");
  });

  it("a row SumUp holds nothing for is pending inside the grace period, then failed WITH an incident after it", async () => {
    const { t, provider, state, raised } = await setup();
    await withTransaction(suite.db, (tx) =>
      insertAttempting(tx, {
        origin: deviceOrigin(t.deviceId),
        workingOrderId: t.workingOrderId,
        nodeId: t.nodeId,
        provider: "sumup",
        paymentRef: "ghost",
        amount: decimal("7.00"),
      }),
    );
    // created_at is the DB's now(); swept at ~that same instant the row is inside the grace window,
    // so a not-found is deferred, not failed. (A fixed future `now` would be wall-clock-dependent —
    // past created_at+grace whenever the suite ran before it — so the sweep time is taken live.)
    expect(
      (await provider.resolvePending(new Date(), await ownsEveryPayment(suite.db))).nextDueAt,
    ).not.toBeNull();
    expect((await state("ghost")).state).toBe("attempting");
    expect(raised).toHaveLength(0);
    // …and past created_at + grace the row is failed AND surfaced: a not-found we could not correlate
    // is an uncertain charge, not a proven non-event, so the sweep raises the same unactionable
    // incident (status "not_found") rather than concealing a possible charge.
    const later = new Date(Date.now() + NOT_FOUND_GRACE_MS + 1000);
    expect(await provider.resolvePending(later, await ownsEveryPayment(suite.db))).toMatchObject({
      declined: 1,
      incidentsRaised: 1,
    });
    expect((await state("ghost")).state).toBe("failed");
    expect(raised).toHaveLength(1);
    expect(raised[0]).toMatchObject({ origin: jobOrigin("payment_check"), severity: "error" });
    expect(raised[0]!.error.code).toBe("payment.pending_outcome_unactionable");
    expect(raised[0]!.error.params).toEqual({ paymentRef: "ghost", status: "not_found" });
  });

  it("a past-grace not-found the incident sink declines (already open) still fails the row but is not counted", async () => {
    const { t, provider, state, raised } = await setup(false);
    await withTransaction(suite.db, (tx) =>
      insertAttempting(tx, {
        origin: deviceOrigin(t.deviceId),
        workingOrderId: t.workingOrderId,
        nodeId: t.nodeId,
        provider: "sumup",
        paymentRef: "ghost-dup",
        amount: decimal("7.00"),
      }),
    );
    const later = new Date(Date.now() + NOT_FOUND_GRACE_MS + 1000);
    expect(await provider.resolvePending(later, await ownsEveryPayment(suite.db))).toEqual({
      nextDueAt: null,
      forwarded: 0,
      declined: 1,
      incidentsRaised: 0,
    });
    expect((await state("ghost-dup")).state).toBe("failed");
    expect(raised).toHaveLength(1);
    expect(raised[0]!.error.params).toEqual({ paymentRef: "ghost-dup", status: "not_found" });
  });

  it("REFUNDED without event evidence stays attempting with a refund incident", async () => {
    const { provider, attempting, state, raised } = await setup();
    await attempting("r", { status: "REFUNDED" });
    expect(await provider.resolvePending(T0, await ownsEveryPayment(suite.db))).toMatchObject({
      declined: 0,
      incidentsRaised: 1,
    });
    expect((await state("r")).state).toBe("attempting");
    expect(raised).toHaveLength(1);
    // toEqual (not toMatchObject) so the incident input's FULL key set is pinned — in particular that
    // no `saleId` is passed (an attempting row has no sale; §4: toMatchObject checks only listed keys).
    expect(raised[0]).toEqual({
      origin: jobOrigin("payment_check"),
      error: expect.any(AppError),
      severity: "error",
      detectedAt: T0,
    });
    expect(raised[0]!.error.code).toBe("payment.pending_outcome_unactionable");
    expect(raised[0]!.error.params).toEqual({ paymentRef: "r", status: "refund_pending" });
  });

  it("hands the sink the unactionable incidents of two devices' orders under the payment check's origin", async () => {
    const { provider, attempting, state, raised } = await setup();
    await attempting("first", { status: "REFUNDED" });
    // A second order on another till and device.
    const other = await seedWorkingOrder(suite.db, freshNif());
    await withTransaction(suite.db, (tx) =>
      insertAttempting(tx, {
        origin: deviceOrigin(other.deviceId),
        workingOrderId: other.workingOrderId,
        nodeId: other.nodeId,
        provider: "sumup",
        paymentRef: "second",
        amount: decimal("7.00"),
      }),
    );
    await provider.resolvePending(
      new Date(Date.now() + NOT_FOUND_GRACE_MS + 1000),
      await ownsEveryPayment(suite.db),
    );
    expect((await state("second")).state).toBe("failed");
    // Neither call names a device: both carry the payment check's origin, this code and no sale.
    expect(raised.map((input) => [input.origin, input.error.code, input.saleId])).toEqual([
      [jobOrigin("payment_check"), "payment.pending_outcome_unactionable", undefined],
      [jobOrigin("payment_check"), "payment.pending_outcome_unactionable", undefined],
    ]);
  });

  it("an unknown status resolves failed with an incident naming the value", async () => {
    const { provider, attempting, raised } = await setup();
    await attempting("x", { status: "CHARGE_BACK" });
    expect(await provider.resolvePending(T0, await ownsEveryPayment(suite.db))).toMatchObject({
      declined: 1,
      incidentsRaised: 1,
    });
    expect(raised[0]!.error.params).toEqual({ paymentRef: "x", status: "CHARGE_BACK" });
  });

  it("a network error on one row defers that row and still resolves the others", async () => {
    const { fake, provider, attempting, state } = await setup();
    await attempting("first", { status: "SUCCESSFUL" });
    await attempting("second", { status: "SUCCESSFUL" });
    fake.throwOnFindNext();
    const r = await provider.resolvePending(T0, await ownsEveryPayment(suite.db));
    expect(r.forwarded).toBe(1);
    expect(r.nextDueAt).not.toBeNull();
    const states = [(await state("first")).state, (await state("second")).state].sort();
    expect(states).toEqual(["attempting", "captured"]);
  });

  it("an empty sweep is all-zeros", async () => {
    const { provider } = await setup();
    expect(await provider.resolvePending(T0, await ownsEveryPayment(suite.db))).toEqual({
      nextDueAt: null,
      forwarded: 0,
      declined: 0,
      incidentsRaised: 0,
    });
  });
});
