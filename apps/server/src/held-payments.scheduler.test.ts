import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { currentIncidentsOf, markIncidentHandled, recordIncidentOnce } from "@waitron/core";
import { persons, withTransaction, withFoldedPersonKeys } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import {
  DEFAULTS,
  insertCapturedPayment,
  listOpenHolds,
  recordHoldOutcome,
  refreshHeldAlert,
  runDue,
} from "@waitron/payments";
import type {
  HeldAlertSink,
  ReconcilePeriod,
  SettlementRecord,
  TickResult,
} from "@waitron/payments";
import { FakeReconciler } from "@waitron/payments/src/testing/fake-reconciler.js";
import { seedWorkingOrder } from "@waitron/payments/test/seed.js";
import { decimal, deviceOrigin, jobOrigin } from "@waitron/shared";
import { reconcilePassFor, reconcilerAsDuty } from "./reconcile-duty.js";

const suite = useVenueDb({ migrations: migrationOptionsFor(manifestSets(), null) });

const HELD = "payment.reconcile_held";
const JUL_1_NOON = new Date("2026-07-01T12:00:00Z");
const JUL_2_NOON = new Date("2026-07-02T12:00:00Z");

const heldAlerts: HeldAlertSink = {
  raise: recordIncidentOnce,
  current: currentIncidentsOf,
  handle: markIncidentHandled,
};

/** A card payment on an abandoned order, settled by the provider at a different amount. */
async function heldPayment(paymentRef: string, settledAt: Date): Promise<SettlementRecord> {
  const seeded = await seedWorkingOrder(suite.db, "B12345678");
  await withTransaction(suite.db, (tx) =>
    insertCapturedPayment(tx, {
      origin: deviceOrigin(seeded.deviceId),
      workingOrderId: seeded.workingOrderId,
      nodeId: seeded.nodeId,
      provider: "fake",
      paymentRef,
      externalRef: `ext-${paymentRef}`,
      amount: decimal("10.00"),
      settledAt,
    }),
  );
  await suite.db.execute(
    sql`update working_orders set status = 'abandoned' where id = ${seeded.workingOrderId}`,
  );
  return { references: [`ext-${paymentRef}`], amount: decimal("12.50"), settledAt };
}

/** A settlement report that answers `records`, or throws for a window `failing` picks. */
function reportOf(records: SettlementRecord[]) {
  const control: { failing: (window: ReconcilePeriod) => boolean } = { failing: () => false };
  const report = {
    fetch: (window: ReconcilePeriod) =>
      control.failing(window)
        ? Promise.reject(new Error("provider down"))
        : Promise.resolve(records),
  };
  return { report, control };
}

function scheduler(records: SettlementRecord[]) {
  const { report, control } = reportOf(records);
  const reconciler = new FakeReconciler(suite.db, report);
  const deps = { db: suite.db, duties: [reconcilerAsDuty(reconciler)], ...DEFAULTS };
  return { tick: (at: Date): Promise<TickResult> => runDue(deps, at), control, reconciler };
}

/** The payment references the open held-payments alert names, or null with no open alert. */
async function openAlertNames(): Promise<string[] | null> {
  const { rows } = await suite.db.execute<{ params: string }>(
    sql`select params from incidents where code = ${HELD} and acknowledged_at is null`,
  );
  if (rows.length === 0) return null;
  expect(rows).toHaveLength(1);
  const params = JSON.parse(rows[0]!.params) as { payments: { paymentRef: string }[] };
  return params.payments.map((payment) => payment.paymentRef).sort();
}

/** The days, among those the held payments settled on, with a re-check still waiting to run. */
async function pendingRechecks(): Promise<string[]> {
  const { rows } = await suite.db.execute<{ period_from: string }>(
    sql`select period_from from reconciliation_runs where state = 'pending' order by period_from`,
  );
  return rows
    .map((row) => new Date(row.period_from).toISOString().slice(0, 10))
    .filter((day) => day === "2026-07-01" || day === "2026-07-02");
}

