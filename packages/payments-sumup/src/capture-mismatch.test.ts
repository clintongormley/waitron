import { fullDiskOnCaptureAlert } from "@waitron/payments/test/capture-alert-disk.js";
import { expect, it, vi } from "vitest";
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
import { SumUpCloudProvider } from "./provider.js";

const suite = useVenueDb({ migrations: [CORE_MIGRATIONS, PAYMENTS_MIGRATIONS] });
const now = new Date("2026-11-07T03:00:00.000Z");

it("records actual SumUp amounts", async () => {
  for (const [actual, state, amount, alertCount] of [
    ["12.50", "captured", "12.50", 0],
    ["12.00", "captured", "12.00", 1],
    ["13.00", "captured", "13.00", 1],
    ["0.00", "failed", "12.50", 1],
  ] as const) {
    const { provider, fake, params, row } = await setup(suite);
    vi.spyOn(fake, "findTransaction").mockResolvedValue({
      id: `txn_${actual}`,
      status: "SUCCESSFUL",
      amount: decimal(actual),
    });
    const result = await provider.collect(params);
    expect(result).toMatchObject({ state, amount });
    const paymentRef = result.paymentRef;
    expect(await row(paymentRef!)).toMatchObject({ state, amount });
    const alerts = await suite.db.select().from(incidents);
    const evidence = alerts
      .flatMap((a) => (a.params.payments ?? []) as { paymentRef: string }[])
      .filter((p) => p.paymentRef === paymentRef!);
    expect(evidence).toHaveLength(alertCount);
  }
});

it("continues processor reads even when an old alert exists", async () => {
  const { provider, fake, params, row } = await setup(suite, (fake) => fake.stallNext());
  const result = await provider.collect(params);
  await withTransaction(suite.db, (tx) =>
    recordCaptureMismatch(
      tx,
      captureAlerts,
      {
        provider: "sumup",
        paymentRef: result.paymentRef,
        workingOrderId: params.workingOrderId,
        externalRef: "txn_old",
        requestedAmount: "12.50",
        reportedAmount: "12.00",
      },
      now,
    ),
  );
  vi.spyOn(fake, "findTransaction").mockResolvedValue({
    id: "txn_old",
    status: "SUCCESSFUL",
    amount: decimal("12.00"),
  });
  expect(await provider.resolvePending(now, await ownsEveryPayment(suite.db))).toMatchObject({
    forwarded: 1,
    incidentsRaised: 0,
  });
  expect(await row(result.paymentRef)).toMatchObject({ state: "captured", amount: "12.00" });
  expect(await suite.db.select().from(incidents)).toHaveLength(1);
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

it.each(["captured", "failed"])(
  "keeps a stale sweep's %s outcome and warns only about a contradictory capture",
  async (state) => {
    const { fake, params, row } = await setup(suite, (f) => f.stallNext());
    const provider = new SumUpCloudProvider({
      client: fake,
      db: suite.db,
      captureAlerts,
      incidents: captureAlerts.raise,
      poll: { maxAttempts: 1, intervalMs: 0, sleep: () => Promise.resolve() },
    });
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
      incidentsRaised: state === "failed" ? 1 : 0,
    });
    expect((await row(result.paymentRef)).state).toBe(state);
    const alerts = await suite.db.select().from(incidents);
    if (state === "failed") {
      expect(alerts).toHaveLength(1);
      expect(alerts[0]).toMatchObject({
        code: "payment.pending_outcome_unactionable",
        params: { paymentRef: result.paymentRef, status: "SUCCESSFUL" },
      });
    } else expect(alerts).toEqual([]);
  },
);

it.each(["SUCCESSFUL", "FAILED"])(
  "retains the first captured amount when collect later answers %s",
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
    expect(result).toMatchObject({ state: "captured", amount: "12.00" });
    expect(await row(result.paymentRef)).toMatchObject({ state: "captured", amount: "12.00" });
  },
);

it.each(["refused", "throws"])(
  "returns an already committed capture when SumUp create %s",
  async (outcome) => {
    const { provider, fake, params } = await setup(suite);
    vi.spyOn(fake, "createCheckout").mockImplementationOnce(async (request) => {
      await withTransaction(suite.db, (tx) =>
        captureAttempting(tx, {
          provider: "sumup",
          paymentRef: request.foreignTransactionId,
          externalRef: "txn_won",
          settledAt: now,
          amount: decimal("12.00"),
        }),
      );
      if (outcome === "throws") throw new Error("connection closed after capture");
      return { accepted: false, reason: "refused" };
    });
    expect(await provider.collect(params)).toMatchObject({
      state: "captured",
      amount: "12.00",
      settledAt: now,
    });
  },
);
