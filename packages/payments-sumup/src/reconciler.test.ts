import { describe, expect, it, vi } from "vitest";
import { sql } from "drizzle-orm";
import { CORE_MIGRATIONS, withTransaction } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { decimal, deviceOrigin } from "@waitron/shared";
import {
  PAYMENTS_MIGRATIONS,
  insertCapturedPayment,
  insertFailedPayment,
  recordRefund,
  scheduledRuns,
} from "@waitron/payments";
import { seedWorkingOrder, freshNif } from "@waitron/payments/test/seed.js";
import { captureAlerts, heldAlerts } from "@waitron/payments/test/capture-alerts.js";
import { SumUpReconciler } from "./reconciler.js";
import { FakeSumUp } from "./testing/fake-sumup.js";
const suite = useVenueDb({ migrations: [CORE_MIGRATIONS, PAYMENTS_MIGRATIONS] });
const period = { from: new Date("2026-07-01T00:00:00Z"), to: new Date("2026-07-02T00:00:00Z") };
const now = new Date("2026-07-25T00:00:00Z");

async function failedPayment(paymentRef: string) {
  const seeded = await seedWorkingOrder(suite.db, freshNif());
  await withTransaction(suite.db, (tx) =>
    insertFailedPayment(tx, {
      provider: "sumup",
      paymentRef,
      amount: decimal("10.00"),
      origin: deviceOrigin(seeded.deviceId),
      nodeId: seeded.nodeId,
      workingOrderId: seeded.workingOrderId,
    }),
  );
  await suite.db.execute(sql`update payments set created_at = '2026-07-01T12:00:00.000Z'`);
  return seeded;
}

describe("SumUp audit", () => {
  it("persists the failed-payment hint without changing the payment and resolves credentials anew each sweep", async () => {
    const seeded = await failedPayment("lost");
    const client = new FakeSumUp();
    vi.spyOn(client, "findTransaction").mockResolvedValue({
      id: "charge",
      status: "SUCCESSFUL",
      amount: decimal("10.00"),
      currency: "EUR",
      timestamp: "2026-07-01T12:00:00Z",
      foreignTransactionId: "lost",
    });
    const resolveClient = vi
      .fn()
      .mockResolvedValueOnce(client)
      .mockResolvedValueOnce(new FakeSumUp());
    const reconciler = new SumUpReconciler({
      db: suite.db,
      resolveClient,
      incidents: captureAlerts.raise,
      heldAlerts,
    });
    const before = await suite.db.execute(sql`select * from payments`);
    const result = await reconciler.reconcile(period, now);
    expect(result.missingLocal).toEqual([
      {
        paymentRef: null,
        references: ["charge"],
        localState: null,
        localAmount: null,
        settledAmount: "10.00",
        workingOrderId: seeded.workingOrderId,
      },
    ]);
    expect(result.incidentsRaised).toBe(1);
    expect(result.unlinkedCharges).toBe(0);
    expect(result.remediated).toBe(0);
    expect(await suite.db.execute(sql`select * from payments`)).toEqual(before);
    expect(
      (await suite.db.execute<{ code: string }>(sql`select code from incidents`)).rows,
    ).toEqual([{ code: "payment.reconcile_missing_local" }]);
    expect((await reconciler.reconcile(period, now)).missingLocal).toEqual([]);
    expect(resolveClient).toHaveBeenCalledTimes(2);
  });

  it.each([
    { status: null, timestamp: "2026-07-01T12:00:00Z", unsettled: ["capture"] },
    { status: "CANCELLED", timestamp: "2026-07-01T12:00:00Z", unsettled: ["capture"] },
    { status: "PENDING", timestamp: "2026-07-01T12:00:00Z", unsettled: ["capture"] },
    { status: "FAILED", timestamp: "2026-07-01T12:00:00Z", unsettled: ["capture"] },
    { status: "SUCCESSFUL", timestamp: "2026-06-30T12:00:00Z", unsettled: [] },
  ])(
    "audits $status capture on the normal next-day run, including cross-day recovery",
    async ({ status, timestamp, unsettled }) => {
      const seeded = await seedWorkingOrder(suite.db, freshNif());
      await withTransaction(suite.db, (tx) =>
        insertCapturedPayment(tx, {
          provider: "sumup",
          paymentRef: "capture",
          externalRef: "charge",
          amount: decimal("10.00"),
          origin: deviceOrigin(seeded.deviceId),
          nodeId: seeded.nodeId,
          workingOrderId: seeded.workingOrderId,
          settledAt: new Date("2026-07-01T12:00:00Z"),
        }),
      );
      const client = new FakeSumUp();
      const lookup = vi.spyOn(client, "findTransaction").mockResolvedValue(
        status === null
          ? null
          : {
              id: "charge",
              amount: decimal("10.00"),
              status,
              currency: "EUR",
              timestamp,
            },
      );
      const result = await new SumUpReconciler({
        db: suite.db,
        resolveClient: async () => client,
        incidents: captureAlerts.raise,
        heldAlerts,
      }).reconcile(period, new Date("2026-07-02T00:05:00Z"));
      expect(result.unsettled.map((row) => row.paymentRef)).toEqual(unsettled);
      expect(result.missingLocal).toEqual([]);
      expect(lookup.mock.calls).toEqual([[{ id: "charge" }]]);
    },
  );

  it("counts an outside charge only in its own day", async () => {
    const client = new FakeSumUp();
    vi.spyOn(client, "historyPage").mockResolvedValue({
      items: [
        {
          transaction_id: "app",
          type: "PAYMENT",
          status: "SUCCESSFUL",
          amount: 10,
          currency: "EUR",
          timestamp: "2026-07-02T12:00:00Z",
        },
      ],
      links: [],
    });
    const audit = new SumUpReconciler({
      db: suite.db,
      resolveClient: async () => client,
      incidents: captureAlerts.raise,
      heldAlerts,
    });
    expect((await audit.reconcile(period, now)).unlinkedCharges).toBe(0);
    expect(
      (await audit.reconcile({ from: period.to, to: new Date("2026-07-03T00:00:00Z") }, now))
        .unlinkedCharges,
    ).toBe(1);
  });

  it("asks for a resweep while recovery owns a pending candidate", async () => {
    await failedPayment("pending");
    await suite.db.execute(sql`update payments set state = 'attempting'`);
    const client = new FakeSumUp();
    const lookup = vi.spyOn(client, "findTransaction");
    const result = await new SumUpReconciler({
      db: suite.db,
      resolveClient: async () => client,
      incidents: captureAlerts.raise,
      heldAlerts,
    }).reconcile(period, now);
    expect(result.resweepAfter).toEqual(new Date("2026-07-26T00:00:00Z"));
    expect(result.incidentsRaised).toBe(0);
    expect(lookup).not.toHaveBeenCalled();
  });
});