async function handleOpenAlert(at: Date): Promise<void> {
  await withTransaction(suite.db, async (tx) => {
    const { open } = await currentIncidentsOf(tx, {
      origin: jobOrigin("payment_check"),
      code: HELD,
    });
    expect(open).not.toBeNull();
    await markIncidentHandled(tx, { id: open!.id, personId: null, handledAt: at });
  });
}

describe("held card payments on the real scheduler", () => {
  it("brings back every unresolved payment when a pass has no Stripe credential", async () => {
    const records = [await heldPayment("p1", JUL_1_NOON), await heldPayment("p2", JUL_2_NOON)];
    const { reconciler, tick } = scheduler(records);
    await tick(new Date("2026-07-02T06:00:00Z"));
    await tick(new Date("2026-07-03T06:00:00Z"));
    expect(await openAlertNames()).toEqual(["p1", "p2"]);
    await handleOpenAlert(new Date("2026-07-03T08:00:00Z"));

    const pass = reconcilePassFor({
      paymentsInstalled: true,
      duties: [{ duty: reconcilerAsDuty(reconciler), credentialPurpose: "payments.stripe" }],
      refreshHeld: (now: Date) =>
        withTransaction(suite.db, (tx) => refreshHeldAlert(tx, heldAlerts, { now, by: null })),
      onHeldRefreshFailure: (error: unknown) => {
        throw error;
      },
      credentialProvisioned: async () => false,
      runDue: async () => {
        throw new Error("No provider duty has a credential");
      },
    });
    expect((await pass(new Date("2026-07-04T06:00:00Z"))).ran).toEqual([]);
    expect(await openAlertNames()).toEqual(["p1", "p2"]);
  });

  it("recording the outcome of each ends the alert and the daily re-check", async () => {
    const records = [await heldPayment("p1", JUL_1_NOON), await heldPayment("p2", JUL_2_NOON)];
    const { tick } = scheduler(records);
    await tick(new Date("2026-07-02T04:00:00Z"));
    await tick(new Date("2026-07-03T04:00:00Z"));
    expect(await openAlertNames()).toEqual(["p1", "p2"]);
    expect(await pendingRechecks()).toEqual(["2026-07-01", "2026-07-02"]);

    const recordedAt = new Date("2026-07-03T09:00:00Z");
    const holds = await withTransaction(suite.db, (tx) => listOpenHolds(tx));
    expect(holds.map((hold) => hold.paymentRef).sort()).toEqual(["p1", "p2"]);
    for (const hold of holds) {
      await withTransaction(suite.db, async (tx) => {
        const personId = randomUUID();
        await tx
          .insert(persons)
          .values(withFoldedPersonKeys({ id: personId, displayName: "Manager " + personId }));
        await recordHoldOutcome(tx, {
          paymentId: hold.paymentId,
          outcome: "put_on_bill",
          note: null,
          personId,
          at: recordedAt,
        });
        await refreshHeldAlert(tx, heldAlerts, { now: recordedAt, by: personId });
      });
    }
    expect(await openAlertNames()).toBeNull();

    await tick(new Date("2026-07-04T04:00:00Z"));
    await tick(new Date("2026-07-05T04:00:00Z"));
    expect(await openAlertNames()).toBeNull();
    expect(await pendingRechecks()).toEqual([]);
  });

  it("a day whose check failed three times is checked again the next day and finds the held payment", async () => {
    const { tick, control } = scheduler([await heldPayment("p1", JUL_2_NOON)]);
    await tick(new Date("2026-07-02T04:00:00Z"));
    expect(await openAlertNames()).toBeNull();

    control.failing = () => true;
    const outcomes: string[] = [];
    for (let at = Date.parse("2026-07-03T04:00:00Z"), i = 0; i < 4; i++, at += 2 * 3_600_000) {
      const { ran } = await tick(new Date(at));
      outcomes.push(...ran.map((run) => run.outcome));
    }
    expect(outcomes).toEqual(["failed", "failed", "parked"]);
    expect(await openAlertNames()).toBeNull();

    control.failing = () => false;
    await tick(new Date("2026-07-03T23:00:00Z"));
    expect(await openAlertNames()).toBeNull();
    await tick(new Date("2026-07-04T12:00:00Z"));
    expect(await openAlertNames()).toEqual(["p1"]);
  });
});
