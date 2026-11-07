import { fullDiskOnCaptureAlert } from "@waitron/payments/test/capture-alert-disk.js";
import { describe, expect, it, vi } from "vitest";
import { CORE_MIGRATIONS, incidents, withTransaction } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { diskFullIn, decimal } from "@waitron/shared";
import {
  ChargeNotSavedError,
  PAYMENTS_MIGRATIONS,
  recordCaptureMismatch,
  captureAttempting,
  failAttempting,
} from "@waitron/payments";
import { captureAlerts } from "@waitron/payments/test/capture-alerts.js";
import { ownsEveryPayment } from "@waitron/payments/test/seed.js";
import { setup } from "./testing/setup.js";

const suite = useVenueDb({ migrations: [CORE_MIGRATIONS, PAYMENTS_MIGRATIONS] });
const now = new Date("2026-11-07T03:00:00.000Z");

describe("SumUp capture amount evidence", () => {
  it.each(["0.00", "12.00", "13.00"])(
    "holds a sweep mismatch of %s and alerts both figures",
    async (amount) => {
      const { provider, fake, params, row, makeProvider } = await setup(suite, (fake) =>
        fake.stallNext(),
      );
      const result = await provider.collect(params);
      const find = fake.findTransaction.bind(fake);
      vi.spyOn(fake, "findTransaction").mockImplementation(async (query) => {
        const answer = await find(query);
        return answer === null
          ? null
          : { ...answer, status: "SUCCESSFUL", amount: decimal(amount) };
      });
      expect(await makeProvider().resolvePending(now, await ownsEveryPayment(suite.db))).toEqual({
        nextDueAt: null,
        forwarded: 0,
        declined: 0,
        incidentsRaised: 1,
      });
      expect(await row(result.paymentRef)).toMatchObject({
        state: "attempting",
        amount: "12.50",
        settledAt: null,
        saleId: null,
      });
      const alerts = await suite.db.select().from(incidents);
      expect(alerts).toHaveLength(1);
      expect(alerts[0]!.params).toMatchObject({
        payments: [
          {
            provider: "sumup",
            paymentRef: result.paymentRef,
            requestedAmount: "12.50",
            reportedAmount: amount,
          },
        ],
      });
    },
  );

  it.each(["SUCCESSFUL", "FAILED", "CANCELLED", "REFUNDED", "PENDING", "missing"])(
    "never lets a later %s answer release or recheck an acknowledged mismatch",
    async (status) => {
      const { provider, fake, params, row, makeProvider } = await setup(suite);
      vi.spyOn(fake, "findTransaction").mockResolvedValue({
        id: "txn_mismatch",
        status: "SUCCESSFUL",
        amount: decimal("12.00"),
      });
      const result = await provider.collect(params);
      expect(result.captureMismatch).toBe(true);
      const [alert] = await suite.db.select().from(incidents);
      expect(alert).toBeDefined();
      if (alert !== undefined)
        await withTransaction(suite.db, (tx) =>
          captureAlerts.handle(tx, { id: alert.id, personId: null, handledAt: now }),
        );
      const read = vi
        .mocked(fake.findTransaction)
        .mockClear()
        .mockResolvedValue(
          status === "missing" ? null : { id: "txn_mismatch", status, amount: decimal("12.50") },
        );
      expect(await makeProvider().resolvePending(now, await ownsEveryPayment(suite.db))).toEqual({
        nextDueAt: null,
        forwarded: 0,
        declined: 0,
        incidentsRaised: 0,
      });
      expect(read).not.toHaveBeenCalled();
      expect(await row(result.paymentRef)).toMatchObject({
        state: "attempting",
        settledAt: null,
        saleId: null,
      });
      expect(await suite.db.select().from(incidents)).toHaveLength(1);
    },
  );

  it.each(["SUCCESSFUL", "FAILED", "REFUNDED", "missing"])(
    "rechecks evidence before a %s answer already in flight changes the row",
    async (status) => {
      const { provider, fake, params, row } = await setup(suite, (fake) => fake.stallNext());
      const result = await provider.collect(params);
      vi.spyOn(fake, "findTransaction").mockImplementationOnce(async () => {
        await withTransaction(suite.db, (tx) =>
          recordCaptureMismatch(
            tx,
            captureAlerts,
            {
              provider: "sumup",
              paymentRef: result.paymentRef,
              workingOrderId: params.workingOrderId,
              externalRef: "txn_mismatch",
              requestedAmount: "12.50",
              reportedAmount: "12.00",
            },
            now,
          ),
        );
        return status === "missing"
          ? null
          : { id: "txn_mismatch", status, amount: decimal("12.50") };
      });
      expect(
        await provider.resolvePending(
          new Date(now.getTime() + 86400000),
          await ownsEveryPayment(suite.db),
        ),
      ).toEqual({ nextDueAt: null, forwarded: 0, declined: 0, incidentsRaised: 0 });
      expect(await row(result.paymentRef)).toMatchObject({ state: "attempting", settledAt: null });
    },
  );

  it("leaves an ordinary pending row due while another payment has stopped checking", async () => {
    const { provider, fake, params, makeProvider } = await setup(suite);
    vi.spyOn(fake, "findTransaction").mockResolvedValue({
      id: "txn_mismatch",
      status: "SUCCESSFUL",
      amount: decimal("12.00"),
    });
    await provider.collect(params);
    vi.mocked(fake.findTransaction).mockRestore();
    fake.stallNext();
    await provider.collect(params);
    expect(await makeProvider().resolvePending(now, await ownsEveryPayment(suite.db))).toEqual({
      nextDueAt: new Date(now.getTime() + 60000),
      forwarded: 0,
      declined: 0,
      incidentsRaised: 0,
    });
  });
});