describe("backup-machine comparison", () => {
  it.each([
    { competing: "none", matched: 1, unmatched: 0 },
    { competing: "manual", matched: 0, unmatched: 1 },
    { competing: "charge", matched: 0, unmatched: 2 },
    { competing: "adjacent-day charge", matched: 0, unmatched: 1 },
    { competing: "wrong amount", matched: 0, unmatched: 1 },
    { competing: "late", matched: 0, unmatched: 1 },
    { competing: "other provider", matched: 0, unmatched: 1 },
    { competing: "next-day only", matched: 0, unmatched: 0 },
    { competing: "next-day competitor", matched: 0, unmatched: 0 },
  ])(
    "keeps $competing candidates separate without changing money",
    async ({ competing, matched, unmatched }) => {
      const seeded = await seedWorkingOrder(suite.db, freshNif());
      const manualAt = "2026-07-01T23:58:00.000Z";
      const manual = async (ref: string, at = manualAt) =>
        withTransaction(suite.db, (tx) =>
          insertCapturedPayment(tx, {
            provider: "manual",
            paymentRef: ref,
            amount: decimal("10.25"),
            origin: deviceOrigin(seeded.deviceId),
            nodeId: seeded.nodeId,
            workingOrderId: seeded.workingOrderId,
            settledAt: new Date(at),
            externalRef: "operation-7",
            externalMachine: "Backup Solo",
            externalProvider: competing === "other provider" ? "other" : "connected_account",
          }),
        );
      await manual("backup");
      if (competing === "manual") await manual("second-entry");
      if (competing === "next-day competitor")
        await manual("next-entry", "2026-07-02T00:06:00.000Z");
      const item = (id: string, timestamp: string, amount = 10.25) => ({
        transaction_id: id,
        type: "PAYMENT",
        status: "SUCCESSFUL",
        amount,
        currency: "EUR",
        timestamp,
      });
      const client = new FakeSumUp();
      const history = vi.spyOn(client, "historyPage").mockResolvedValue({
        items: [
          item(
            "backup-charge",
            competing.startsWith("next-day")
              ? "2026-07-02T00:02:00Z"
              : competing === "late"
                ? "2026-07-01T23:50:00Z"
                : "2026-07-01T23:57:00Z",
            competing === "wrong amount" ? 10 : 10.25,
          ),
          ...(competing === "charge" ? [item("second-charge", "2026-07-01T23:59:00Z")] : []),
          ...(competing === "adjacent-day charge"
            ? [item("tomorrow-charge", "2026-07-02T00:01:00Z")]
            : []),
        ],
      });
      const before = await suite.db.execute(sql`select * from payments`);
      const result = await new SumUpReconciler({
        db: suite.db,
        resolveClient: async () => client,
        incidents: captureAlerts.raise,
        heldAlerts,
      }).reconcile(period, now);
      expect(result.backupMatches).toHaveLength(matched);
      expect(result.backupUnmatched?.filter((row) => row.kind === "charge")).toHaveLength(
        unmatched,
      );
      expect(result.backupUnmatched?.filter((row) => row.kind === "recorded")).toHaveLength(
        competing === "other provider" || competing === "next-day only" || matched
          ? 0
          : competing === "manual"
            ? 2
            : 1,
      );
      if (["manual", "charge", "adjacent-day charge", "next-day competitor"].includes(competing))
        expect(
          result.backupUnmatched.filter((row) => row.kind === "recorded").map((row) => row.reason),
        ).toEqual(competing === "manual" ? ["ambiguous", "ambiguous"] : ["ambiguous"]);
      expect(result.unlinkedCharges).toBe(unmatched);
      expect(result.missingLocal).toHaveLength(unmatched);
      if (matched)
        expect(result.backupMatches).toEqual([
          {
            references: ["backup-charge"],
            amount: "10.25",
            settledAt: "2026-07-01T23:57:00.000Z",
            paymentRef: "backup",
            workingOrderId: seeded.workingOrderId,
            externalMachine: "Backup Solo",
            externalRef: "operation-7",
          },
        ]);
      if (unmatched)
        expect(result.backupUnmatched[0]).toMatchObject({
          references: ["backup-charge"],
          reason:
            competing === "manual" || competing.includes("charge") ? "ambiguous" : "unmatched",
        });
      expect(await suite.db.execute(sql`select * from payments`)).toEqual(before);
      expect(result.remediated).toBe(0);
      const query = new URLSearchParams(history.mock.calls[0]![0]);
      expect(query.get("oldest_time")).toBe("2026-06-30T23:50:00.000Z");
      expect(query.get("newest_time")).toBe("2026-07-02T00:10:00.000Z");
    },
  );

  it("does not offer an integrated reference or lost-reply hint to a backup entry", async () => {
    const seeded = await failedPayment("lost");
    await withTransaction(suite.db, async (tx) => {
      await insertCapturedPayment(tx, {
        provider: "manual",
        paymentRef: "backup",
        externalProvider: "connected_account",
        amount: decimal("10.00"),
        origin: deviceOrigin(seeded.deviceId),
        nodeId: seeded.nodeId,
        workingOrderId: seeded.workingOrderId,
        settledAt: new Date("2026-07-01T12:00:00Z"),
      });
      await insertCapturedPayment(tx, {
        provider: "sumup",
        paymentRef: "integrated",
        externalRef: "known",
        amount: decimal("10.00"),
        origin: deviceOrigin(seeded.deviceId),
        nodeId: seeded.nodeId,
        workingOrderId: seeded.workingOrderId,
        settledAt: new Date("2026-06-30T12:00:00Z"),
      });
    });
    const client = new FakeSumUp();
    vi.spyOn(client, "historyPage").mockResolvedValue({
      items: ["known", "hinted"].map((id) => ({
        transaction_id: id,
        type: "PAYMENT",
        status: "SUCCESSFUL",
        amount: 10,
        currency: "EUR",
        timestamp: "2026-07-01T12:00:00Z",
      })),
    });
    vi.spyOn(client, "findTransaction").mockResolvedValue({
      id: "hinted",
      status: "SUCCESSFUL",
      amount: decimal("10.00"),
      currency: "EUR",
      timestamp: "2026-07-01T12:00:00Z",
      foreignTransactionId: "lost",
    });
    const result = await new SumUpReconciler({
      db: suite.db,
      resolveClient: async () => client,
      incidents: captureAlerts.raise,
      heldAlerts,
    }).reconcile(period, now);
    expect(result.backupMatches).toEqual([]);
    expect(result.backupUnmatched.filter((row) => row.kind === "charge")).toEqual([]);
    expect(result.backupUnmatched).toMatchObject([
      { kind: "recorded", paymentRef: "backup", reason: "unmatched" },
    ]);
    expect(result.unlinkedCharges).toBe(0);
    expect(result.missingLocal.map((row) => row.references)).toEqual([["hinted"]]);
  });
});

