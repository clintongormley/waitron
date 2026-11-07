import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { CORE_MIGRATIONS, incidents, withTransaction } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { markIncidentHandled, recordIncidentOnce } from "@waitron/core";
import { decimal } from "@waitron/shared";
import { hasCaptureMismatch, recordCaptureMismatch } from "./capture-mismatch.js";

const suite = useVenueDb({ migrations: [CORE_MIGRATIONS] });
const sink = { raise: recordIncidentOnce, handle: markIncidentHandled };
const now = new Date("2026-11-07T03:00:00.000Z");
const mismatch = (paymentRef: string, provider = "stripe") => ({
  provider,
  paymentRef,
  workingOrderId: `order-${paymentRef}`,
  externalRef: `external-${paymentRef}`,
  requestedAmount: decimal("12.10"),
  reportedAmount: decimal("0.00"),
});
function record(paymentRef: string, provider = "stripe") {
  return withTransaction(suite.db, (tx) =>
    recordCaptureMismatch(tx, sink, mismatch(paymentRef, provider), now),
  );
}
function known(paymentRef: string, provider = "stripe") {
  return withTransaction(suite.db, (tx) => hasCaptureMismatch(tx, { provider, paymentRef }));
}
function alerts() {
  return suite.db.select().from(incidents).where(eq(incidents.code, "payment.capture_mismatch"));
}

describe("capture mismatch evidence", () => {
  it("retains both exact figures including zero, once per provider and payment", async () => {
    expect(await known("p1")).toBe(false);
    expect(await record("p1")).toBe(true);
    expect(await record("p1")).toBe(false);
    expect(await known("p1")).toBe(true);
    expect(await known("p1", "sumup")).toBe(false);
    const rows = await alerts();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      severity: "error",
      source: "payment_check",
      acknowledgedAt: null,
      params: { payments: [mismatch("p1")] },
    });
  });

  it("preserves the first open payment when a second replaces the immutable alert", async () => {
    await record("p1");
    await record("p2", "sumup");
    const rows = await alerts();
    expect(rows).toHaveLength(2);
    expect(rows.find((row) => row.acknowledgedAt === null)?.params).toEqual({
      payments: [mismatch("p1"), mismatch("p2", "sumup")],
    });
    expect(rows.filter((row) => row.acknowledgedAt !== null)).toHaveLength(1);
  });

  it("finds old handled snapshots after a newer open alert no longer names that payment", async () => {
    await record("p1");
    const [first] = await alerts();
    await withTransaction(suite.db, (tx) =>
      markIncidentHandled(tx, { id: first!.id, personId: null, handledAt: now }),
    );
    await record("p2");
    await record("p3");
    expect(await known("p1")).toBe(true);
    expect(await known("p2")).toBe(true);
    expect(await known("p3")).toBe(true);
    expect(await record("p1")).toBe(false);
    expect(await alerts()).toHaveLength(3);
  });

  it("serialises concurrent detections without losing either payment", async () => {
    expect(await Promise.all([record("p1"), record("p2")])).toEqual([true, true]);
    const open = (await alerts()).filter((row) => row.acknowledgedAt === null);
    expect(open).toHaveLength(1);
    expect(open[0]!.params).toEqual({ payments: [mismatch("p1"), mismatch("p2")] });
  });
});
