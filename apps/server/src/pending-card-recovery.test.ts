import { testTradingAdmission } from "./testing/trading-admission.js";
import { updateOrderLine, placeOrder } from "./testing/order-writer-fixture.js";
import { eq, sql } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { drawerOpens, sales, withTransaction, workingOrders } from "@waitron/db";
import {
  getPaymentByRef,
  insertCapturedPayment,
  payments,
  recordResolution,
} from "@waitron/payments";
import { AppError, decimal } from "@waitron/shared";
import { StripeTerminalProvider } from "@waitron/payments-stripe";
import { FakeStripe } from "@waitron/payments-stripe/src/testing/fake-stripe.js";
import { FakePaymentProvider } from "@waitron/payments/src/testing/fake-provider.js";
import { payWorkingOrderIntegratedOrchestration as pay } from "./testing/whole-payment-fixture.js";
import * as tillSale from "./till-sale.js";
import { withAutomaticCardRecovery, withPendingSweep } from "./boot.js";
import { recoverAutomaticCardPayments } from "./pending-card-recovery.js";
import { provisionBillVenue, statusOf, tabWith, tendersOfBill } from "./testing/bill-venue.js";
import type { BillVenue } from "./testing/bill-venue.js";
import { issueOrderInvoice } from "./testing/issue-order.js";
import { TradingAdmission } from "./trading-admission.js";

const suite = useVenueDb({
  migrations: migrationOptionsFor(manifestSets(), null),
  timeoutMs: 60_000,
});

async function retained(venue: BillVenue, manual = false, issued = false, placed = false) {
  const id = await tabWith(venue, "Caña");
  if (issued)
    await issueOrderInvoice(
      { ...venue, admission: testTradingAdmission() },
      venue.cfg,
      id,
      venue.operatorId,
    );
  if (placed)
    await placeOrder(
      { ...venue, admission: testTradingAdmission() },
      venue.cfg,
      id,
      venue.operatorId,
    );
  const paymentRef = randomUUID();
  await withTransaction(venue.db, async (tx) => {
    await insertCapturedPayment(tx, {
      origin: venue.cfg.origin,
      workingOrderId: id,
      provider: "stripe",
      paymentRef,
      amount: decimal("3.00"),
      externalRef: `pi_${paymentRef}`,
      settledAt: venue.clock.now().instant,
    });
    const payment = (await getPaymentByRef(tx, { provider: "stripe", paymentRef }))!;
    await recordResolution(tx, {
      paymentId: payment.id,
      workingOrderId: id,
      personId: manual ? venue.adminId : null,
      outcome: "captured",
      cancelledAtProvider: false,
      providerStatus: "succeeded",
      resolvedAt: venue.clock.now().instant,
    });
  });
  return { id, paymentRef };
}

function recoveryDeps(venue: BillVenue) {
  const provider = new StripeTerminalProvider({ db: venue.db, client: new FakeStripe() });
  return {
    ...venue,
    pool: { get: async () => provider },
    provider,
    collect: vi.spyOn(provider, "collect"),
  };
}