it("keeps an original failed attempt's recovered charge even when SumUp dates it outside the audit day", async () => {
  const seeded = await failedPayment("lost-date");
  const client = new FakeSumUp();
  vi.spyOn(client, "findTransaction").mockResolvedValue({
    id: "earlier",
    status: "SUCCESSFUL",
    amount: decimal("10.00"),
    currency: "EUR",
    timestamp: "2026-06-30T12:00:00Z",
    foreignTransactionId: "lost-date",
  });
  const result = await new SumUpReconciler({
    db: suite.db,
    resolveClient: async () => client,
    incidents: captureAlerts.raise,
    heldAlerts,
  }).reconcile(period, now);
  expect(result.missingLocal).toEqual([
    {
      paymentRef: null,
      references: ["earlier"],
      localState: null,
      localAmount: null,
      settledAmount: "10.00",
      workingOrderId: seeded.workingOrderId,
    },
  ]);
  expect(result.backupMatches).toEqual([]);
  expect(result.backupUnmatched).toEqual([]);
});

it("counts an unreadable item only in its original UTC audit day", async () => {
  const client = new FakeSumUp();
  const timestamp = "2026-06-30T23:55:00.000Z";
  vi.spyOn(client, "historyPage").mockImplementation(async (query) => {
    const bounds = new URLSearchParams(query);
    return {
      items:
        timestamp >= bounds.get("oldest_time")! && timestamp < bounds.get("newest_time")!
          ? [
              {
                transaction_id: "payout",
                type: "PAYOUT",
                status: "SUCCESSFUL",
                amount: 10,
                currency: "EUR",
                timestamp,
              },
            ]
          : [],
    };
  });
  const audit = new SumUpReconciler({
    db: suite.db,
    resolveClient: async () => client,
    incidents: captureAlerts.raise,
    heldAlerts,
  });
  expect(
    (await audit.reconcile({ from: new Date("2026-06-30T00:00:00Z"), to: period.from }, now))
      .unlinkedCharges,
  ).toBe(1);
  expect((await audit.reconcile(period, now)).unlinkedCharges).toBe(0);
});

