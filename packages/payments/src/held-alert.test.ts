import { describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { CORE_MIGRATIONS, withTransaction } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { decimal, deviceOrigin } from "@waitron/shared";
import { currentIncidentsOf, markIncidentHandled, recordIncidentOnce } from "@waitron/core";
import { PAYMENTS_MIGRATIONS } from "./migrations.js";
import { getPaymentByRef, insertCapturedPayment } from "./store.js";
import { listOpenHolds, recordHold, recordHoldOutcome } from "./holds.js";
import { refreshHeldAlert } from "./held-alert.js";
import type { HeldAlertSink } from "./held-alert.js";
import { freshNif, seedWorkingOrder } from "../test/seed.js";

const suite = useVenueDb({ migrations: [CORE_MIGRATIONS, PAYMENTS_MIGRATIONS] });

const sink: HeldAlertSink = {
  raise: recordIncidentOnce,
  current: currentIncidentsOf,
  handle: markIncidentHandled,
};

const MANAGER = "22222222-2222-4222-8222-222222222222";
const SETTLED = new Date("2026-06-30T20:30:00.000Z");

let refCounter = 0;

async function aHeldPayment(foundAt: string, amount = "12.10", providerAmount = "11.95") {
  const { workingOrderId, deviceId } = await seedWorkingOrder(suite.db, freshNif());
  const paymentRef = `held-${++refCounter}`;
  await withTransaction(suite.db, async (tx) => {
    await insertCapturedPayment(tx, {
      origin: deviceOrigin(deviceId),
      workingOrderId,
      provider: "stripe",
      paymentRef,
      amount: decimal(amount),
      settledAt: SETTLED,
    });
    const paymentId = (await getPaymentByRef(tx, { provider: "stripe", paymentRef }))!.id;
    await recordHold(tx, {
      paymentId,
      providerAmount: decimal(providerAmount),
      foundAt: new Date(foundAt),
    });
  });
  return { paymentRef, workingOrderId, amount, providerAmount };
}

function refresh(now: string, by: string | null = null) {
  return withTransaction(suite.db, (tx) => refreshHeldAlert(tx, sink, { now: new Date(now), by }));
}

interface IncidentRow {
  id: string;
  source: string;
  code: string;
  severity: string;
  params: { count: number; payments: { paymentRef: string }[] };
  detectedAt: string;
  acknowledgedAt: string | null;
  acknowledgedBy: string | null;
}

async function incidentRows(): Promise<IncidentRow[]> {
  const { rows } = await suite.db.execute<{
    id: string;
    source: string;
    code: string;
    severity: string;
    params: string;
    detected_at: string;
    acknowledged_at: string | null;
    acknowledged_by: string | null;
  }>(
    sql`select id, source, code, severity, params, detected_at, acknowledged_at, acknowledged_by
        from incidents order by detected_at, acknowledged_at is null, acknowledged_at`,
  );
  return rows.map((row) => ({
    id: row.id,
    source: row.source,
    code: row.code,
    severity: row.severity,
    params: JSON.parse(row.params) as IncidentRow["params"],
    detectedAt: row.detected_at,
    acknowledgedAt: row.acknowledged_at,
    acknowledgedBy: row.acknowledged_by,
  }));
}

function openRows(rows: IncidentRow[]) {
  return rows.filter((row) => row.acknowledgedAt === null);
}

function refsOf(row: IncidentRow) {
  return row.params.payments.map((payment) => payment.paymentRef).sort();
}

async function handleOpen(at: string) {
  const [open] = openRows(await incidentRows());
  await withTransaction(suite.db, (tx) =>
    markIncidentHandled(tx, { id: open!.id, personId: MANAGER, handledAt: new Date(at) }),
  );
}

describe("refreshHeldAlert", () => {
  it("raises one alert naming every held payment, whatever day it was held", async () => {
    const first = await aHeldPayment("2026-07-01T01:00:00.000Z");
    const second = await aHeldPayment("2026-07-02T01:00:00.000Z", "20.00", "19.50");
    await refresh("2026-07-02T01:05:00.000Z");
    const rows = await incidentRows();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      source: "payment_check",
      code: "payment.reconcile_held",
      severity: "error",
      detectedAt: "2026-07-02T01:05:00.000Z",
      acknowledgedAt: null,
    });
    expect(rows[0]!.params).toEqual({
      count: 2,
      payments: [
        {
          paymentRef: first.paymentRef,
          workingOrderId: first.workingOrderId,
          amount: "12.10",
          providerAmount: "11.95",
        },
        {
          paymentRef: second.paymentRef,
          workingOrderId: second.workingOrderId,
          amount: "20.00",
          providerAmount: "19.50",
        },
      ],
    });
  });

  it("replaces an open alert when a payment is newly held", async () => {
    const first = await aHeldPayment("2026-07-01T01:00:00.000Z");
    await refresh("2026-07-01T01:05:00.000Z");
    const second = await aHeldPayment("2026-07-01T09:00:00.000Z");
    await refresh("2026-07-01T09:05:00.000Z");
    const rows = await incidentRows();
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      acknowledgedAt: "2026-07-01T09:05:00.000Z",
      acknowledgedBy: null,
    });
    expect(refsOf(rows[0]!)).toEqual([first.paymentRef]);
    expect(rows[1]!.acknowledgedAt).toBeNull();
    expect(rows[1]!.params.count).toBe(2);
    expect(refsOf(rows[1]!)).toEqual([first.paymentRef, second.paymentRef].sort());
  });

  it("replaces an alert twice at one instant and still finds the open one", async () => {
    const now = "2026-07-01T01:05:00.000Z";
    const first = await aHeldPayment("2026-07-01T01:00:00.000Z");
    await refresh(now);
    const second = await aHeldPayment("2026-07-01T01:01:00.000Z");
    await refresh(now);
    const third = await aHeldPayment("2026-07-01T01:02:00.000Z");
    await refresh(now);
    expect(await incidentRows()).toHaveLength(3);
    await refresh(now);
    const rows = await incidentRows();
    expect(rows).toHaveLength(3);
    const open = openRows(rows);
    expect(open).toHaveLength(1);
    expect(refsOf(open[0]!)).toEqual(
      [first.paymentRef, second.paymentRef, third.paymentRef].sort(),
    );
  });

  it("raises again the next UTC day after it was handled", async () => {
    const held = await aHeldPayment("2026-07-01T01:00:00.000Z");
    await refresh("2026-07-01T01:05:00.000Z");
    await handleOpen("2026-07-01T10:00:00.000Z");
    await refresh("2026-07-02T00:05:00.000Z");
    const rows = await incidentRows();
    expect(rows).toHaveLength(2);
    expect(rows[1]).toMatchObject({ detectedAt: "2026-07-02T00:05:00.000Z", acknowledgedAt: null });
    expect(refsOf(rows[1]!)).toEqual([held.paymentRef]);
  });

  it("does not raise again the same day after it was handled", async () => {
    await aHeldPayment("2026-07-01T01:00:00.000Z");
    await refresh("2026-07-01T01:05:00.000Z");
    await handleOpen("2026-07-01T10:00:00.000Z");
    await refresh("2026-07-01T23:59:59.999Z");
    const rows = await incidentRows();
    expect(rows).toHaveLength(1);
    expect(openRows(rows)).toHaveLength(0);
  });

  it("does not raise again the day it was handled, even when it was raised the day before", async () => {
    const held = await aHeldPayment("2026-07-01T00:00:00.000Z");
    await refresh("2026-07-01T00:05:00.000Z");
    await handleOpen("2026-07-02T15:00:00.000Z");
    await refresh("2026-07-02T16:00:00.000Z");
    expect(await incidentRows()).toHaveLength(1);
    await refresh("2026-07-03T00:05:00.000Z");
    const rows = await incidentRows();
    expect(rows).toHaveLength(2);
    expect(rows[1]).toMatchObject({ detectedAt: "2026-07-03T00:05:00.000Z", acknowledgedAt: null });
    expect(refsOf(rows[1]!)).toEqual([held.paymentRef]);
  });

  it("raises at once, the same day, for a payment the handled alert did not name", async () => {
    const first = await aHeldPayment("2026-07-01T01:00:00.000Z");
    await refresh("2026-07-01T01:05:00.000Z");
    await handleOpen("2026-07-01T10:00:00.000Z");
    const second = await aHeldPayment("2026-07-01T11:00:00.000Z");
    await refresh("2026-07-01T11:05:00.000Z");
    const rows = await incidentRows();
    expect(rows).toHaveLength(2);
    expect(rows[1]).toMatchObject({ detectedAt: "2026-07-01T11:05:00.000Z", acknowledgedAt: null });
    expect(refsOf(rows[1]!)).toEqual([first.paymentRef, second.paymentRef].sort());
  });

  it("closes the open alert when no held payment is left", async () => {
    await aHeldPayment("2026-07-01T01:00:00.000Z");
    await refresh("2026-07-01T01:05:00.000Z");
    await withTransaction(suite.db, async (tx) => {
      const [hold] = await listOpenHolds(tx);
      await recordHoldOutcome(tx, {
        holdId: hold!.holdId,
        outcome: "kept",
        note: null,
        personId: MANAGER,
        at: new Date("2026-07-01T12:00:00.000Z"),
      });
    });
    await refresh("2026-07-01T12:00:00.000Z", MANAGER);
    const rows = await incidentRows();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      acknowledgedAt: "2026-07-01T12:00:00.000Z",
      acknowledgedBy: MANAGER,
    });
  });

  it("marks a replaced alert handled by the person given", async () => {
    const first = await aHeldPayment("2026-07-01T01:00:00.000Z");
    await aHeldPayment("2026-07-01T01:01:00.000Z");
    await refresh("2026-07-01T01:05:00.000Z");
    await withTransaction(suite.db, async (tx) => {
      const holds = await listOpenHolds(tx);
      const second = holds.find((hold) => hold.paymentRef !== first.paymentRef)!;
      await recordHoldOutcome(tx, {
        holdId: second.holdId,
        outcome: "refunded_at_provider",
        note: null,
        personId: MANAGER,
        at: new Date("2026-07-01T12:00:00.000Z"),
      });
    });
    await refresh("2026-07-01T12:00:00.000Z", MANAGER);
    const rows = await incidentRows();
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      acknowledgedAt: "2026-07-01T12:00:00.000Z",
      acknowledgedBy: MANAGER,
    });
    expect(rows[1]!.acknowledgedAt).toBeNull();
    expect(rows[1]!.params.count).toBe(1);
    expect(refsOf(rows[1]!)).toEqual([first.paymentRef]);
  });

  it("raises nothing when no payment is held", async () => {
    await refresh("2026-07-01T01:05:00.000Z");
    expect(await incidentRows()).toEqual([]);
  });
});