it("reports a known charge when the full disk prevents saving its mismatch alert", async () => {
  const { provider, fake, params, row } = await setup(suite);
  vi.spyOn(fake, "findTransaction").mockResolvedValue({
    id: "txn_mismatch",
    status: "SUCCESSFUL",
    amount: decimal("12.00"),
  });
  const disk = fullDiskOnCaptureAlert(suite.db);
  let error: unknown;
  try {
    error = await provider.collect(params).catch((e: unknown) => e);
  } finally {
    disk.lift();
  }
  expect(error).toBeInstanceOf(ChargeNotSavedError);
  expect(diskFullIn(error)).toBe(true);
  expect(await row(fake.lastCreate!.foreignTransactionId)).toMatchObject({
    state: "attempting",
    settledAt: null,
  });
  expect(await suite.db.select().from(incidents)).toEqual([]);
});

it("does not let a create refusal erase mismatch evidence recorded while that create was in flight", async () => {
  const { provider, fake, params, row } = await setup(suite);
  vi.spyOn(fake, "createCheckout").mockImplementationOnce(async (request) => {
    await withTransaction(suite.db, (tx) =>
      recordCaptureMismatch(
        tx,
        captureAlerts,
        {
          provider: "sumup",
          paymentRef: request.foreignTransactionId,
          workingOrderId: params.workingOrderId,
          externalRef: "txn_already_seen",
          requestedAmount: "12.50",
          reportedAmount: "12.00",
        },
        now,
      ),
    );
    return { accepted: false, reason: "refused" };
  });
  const result = await provider.collect(params);
  expect(result).toMatchObject({ state: "attempting", settledAt: null });
  expect(await row(result.paymentRef)).toMatchObject({ state: "attempting", settledAt: null });
});

it.each(["captured", "failed"])(
  "does not alert on a stale sweep after another caller resolved the row as %s",
  async (state) => {
    const { provider, fake, params, row } = await setup(suite, (f) => f.stallNext());
    const result = await provider.collect(params);
    vi.spyOn(fake, "findTransaction").mockImplementationOnce(async () => {
      await withTransaction(suite.db, (tx) =>
        state === "captured"
          ? captureAttempting(tx, {
              provider: "sumup",
              paymentRef: result.paymentRef,
              settledAt: now,
              externalRef: "txn_earlier",
            })
          : failAttempting(tx, { provider: "sumup", paymentRef: result.paymentRef }),
      );
      return { id: "txn_late", status: "SUCCESSFUL", amount: decimal("12.00") };
    });
    expect(await provider.resolvePending(now, await ownsEveryPayment(suite.db))).toEqual({
      nextDueAt: null,
      forwarded: 0,
      declined: 0,
      incidentsRaised: 0,
    });
    expect((await row(result.paymentRef)).state).toBe(state);
    expect(await suite.db.select().from(incidents)).toEqual([]);
  },
);

it.each(["SUCCESSFUL", "FAILED"])(
  "retains a sweep's mismatch when collect later answers %s",
  async (status) => {
    const { provider, fake, params, row } = await setup(suite);
    let enter!: () => void;
    const entered = new Promise<void>((resolve) => {
      enter = resolve;
    });
    let release!: (value: {
      id: string;
      status: string;
      amount: ReturnType<typeof decimal>;
    }) => void;
    const answer = new Promise<{ id: string; status: string; amount: ReturnType<typeof decimal> }>(
      (resolve) => {
        release = resolve;
      },
    );
    vi.spyOn(fake, "findTransaction")
      .mockImplementationOnce(async () => {
        enter();
        return answer;
      })
      .mockResolvedValue({ id: "txn_mismatch", status: "SUCCESSFUL", amount: decimal("12.00") });
    const collecting = provider.collect(params);
    try {
      await entered;
      expect(
        (await provider.resolvePending(now, await ownsEveryPayment(suite.db))).incidentsRaised,
      ).toBe(1);
    } finally {
      release({ id: "txn_exact", status, amount: decimal("12.50") });
    }
    const result = await collecting;
    expect(result).toMatchObject({ state: "attempting", settledAt: null, amount: "12.50" });
    expect(await row(result.paymentRef)).toMatchObject({ state: "attempting", settledAt: null });
  },
);