it("lists a recorded backup payment even when SumUp reports no charge", async () => {
  const seeded = await seedWorkingOrder(suite.db, freshNif());
  await withTransaction(suite.db, (tx) =>
    insertCapturedPayment(tx, {
      provider: "manual",
      paymentRef: "not-charged",
      externalProvider: "connected_account",
      externalRef: "operation-9",
      externalMachine: "Backup Solo",
      amount: decimal("42.00"),
      origin: deviceOrigin(seeded.deviceId),
      nodeId: seeded.nodeId,
      workingOrderId: seeded.workingOrderId,
      settledAt: new Date("2026-07-01T12:00:00Z"),
    }),
  );
  const result = await new SumUpReconciler({
    db: suite.db,
    resolveClient: async () => new FakeSumUp(),
    incidents: captureAlerts.raise,
    heldAlerts,
  }).reconcile(period, now);
  expect(result.backupUnmatched).toEqual([
    {
      kind: "recorded",
      references: [],
      amount: "42.00",
      settledAt: "2026-07-01T12:00:00.000Z",
      reason: "unmatched",
      paymentRef: "not-charged",
      workingOrderId: seeded.workingOrderId,
      externalMachine: "Backup Solo",
      externalRef: "operation-9",
    },
  ]);
  expect(result.unlinkedCharges).toBe(0);
});

it("keeps refund evidence in the audit and never sends or changes financial rows", async () => {
  const seeded = await seedWorkingOrder(suite.db, freshNif());
  await withTransaction(suite.db, async (tx) => {
    await insertCapturedPayment(tx, {
      provider: "sumup",
      paymentRef: "returned",
      externalRef: "old-charge",
      amount: decimal("10.00"),
      origin: deviceOrigin(seeded.deviceId),
      nodeId: seeded.nodeId,
      workingOrderId: seeded.workingOrderId,
      settledAt: new Date("2026-06-01T12:00:00Z"),
    });
    await recordRefund(tx, {
      provider: "sumup",
      paymentRef: "returned",
      amount: decimal("2.35"),
      providerRefundRef: "refund-1",
    });
    await tx.execute(sql`update payment_refunds set created_at = '2026-07-01T13:00:00.000Z'`);
  });
  const client = new FakeSumUp();
  const send = vi.spyOn(client, "sendRefund").mockResolvedValue({ httpStatus: 201 });
  const refund = vi.spyOn(client, "refund").mockResolvedValue({ status: "accepted" });
  vi.spyOn(client, "findTransaction").mockResolvedValue({
    id: "old-charge",
    status: "SUCCESSFUL",
    amount: decimal("10.00"),
    currency: "EUR",
    refundEvents: [
      {
        id: "refund-1",
        status: "REFUNDED",
        amount: decimal("2.35"),
        timestamp: "2026-07-01T12:59:00Z",
      },
    ],
  });
  const before = [
    await suite.db.execute(sql`select * from payments`),
    await suite.db.execute(sql`select * from payment_refunds`),
  ];
  const audit = new SumUpReconciler({
    db: suite.db,
    resolveClient: async () => client,
    incidents: captureAlerts.raise,
    heldAlerts,
  });
  const result = await audit.reconcile(period, now);
  expect(result.refundEvidence).toMatchObject({
    complete: true,
    checkedAt: now.toISOString(),
    parents: [
      {
        processorRef: "old-charge",
        events: [{ id: "refund-1", amount: "2.35", at: "2026-07-01T12:59:00.000Z" }],
      },
    ],
  });
  expect(result.resweepAfter).toBeUndefined();
  expect([
    await suite.db.execute(sql`select * from payments`),
    await suite.db.execute(sql`select * from payment_refunds`),
  ]).toEqual(before);
  expect(send).not.toHaveBeenCalled();
  expect(refund).not.toHaveBeenCalled();
});

