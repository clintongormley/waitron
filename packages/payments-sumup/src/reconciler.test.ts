import { describe, expect, it, vi } from "vitest";
import { sql } from "drizzle-orm";
import { CORE_MIGRATIONS, withTransaction } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { decimal, deviceOrigin } from "@waitron/shared";
import { PAYMENTS_MIGRATIONS, insertCapturedPayment, insertFailedPayment } from "@waitron/payments";
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
  ])(
    "keeps $competing candidates separate without changing money",
    async ({ competing, matched, unmatched }) => {
      const seeded = await seedWorkingOrder(suite.db, freshNif());
      const manualAt = "2026-07-01T23:58:00.000Z";
      const manual = async (ref: string) =>
        withTransaction(suite.db, (tx) =>
          insertCapturedPayment(tx, {
            provider: "manual",
            paymentRef: ref,
            amount: decimal("10.25"),
            origin: deviceOrigin(seeded.deviceId),
            nodeId: seeded.nodeId,
            workingOrderId: seeded.workingOrderId,
            settledAt: new Date(manualAt),
            externalRef: "operation-7",
            externalMachine: "Backup Solo",
            externalProvider: competing === "other provider" ? "other" : "connected_account",
          }),
        );
      await manual("backup");
      if (competing === "manual") await manual("second-entry");
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
            competing === "late" ? "2026-07-01T23:50:00Z" : "2026-07-01T23:57:00Z",
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
      expect(result.backupUnmatched).toHaveLength(unmatched);
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
    expect(result.backupUnmatched).toEqual([]);
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