describe("automatic card capture recovery", () => {
  it("refuses a closed pass before loading providers or touching retained captures", async () => {
    const venue = await provisionBillVenue(suite.db);
    const { id, paymentRef } = await retained(venue);
    const deps = recoveryDeps(venue);
    const get = vi.spyOn(deps.pool, "get");
    const before = await getPaymentByRef(suite.db, { provider: "stripe", paymentRef });
    const admission = new TradingAdmission();
    admission.repairOnly("invalid");
    let refusal: unknown;
    try {
      await recoverAutomaticCardPayments({ ...deps, admission });
    } catch (error) {
      refusal = error;
    }
    expect(get).not.toHaveBeenCalled();
    expect(await getPaymentByRef(suite.db, { provider: "stripe", paymentRef })).toEqual(before);
    expect(await suite.db.select().from(sales)).toEqual([]);
    expect(refusal).toMatchObject({
      code: "venue.time_zone_not_ready",
      params: { reason: "invalid" },
    });
    admission.admit();
    expect(await recoverAutomaticCardPayments({ ...deps, admission })).toEqual({
      filed: 1,
      errors: [],
    });
    expect(await suite.db.select().from(sales).where(eq(sales.workingOrderId, id))).toHaveLength(1);
    expect(deps.collect).not.toHaveBeenCalled();
  });
  it("retains captured evidence when admission closes after the worker acquires its provider", async () => {
    const venue = await provisionBillVenue(suite.db);
    const { id, paymentRef } = await retained(venue);
    const deps = recoveryDeps(venue),
      admission = testTradingAdmission();
    const before = await getPaymentByRef(suite.db, { provider: "stripe", paymentRef });
    deps.pool.get = async () => {
      admission.requireRestart();
      return deps.provider;
    };
    expect(await recoverAutomaticCardPayments({ ...deps, admission })).toEqual({
      filed: 0,
      errors: [{ paymentId: before!.id, error: "AppError: venue.time_zone_not_ready" }],
    });
    expect(await getPaymentByRef(suite.db, { provider: "stripe", paymentRef })).toEqual(before);
    expect(await suite.db.select().from(sales)).toEqual([]);
    expect(deps.collect).not.toHaveBeenCalled();
    deps.pool.get = async () => deps.provider;
    admission.admit();
    expect(await recoverAutomaticCardPayments({ ...deps, admission })).toEqual({
      filed: 1,
      errors: [],
    });
    expect(await suite.db.select().from(sales).where(eq(sales.workingOrderId, id))).toHaveLength(1);
    expect(deps.collect).not.toHaveBeenCalled();
  });
  it.each([
    { issued: false, placed: false },
    { issued: true, placed: false },
    { issued: false, placed: true },
    { issued: true, placed: true },
  ])(
    "resumes a retained capture after restart with invoice=$issued and placed=$placed",
    async ({ issued, placed }) => {
      const venue = await provisionBillVenue(suite.db);
      const { id } = await retained(venue, false, issued, placed);
      expect(await statusOf(venue, id)).toBe(placed ? "placed" : "open");
      const deps = recoveryDeps(venue);
      const fiscal = vi.spyOn(venue.backend, "recordSale");
      expect(
        await recoverAutomaticCardPayments({ ...deps, admission: testTradingAdmission() }),
      ).toEqual({ filed: 1, errors: [] });
      expect(
        await recoverAutomaticCardPayments({ ...deps, admission: testTradingAdmission() }),
      ).toEqual({ filed: 0, errors: [] });
      expect(await statusOf(venue, id)).toBe("settled");
      expect(await suite.db.select().from(sales).where(eq(sales.workingOrderId, id))).toHaveLength(
        1,
      );
      expect(fiscal).toHaveBeenCalledTimes(issued ? 0 : 1);
      expect(deps.collect).not.toHaveBeenCalled();
    },
  );

  it("leaves manager-owned recovery to its caller", async () => {
    const venue = await provisionBillVenue(suite.db);
    const { id } = await retained(venue, true);
    const deps = recoveryDeps(venue);
    expect(
      await recoverAutomaticCardPayments({ ...deps, admission: testTradingAdmission() }),
    ).toEqual({ filed: 0, errors: [] });
    expect(await statusOf(venue, id)).toBe("open");
    expect(deps.collect).not.toHaveBeenCalled();
  });

  it("keeps a failed filing captured and retries it while allowing another capture to finish", async () => {
    const venue = await provisionBillVenue(suite.db);
    await retained(venue);
    await retained(venue);
    const deps = recoveryDeps(venue);
    vi.spyOn(venue.backend, "recordSale").mockRejectedValueOnce(new Error("filing refused"));
    const first = await recoverAutomaticCardPayments({
      ...deps,
      admission: testTradingAdmission(),
    });
    expect(first.filed).toBe(1);
    expect(first.errors).toEqual([
      { paymentId: expect.any(String), error: "Error: filing refused" },
    ]);
    const [unfiled] = await suite.db
      .select()
      .from(payments)
      .where(eq(payments.id, first.errors[0]!.paymentId));
    expect(unfiled?.state).toBe("captured");
    expect(unfiled?.saleId).toBeNull();
    expect(
      await recoverAutomaticCardPayments({ ...deps, admission: testTradingAdmission() }),
    ).toEqual({ filed: 1, errors: [] });
    expect(await suite.db.select().from(sales)).toHaveLength(2);
    expect(deps.collect).not.toHaveBeenCalled();
  });

  it("reports a full disk as a full disk, not as a card charged and unrecorded", async () => {
    const venue = await provisionBillVenue(suite.db);
    const { id } = await retained(venue);
    const deps = recoveryDeps(venue);
    vi.spyOn(venue.backend, "recordSale").mockRejectedValueOnce(
      new AppError("storage.disk_full", {}),
    );

    const answer = await recoverAutomaticCardPayments({
      ...deps,
      admission: testTradingAdmission(),
    });

    expect(answer.filed).toBe(0);
    expect(answer.errors).toEqual([
      { paymentId: expect.any(String), error: "AppError: storage.disk_full" },
    ]);
    expect(await statusOf(venue, id)).toBe("open");
  });

  it("rechecks a capture after obtaining the provider", async () => {
    const venue = await provisionBillVenue(suite.db);
    const { paymentRef } = await retained(venue);
    const deps = recoveryDeps(venue);
    deps.pool.get = async () => {
      await suite.db
        .update(payments)
        .set({ state: "refunded" })
        .where(eq(payments.paymentRef, paymentRef));
      return deps.provider;
    };
    expect(
      await recoverAutomaticCardPayments({ ...deps, admission: testTradingAdmission() }),
    ).toEqual({ filed: 0, errors: [] });
    expect(await suite.db.select().from(sales)).toEqual([]);
    expect(deps.collect).not.toHaveBeenCalled();
  });

  it("refuses to collect if the capture disappears after its eligibility read", async () => {
    const venue = await provisionBillVenue(suite.db);
    const { paymentRef } = await retained(venue);
    const provider = new FakePaymentProvider(suite.db);
    let changed = false;
    Object.defineProperty(provider, "provider", {
      get: () => {
        if (!changed) {
          changed = true;
          suite.db.run(sql`update payments set state = 'failed' where payment_ref = ${paymentRef}`);
        }
        return "stripe";
      },
    });
    const result = await recoverAutomaticCardPayments({
      admission: testTradingAdmission(),
      ...venue,
      pool: { get: async () => provider },
    });
    expect(result).toEqual({
      filed: 0,
      errors: [
        {
          paymentId: expect.any(String),
          error: "AppError: management.request_invalid",
        },
      ],
    });
    expect(provider.collectCalls).toEqual([]);
    expect(await suite.db.select().from(sales)).toEqual([]);
  });

  it.each([false, true])(
    "leaves a live request alone with stale initial read=%s",
    async (stale) => {
      const venue = await provisionBillVenue(suite.db);
      const id = await tabWith(venue, "Caña");
      const client = new FakeStripe();
      client.stallNext();
      const created = vi.spyOn(client, "createPaymentIntent");
      const provider = new StripeTerminalProvider({
        db: suite.db,
        client,
        poll: { maxAttempts: 1, intervalMs: 0, sleep: () => Promise.resolve() },
      });
      let enter!: () => void;
      const entered = new Promise<void>((resolve) => {
        enter = resolve;
      });
      let release!: () => void;
      const released = new Promise<void>((resolve) => {
        release = resolve;
      });
      const collect = provider.collect.bind(provider);
      vi.spyOn(provider, "collect").mockImplementation(async (params) => {
        const result = await collect(params);
        const intent = await created.mock.results[0]!.value;
        client.setIntent(intent.id, { status: "succeeded", amount: 300, amountReceived: 300 });
        await provider.resolvePending(venue.clock.now().instant);
        enter();
        await released;
        return result;
      });
      const deps = {
        ...venue,
        provider,
        readerRef: "reader_live",
        pool: { get: async () => provider },
      };
      const paying = pay(
        { ...deps, admission: testTradingAdmission() },
        venue.cfg,
        { id, lines: [] },
        venue.operatorId,
      );
      let initialRead: ReturnType<typeof vi.spyOn> | undefined;
      try {
        await entered;
        if (stale)
          initialRead = vi.spyOn(tillSale, "paymentAttemptIsLive").mockReturnValueOnce(false);
        expect(
          await recoverAutomaticCardPayments({ ...deps, admission: testTradingAdmission() }),
        ).toEqual({ filed: 0, errors: [] });
        expect(await suite.db.select().from(sales)).toEqual([]);
      } finally {
        initialRead?.mockRestore();
        release();
        await paying;
      }
      expect(await paying).toEqual({ outcome: "timeout" });
      expect(
        await recoverAutomaticCardPayments({ ...deps, admission: testTradingAdmission() }),
      ).toEqual({ filed: 1, errors: [] });
      expect(await statusOf(venue, id)).toBe("settled");
    },
  );

  it("records the late capture once, with the original device and tip, without collecting again", async () => {
    const venue = await provisionBillVenue(suite.db);
    const id = await tabWith(venue, "Caña");
    const client = new FakeStripe();
    client.stallNext();
    const provider = new StripeTerminalProvider({
      db: suite.db,
      client,
      poll: { maxAttempts: 1, intervalMs: 0, sleep: () => Promise.resolve() },
    });
    const create = vi.spyOn(client, "createPaymentIntent");
    const collect = vi.spyOn(provider, "collect");
    const cfg = { ...venue.cfg, tipsEnabled: true };
    const deps = {
      db: suite.db,
      backend: venue.backend,
      clock: venue.clock,
      provider,
      readerRef: "reader_late",
    };
    expect(
      await pay(
        { ...deps, admission: testTradingAdmission() },
        cfg,
        { id, lines: [], tip: "0.50" },
        venue.operatorId,
      ),
    ).toEqual({
      outcome: "timeout",
    });
    const [pending] = await suite.db.select().from(payments).where(eq(payments.workingOrderId, id));
    expect(pending?.state).toBe("attempting");
    expect(pending?.amount).toBe(350);
    const [order] = await suite.db
      .select({ revision: workingOrders.revision })
      .from(workingOrders)
      .where(eq(workingOrders.id, id));
    await expect(
      withTransaction(suite.db, (tx) =>
        updateOrderLine(tx, cfg, id, 1, { note: "changed while unknown" }, order!.revision),
      ),
    ).rejects.toMatchObject({ code: "order.payment_in_flight" });
    await expect(
      pay({ ...deps, admission: testTradingAdmission() }, cfg, { id, lines: [] }, venue.operatorId),
    ).rejects.toMatchObject({
      code: "order.payment_in_flight",
    });
    expect(await suite.db.select().from(sales).where(eq(sales.workingOrderId, id))).toEqual([]);
    const intent = await create.mock.results[0]!.value;
    client.setIntent(intent.id, { status: "succeeded", amount: 350, amountReceived: 350 });
    const log = vi.fn();
    const pass = withAutomaticCardRecovery(
      withPendingSweep(
        async () => ({ duties: [], nextDueAt: null }),
        async () => [provider],
        () => {},
      ),
      () =>
        recoverAutomaticCardPayments({
          admission: testTradingAdmission(),
          ...deps,
          cfg,
          pool: { get: async () => provider },
        }),
      () => "primary",
      log,
    );
    await pass(venue.clock.now().instant);
    expect(log.mock.calls.filter(([level]) => level === "warn")).toEqual([]);
    const recorded = await suite.db.select().from(sales).where(eq(sales.workingOrderId, id));
    expect(recorded).toHaveLength(1);
    expect(recorded[0]?.total).toBe(300);
    expect(await statusOf(venue, id)).toBe("settled");
    expect(await tendersOfBill(venue, id)).toEqual([
      {
        method: "card",
        amount: 350,
        tip: 50,
        billPaymentId: null,
        saleDeviceId: cfg.origin.deviceId,
      },
    ]);
    expect(
      (await getPaymentByRef(suite.db, { provider: "stripe", paymentRef: pending!.paymentRef }))
        ?.saleId,
    ).toBe(recorded[0]!.id);
    await pass(venue.clock.now().instant);
    expect(await suite.db.select().from(sales).where(eq(sales.workingOrderId, id))).toHaveLength(1);
    expect(collect).toHaveBeenCalledTimes(1);
    expect(await suite.db.select().from(drawerOpens)).toEqual([]);
    expect((await suite.db.execute(sql`select person_id from payment_resolutions`)).rows).toEqual([
      { person_id: null },
    ]);
  });
});