it.each([false, true, "midnight"])(
  "reads a locally recorded backup refund through its known charge (historical=%s)",
  async (historical) => {
    const seeded = await seedWorkingOrder(suite.db, freshNif());
    const capturedAt =
      historical === "midnight"
        ? "2026-06-01T23:59:00.000Z"
        : historical
          ? "2026-06-01T12:00:00.000Z"
          : "2026-07-01T12:00:00.000Z";
    await withTransaction(suite.db, async (tx) => {
      await insertCapturedPayment(tx, {
        provider: "manual",
        externalProvider: "connected_account",
        paymentRef: "backup-return",
        externalRef: "operation",
        amount: decimal("10.00"),
        origin: deviceOrigin(seeded.deviceId),
        nodeId: seeded.nodeId,
        workingOrderId: seeded.workingOrderId,
        settledAt: new Date(capturedAt),
      });
      await recordRefund(tx, {
        provider: "manual",
        paymentRef: "backup-return",
        amount: decimal("10.00"),
      });
      await tx.execute(sql`update payment_refunds set created_at = '2026-07-01T13:00:00.000Z'`);
      if (historical)
        await tx.insert(scheduledRuns).values({
          duty: "payments.reconcile.sumup",
          periodFrom:
            historical === "midnight" ? "2026-06-02T00:00:00.000Z" : "2026-06-01T00:00:00.000Z",
          periodTo:
            historical === "midnight" ? "2026-06-03T00:00:00.000Z" : "2026-06-02T00:00:00.000Z",
          generation: 0,
          state: "succeeded",
          summary: {
            backupMatches: [{ paymentRef: "backup-return", references: ["backup-charge"] }],
          },
        });
    });
    const client = new FakeSumUp();
    vi.spyOn(client, "historyPage").mockResolvedValue({
      items: historical
        ? []
        : [
            {
              type: "PAYMENT",
              transaction_id: "backup-charge",
              status: "SUCCESSFUL",
              amount: 10,
              currency: "EUR",
              timestamp: capturedAt,
            },
          ],
    });
    const find = vi.spyOn(client, "findTransaction").mockResolvedValue({
      id: "backup-charge",
      status: "SUCCESSFUL",
      amount: decimal("10.00"),
      currency: "EUR",
      timestamp: capturedAt,
      refundEvents: [],
    });
    const result = await new SumUpReconciler({
      db: suite.db,
      resolveClient: async () => client,
      incidents: captureAlerts.raise,
      heldAlerts,
    }).reconcile(period, now);
    expect(result.refundEvidence).toMatchObject({
      complete: true,
      parents: [{ processorRef: "backup-charge", events: [] }],
    });
    expect(find.mock.calls).toEqual([[{ id: "backup-charge" }]]);
  },
);

it("passes a retryable refund read failure to the scheduler", async () => {
  const client = new FakeSumUp();
  vi.spyOn(client, "historyPage").mockResolvedValue({
    items: [{ type: "REFUND", transaction_id: "refund-parent", timestamp: "2026-07-01T12:00:00Z" }],
  });
  vi.spyOn(client, "findTransaction").mockRejectedValue(new Error("offline"));
  const result = await new SumUpReconciler({
    db: suite.db,
    resolveClient: async () => client,
    incidents: captureAlerts.raise,
    heldAlerts,
  }).reconcile(period, now);
  expect(result.resweepAfter).toEqual(new Date("2026-07-26T00:00:00Z"));
});

