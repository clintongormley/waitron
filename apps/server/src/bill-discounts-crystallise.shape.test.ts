import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { centsToDecimal, decimalToCents } from "@waitron/shared";
import { applyAdjustment, type AdjustmentAsk } from "./adjustments-apply.js";
import { readBillEditState } from "./bill-editing.js";
import { crystalliseBillDiscounts } from "./bill-discounts-crystallise.js";
import { holdDiscount, writtenAdjustments } from "./testing/bill-discounts.js";
import {
  billWith,
  inTx,
  lineIdOf,
  provisionAdjustmentVenue,
  type AdjustmentVenue,
  type RoundLine,
} from "./testing/adjustment-venue.js";
import { testTradingAdmission } from "./testing/trading-admission.js";
import { readOrderRevision } from "./working-order-context.js";

let venue: AdjustmentVenue;
useVenueDb({
  resetPerTest: false,
  migrations: migrationOptionsFor(manifestSets(), null),
  timeoutMs: 60_000,
  setup: async (db) => {
    venue = await provisionAdjustmentVenue(db);
  },
});

type Terms = Pick<AdjustmentAsk, "action" | "percentBp" | "amount">;

/** Gives `terms` on `lineId` (the whole bill when null) of `billId` through `applyAdjustment`. */
async function applyOn(billId: string, lineId: string | null, terms: Terms) {
  await inTx(venue, async (tx) =>
    applyAdjustment(
      tx,
      venue.cfg,
      {
        orderId: billId,
        expectedEdit: await readBillEditState(tx, billId),
        expectedRevision: await readOrderRevision(tx, billId),
        lineId,
        reasonId: venue.reasonId.complaint,
        note: "Cold",
        operatorId: venue.staffId,
        submissionId: randomUUID(),
        admission: testTradingAdmission(),
        ...terms,
      },
      venue.venueLocale,
    ),
  );
}

/**
 * Gives `terms` on line `lineNo` (the whole bill when null) of one bill through today's
 * `applyAdjustment`, and holds the same discount, under the record's reason, people and note, on
 * a second bill of `lines` that is then crystallised; `earlier`, when given, is applied to both
 * bills first. Answers both bills' records and the second bill's revision before and after.
 */
async function bothWays(
  lines: RoundLine[],
  lineNo: number | null,
  terms: Terms,
  earlier?: { lineNo: number; terms: Terms },
) {
  const applied = await billWith(venue, lines, { shape: "grouped" });
  const held = await billWith(venue, lines, { shape: "grouped" });
  const lineOf = (billId: string) => (lineNo === null ? null : lineIdOf(venue, billId, lineNo));
  for (const { billId } of earlier === undefined ? [] : [applied, held]) {
    await applyOn(billId, await lineIdOf(venue, billId, earlier!.lineNo), earlier!.terms);
  }
  await applyOn(applied.billId, await lineOf(applied.billId), terms);
  const record = (await inTx(venue, (tx) => writtenAdjustments(tx, applied.billId))).at(-1)!;
  const target = await lineOf(held.billId);
  const revisions = await inTx(venue, async (tx) => {
    await holdDiscount(tx, venue, {
      ...(target === null ? { workingOrderId: held.billId } : { lineId: target }),
      action: terms.action as "comp" | "discount_percent" | "discount_amount",
      percentBp: terms.percentBp ?? null,
      amount: terms.amount === undefined ? null : decimalToCents(terms.amount),
      reasonName: record.reasonName,
      policySnapshot: record.policySnapshot,
      requestedBy: record.requestedBy,
      approvedBy: record.approvedBy,
      note: record.note,
    });
    const before = await readOrderRevision(tx, held.billId);
    await crystalliseBillDiscounts(tx, venue.cfg, held.billId, { asked: true });
    return { before, after: await readOrderRevision(tx, held.billId) };
  });
  return {
    applied: await inTx(venue, (tx) => writtenAdjustments(tx, applied.billId)),
    crystallised: await inTx(venue, (tx) => writtenAdjustments(tx, held.billId)),
    revisions,
  };
}

describe("a crystallised discount's records", () => {
  it("equal what applyAdjustment writes for a dish's discount that splits its line", async () => {
    const seen = await bothWays([{ name: "Croquettes", quantity: "3" }, { name: "Bread" }], 1, {
      action: "discount_percent",
      percentBp: 1000,
    });
    expect(seen.applied[0]!.splits).not.toEqual([]);
    expect(seen.applied[0]!.lines).not.toEqual([]);
    expect(seen.crystallised).toEqual(seen.applied);
    expect(seen.revisions.after).toBeGreaterThan(seen.revisions.before);
  });

  it("equal what applyAdjustment writes for an amount off a dish with an extra", async () => {
    const seen = await bothWays([{ name: "Pizza", olives: 1 }], 1, {
      action: "discount_amount",
      amount: centsToDecimal(250),
    });
    expect(seen.applied[0]!.lines).toHaveLength(2);
    expect(seen.crystallised).toEqual(seen.applied);
  });

  it("equal what applyAdjustment writes for a whole-bill discount", async () => {
    const seen = await bothWays(
      [{ name: "Croquettes", quantity: "3" }, { name: "Bread" }, { name: "Salad" }],
      null,
      { action: "discount_amount", amount: centsToDecimal(500) },
    );
    expect(seen.applied[0]!.line).toBeNull();
    expect(seen.crystallised).toEqual(seen.applied);
    expect(seen.revisions.after).toBeGreaterThan(seen.revisions.before);
  });

  it("equal what applyAdjustment writes for a whole-bill discount after a dish's", async () => {
    const seen = await bothWays(
      [{ name: "Croquettes", quantity: "3" }, { name: "Bread" }],
      null,
      { action: "discount_percent", percentBp: 1000 },
      { lineNo: 2, terms: { action: "discount_amount", amount: centsToDecimal(100) } },
    );
    // The bread's list price is above its price now, so the record's nominal value is the higher.
    const last = seen.applied.at(-1)!;
    expect(last.nominalValue).toBeGreaterThan(last.beforeAmount);
    expect(seen.crystallised).toEqual(seen.applied);
  });
});