describe("abandoned-order refunds", () => {
  it("recovers a lost reply, commits its claim before sending, and confirms once on a later day despite history failure", async () => {
    const seeded = await failedPayment("lost-orphan");
    await suite.db.execute(
      sql`update working_orders set status = 'abandoned' where id = ${seeded.workingOrderId}`,
    );
    const before = suite.db.all(
      sql`select id, node_id, amount, source, device_id, reader_id, working_order_id from payments`,
    );
    const client = new FakeSumUp();
    const transaction = {
      id: "orphan-charge",
      foreignTransactionId: "lost-orphan",
      status: "SUCCESSFUL",
      amount: decimal("10.00"),
      currency: "EUR",
      timestamp: "2026-07-01T12:03:00.000Z",
      refundEvents: [] as {
        id: string;
        status: string;
        amount: ReturnType<typeof decimal>;
        timestamp: string;
      }[],
    };
    vi.spyOn(client, "findTransaction").mockImplementation(async () =>
      structuredClone(transaction),
    );
    let marker: unknown;
    vi.spyOn(client, "sendRefund").mockImplementation(async () => {
      marker = suite.db.all(sql`select state, external_ref, reconcile_remediated_at from payments`);
      return { httpStatus: 201 };
    });
    const audit = new SumUpReconciler({
      db: suite.db,
      resolveClient: async () => client,
      incidents: captureAlerts.raise,
      heldAlerts,
    });
    const result = await audit.reconcile(period, now);
    expect(marker).toEqual([
      {
        state: "captured",
        external_ref: "orphan-charge",
        reconcile_remediated_at: now.toISOString(),
      },
    ]);
    expect(result.checked).toBe(1);
    expect(result.missingLocal).toEqual([]);
    expect(result.orphan.map((row) => row.paymentRef)).toEqual(["lost-orphan"]);
    expect(result.remediated).toBe(0);
    expect(result.remediationUnconfirmed).toEqual(["lost-orphan"]);
    expect(client.sendRefund).toHaveBeenCalledExactlyOnceWith({
      transactionId: "orphan-charge",
      amount: "10.00",
    });
    expect(
      suite.db.all(
        sql`select id, node_id, amount, source, device_id, reader_id, working_order_id from payments`,
      ),
    ).toEqual(before);
    transaction.refundEvents.push({
      id: "refund-1",
      status: "REFUNDED",
      amount: decimal("10.00"),
      timestamp: "2026-07-26T13:00:00.000Z",
    });
    vi.spyOn(client, "historyPage").mockRejectedValue(new Error("history unavailable"));
    const later = { from: new Date("2026-07-26T00:00:00Z"), to: new Date("2026-07-27T00:00:00Z") };
    await expect(audit.reconcile(later, later.to)).rejects.toThrow("history unavailable");
    await expect(audit.reconcile(later, later.to)).rejects.toThrow("history unavailable");
    expect(client.sendRefund).toHaveBeenCalledTimes(1);
    expect(suite.db.all(sql`select state, settled_at from payments`)).toEqual([
      { state: "refunded", settled_at: "2026-07-01T12:03:00.000Z" },
    ]);
    expect(
      suite.db.all(sql`select amount, provider_refund_ref, created_at from payment_refunds`),
    ).toEqual([
      { amount: 1000, provider_refund_ref: "refund-1", created_at: "2026-07-26T13:00:00.000Z" },
    ]);
  });
});

it.each([
  { change: "no reference", allowed: false },
  { change: "wrong reference", allowed: false },
  { change: "different amount", allowed: false },
  { change: "missing events", allowed: false },
  { change: "pending refund", allowed: false },
  { change: "partial refund", allowed: false },
  { change: "failed refund", allowed: false },
  { change: "invalid evidence", allowed: false },
  { change: "closed clock", allowed: false },
  { change: "refused transaction", allowed: false },
  { change: "valid empty events", allowed: true },
])("$change controls the abandoned refund before claiming", async ({ change, allowed }) => {
  const seeded = await failedPayment("limits");
  await suite.db.execute(
    sql`update working_orders set status = 'abandoned' where id = ${seeded.workingOrderId}`,
  );
  const client = new FakeSumUp();
  const t = {
    id: "limit-charge",
    foreignTransactionId: "limits",
    status: "SUCCESSFUL",
    amount: decimal(change === "different amount" ? "9.00" : "10.00"),
    currency: "EUR",
    timestamp: "2026-07-01T12:00:00Z",
    refundEvents: [] as {
      id: string;
      status: string;
      amount: ReturnType<typeof decimal>;
      timestamp: string;
    }[],
    refundEvidenceInvalid: change === "invalid evidence",
  };
  if (change === "no reference")
    delete (t as { foreignTransactionId?: string }).foreignTransactionId;
  if (change === "wrong reference") t.foreignTransactionId = "reader-outside";
  if (change === "missing events") delete (t as { refundEvents?: unknown }).refundEvents;
  if (["pending refund", "partial refund", "failed refund"].includes(change))
    t.refundEvents.push({
      id: "existing-refund",
      status:
        change === "pending refund"
          ? "PENDING"
          : change === "failed refund"
            ? "FAILED"
            : "REFUNDED",
      amount: decimal("4.00"),
      timestamp: "2026-07-02T12:00:00Z",
    });
  vi.spyOn(client, "findTransaction").mockImplementation(async () => structuredClone(t));
  const result = await new SumUpReconciler({
    db: suite.db,
    resolveClient: async () => client,
    incidents: captureAlerts.raise,
    heldAlerts,
    reconcileMoney: {
      paused: async () => change === "closed clock",
      admit: async () => change !== "refused transaction",
    },
  })
    .reconcile(period, now)
    .catch((error) => {
      if (change !== "wrong reference") throw error;
    });
  if (change === "closed clock" || change === "refused transaction")
    expect(result?.resweepAfter).toEqual(new Date("2026-07-26T00:00:00Z"));
  expect(client.sendRefundCalls).toEqual(
    allowed ? [{ transactionId: "limit-charge", amount: "10.00" }] : [],
  );
  expect(
    suite.db.all<{ mark: string | null }>(
      sql`select reconcile_remediated_at as mark from payments`,
    )[0]!.mark,
  ).toBe(allowed ? now.toISOString() : null);
});

it.each([
  "missing events",
  "pending refund",
  "partial refund",
  "failed refund",
  "different currency",
  "paused",
  "transaction refused",
  "timeout",
  "server error",
  "definite refusal",
  "crash before send",
])("keeps a claimed %s outcome visible without resending", async (change) => {
  const seeded = await failedPayment("marked");
  await suite.db.execute(
    sql`update working_orders set status = 'abandoned' where id = ${seeded.workingOrderId}`,
  );
  const client = new FakeSumUp();
  let claimed = false;
  let admitCalls = 0;
  vi.spyOn(client, "findTransaction").mockImplementation(async () => {
    const marker = suite.db.all<{ mark: string | null }>(
      sql`select reconcile_remediated_at as mark from payments`,
    )[0]!.mark;
    claimed ||= marker !== null;
    return {
      id: "marked-charge",
      foreignTransactionId: "marked",
      status: "SUCCESSFUL",
      amount: decimal("10.00"),
      currency: claimed && change === "different currency" ? "USD" : "EUR",
      timestamp: "2026-07-01T12:00:00Z",
      ...(claimed && change === "missing events"
        ? {}
        : {
            refundEvents:
              claimed && ["pending refund", "partial refund", "failed refund"].includes(change)
                ? [
                    {
                      id: "r-pending",
                      status:
                        change === "pending refund"
                          ? "PENDING"
                          : change === "failed refund"
                            ? "FAILED"
                            : "REFUNDED",
                      amount: decimal("4.00"),
                      timestamp: "2026-07-25T10:00:00Z",
                    },
                  ]
                : [],
          }),
    };
  });
  const send = vi.spyOn(client, "sendRefund").mockImplementation(async () => {
    if (change === "timeout") throw new Error("timeout");
    return {
      httpStatus: change === "server error" ? 500 : change === "definite refusal" ? 400 : 201,
    };
  });
  const audit = new SumUpReconciler({
    db: suite.db,
    resolveClient: async () => client,
    incidents: captureAlerts.raise,
    heldAlerts,
    reconcileMoney: {
      paused: async () => claimed && change === "paused",
      admit: async () => {
        admitCalls++;
        if (admitCalls > 1 && change === "crash before send") throw new Error("crash");
        return !(admitCalls > 1 && change === "transaction refused");
      },
    },
  });
  const result = await audit.reconcile(period, now);
  const sends = ["timeout", "server error", "definite refusal"].includes(change) ? 1 : 0;
  expect(send).toHaveBeenCalledTimes(sends);
  expect(result.remediated).toBe(0);
  if (change === "definite refusal" || change === "crash before send")
    expect(result.remediationFailures).toEqual([{ paymentRef: "marked", reason: "unknown" }]);
  else expect(result.remediationUnconfirmed).toEqual(["marked"]);
  if (change === "different currency")
    await expect(audit.reconcile(period, now)).rejects.toMatchObject({
      code: "payment.audit_incomplete",
    });
  else await audit.reconcile(period, now);
  expect(send).toHaveBeenCalledTimes(sends);
  expect(suite.db.all(sql`select state from payments`)).toEqual([{ state: "captured" }]);
});

it("two sweeps claim a captured orphan once", async () => {
  const seeded = await seedWorkingOrder(suite.db, freshNif());
  await withTransaction(suite.db, (tx) =>
    insertCapturedPayment(tx, {
      provider: "sumup",
      paymentRef: "race",
      externalRef: "race-charge",
      amount: decimal("10.00"),
      settledAt: period.from,
      workingOrderId: seeded.workingOrderId,
      nodeId: seeded.nodeId,
      origin: deviceOrigin(seeded.deviceId),
    }),
  );
  await suite.db.execute(
    sql`update working_orders set status = 'abandoned' where id = ${seeded.workingOrderId}`,
  );
  const client = new FakeSumUp();
  vi.spyOn(client, "findTransaction").mockResolvedValue({
    id: "race-charge",
    foreignTransactionId: "race",
    amount: decimal("10.00"),
    status: "SUCCESSFUL",
    currency: "EUR",
    timestamp: period.from.toISOString(),
    refundEvents: [],
  });
  const deps = {
    db: suite.db,
    resolveClient: async () => client,
    incidents: captureAlerts.raise,
    heldAlerts,
  };
  const results = await Promise.all([
    new SumUpReconciler(deps).reconcile(period, now),
    new SumUpReconciler(deps).reconcile(period, now),
  ]);
  expect(client.sendRefundCalls).toEqual([{ transactionId: "race-charge", amount: "10.00" }]);
  expect(
    results.reduce((total, result) => total + (result.remediationUnconfirmed?.length ?? 0), 0),
  ).toBe(1);
  expect(suite.db.all(sql`select state from payments`)).toEqual([{ state: "captured" }]);
});

it("records an already completed full refund without sending, and checks admission after its lookup", async () => {
  const seeded = await failedPayment("already-returned");
  await suite.db.execute(
    sql`update working_orders set status = 'abandoned' where id = ${seeded.workingOrderId}`,
  );
  const client = new FakeSumUp();
  let permit = true;
  let freezeAfterClaim = true;
  vi.spyOn(client, "findTransaction").mockImplementation(async () => {
    if (
      freezeAfterClaim &&
      suite.db.all<{ mark: string | null }>(
        sql`select reconcile_remediated_at as mark from payments`,
      )[0]!.mark !== null
    )
      permit = false;
    return {
      id: "returned-charge",
      foreignTransactionId: "already-returned",
      amount: decimal("10.00"),
      status: "SUCCESSFUL",
      currency: "EUR",
      timestamp: period.from.toISOString(),
      refundEvents: [
        {
          id: "r-complete",
          status: "REFUNDED",
          amount: decimal("10.00"),
          timestamp: "2026-07-25T12:00:00Z",
        },
      ],
    };
  });
  const audit = new SumUpReconciler({
    db: suite.db,
    resolveClient: async () => client,
    incidents: captureAlerts.raise,
    heldAlerts,
    reconcileMoney: { paused: async () => false, admit: async () => permit },
  });
  const first = await audit.reconcile(period, now);
  expect(first.remediationUnconfirmed).toEqual(["already-returned"]);
  expect(suite.db.all(sql`select * from payment_refunds`)).toEqual([]);
  freezeAfterClaim = false;
  permit = true;
  await audit.reconcile(period, now);
  await audit.reconcile(period, now);
  expect(suite.db.all(sql`select state from payments`)).toEqual([{ state: "refunded" }]);
  expect(suite.db.all(sql`select provider_refund_ref from payment_refunds`)).toEqual([
    { provider_refund_ref: "r-complete" },
  ]);
  expect(client.sendRefundCalls).toEqual([]);
});

it("leaves a captured orphan with an existing partial provider refund unclaimed", async () => {
  const seeded = await seedWorkingOrder(suite.db, freshNif());
  await withTransaction(suite.db, (tx) =>
    insertCapturedPayment(tx, {
      provider: "sumup",
      paymentRef: "partial-orphan",
      externalRef: "partial-charge",
      amount: decimal("10.00"),
      settledAt: period.from,
      workingOrderId: seeded.workingOrderId,
      nodeId: seeded.nodeId,
      origin: deviceOrigin(seeded.deviceId),
    }),
  );
  await suite.db.execute(
    sql`update working_orders set status = 'abandoned' where id = ${seeded.workingOrderId}`,
  );
  const client = new FakeSumUp();
  vi.spyOn(client, "findTransaction").mockResolvedValue({
    id: "partial-charge",
    foreignTransactionId: "partial-orphan",
    amount: decimal("10.00"),
    status: "SUCCESSFUL",
    currency: "EUR",
    timestamp: period.from.toISOString(),
    refundEvents: [
      {
        id: "partial-r",
        status: "REFUNDED",
        amount: decimal("4.00"),
        timestamp: "2026-07-02T12:00:00Z",
      },
    ],
  });
  const result = await new SumUpReconciler({
    db: suite.db,
    resolveClient: async () => client,
    incidents: captureAlerts.raise,
    heldAlerts,
  }).reconcile(period, now);
  expect(result.orphan.map((row) => row.paymentRef)).toEqual(["partial-orphan"]);
  expect(suite.db.all(sql`select state, reconcile_remediated_at from payments`)).toEqual([
    { state: "captured", reconcile_remediated_at: null },
  ]);
  expect(client.sendRefundCalls).toEqual([]);
});
