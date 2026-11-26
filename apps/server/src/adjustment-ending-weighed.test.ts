import { randomUUID } from "node:crypto";
import { asc, eq } from "drizzle-orm";
import { expect, it } from "vitest";
import { endAdjustment } from "@waitron/adjustments";
import { adjustments, workingOrders } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { applyAdjustment } from "./adjustments-apply.js";
import { readBillEditState } from "./bill-editing.js";
import {
  billWith,
  inTx,
  provisionAdjustmentVenue,
  rowsOf,
  type AdjustmentVenue,
} from "./testing/adjustment-venue.js";
import { testTradingAdmission } from "./testing/trading-admission.js";

let venue: AdjustmentVenue;
useVenueDb({
  resetPerTest: false,
  migrations: migrationOptionsFor(manifestSets(), null),
  timeoutMs: 60_000,
  setup: async (db) => {
    venue = await provisionAdjustmentVenue(db);
  },
});

/** `percentBp` off the bill's Ham, as the comp window gives it. */
function percentOff(billId: string, lineId: string, percentBp: number) {
  return inTx(venue, async (tx) => {
    const [order] = await tx
      .select({ revision: workingOrders.revision })
      .from(workingOrders)
      .where(eq(workingOrders.id, billId));
    return applyAdjustment(
      tx,
      venue.cfg,
      {
        orderId: billId,
        expectedEdit: await readBillEditState(tx, billId),
        submissionId: randomUUID(),
        expectedRevision: order!.revision,
        lineId,
        reasonId: venue.reasonId.house,
        note: null,
        operatorId: venue.supervisorId,
        admission: testTradingAdmission(),
        action: "discount_percent",
        percentBp,
      },
      venue.venueLocale,
    );
  });
}

async function ham(billId: string) {
  const { unitPriceGross, lineTotal, listUnitPriceGross } = (await rowsOf(venue, billId)).find(
    ({ name }) => name === "Ham",
  )!;
  return { unitPriceGross, lineTotal, listUnitPriceGross };
}

/** Ham (24.00 a kilo) by weight, given `first` and then `second` percent off. */
async function hamTwiceDiscounted(kilos: string, first: number, second: number) {
  const { billId } = await billWith(venue, [{ name: "Ham", quantity: kilos }]);
  const lineId = (await rowsOf(venue, billId)).find(({ name }) => name === "Ham")!.id;
  const start = await ham(billId);
  await percentOff(billId, lineId, first);
  const afterFirst = await ham(billId);
  await percentOff(billId, lineId, second);
  const [one, two] = await venue.db
    .select({ id: adjustments.id, reduction: adjustments.reduction })
    .from(adjustments)
    .where(eq(adjustments.workingOrderId, billId))
    .orderBy(asc(adjustments.createdAt));
  const end = (adjustmentId: string) =>
    inTx(venue, (tx) =>
      endAdjustment(tx, {
        adjustmentId,
        workingOrderId: billId,
        why: "extras_changed",
        dishName: "Ham",
        lineId,
      }),
    );
  return { billId, start, afterFirst, first: one!, second: two!, end };
}

// Each pair below came back a cent off when the unit price was rebuilt from what was taken off a
// kilo (21.59 and 2.66 for the first).
it.each([
  {
    kilos: "0.123",
    first: 1000,
    second: 1000,
    back: { unitPriceGross: "21.58", lineTotal: "2.65" },
  },
  {
    kilos: "0.217",
    first: 700,
    second: 3300,
    back: { unitPriceGross: "22.37", lineTotal: "4.85" },
  },
  {
    kilos: "0.503",
    first: 700,
    second: 3300,
    back: { unitPriceGross: "22.33", lineTotal: "11.23" },
  },
])(
  "gives $kilos kg of Ham back exactly what its second discount took, then its list price",
  async ({ kilos, first, second, back }) => {
    const ham2 = await hamTwiceDiscounted(kilos, first, second);
    expect(ham2.afterFirst).toMatchObject(back);

    await ham2.end(ham2.second.id);
    expect(await ham(ham2.billId)).toEqual({ ...back, listUnitPriceGross: "24.00" });

    await ham2.end(ham2.first.id);
    expect(await ham(ham2.billId)).toEqual({ ...ham2.start, listUnitPriceGross: null });
  },
);

it("gives 0.123 kg of Ham back what its first discount took while the second still stands", async () => {
  const ham2 = await hamTwiceDiscounted("0.123", 1000, 1000);

  await ham2.end(ham2.first.id);

  const left = await ham(ham2.billId);
  expect(Math.round(Number(left.lineTotal) * 100)).toBe(
    Math.round(Number(ham2.start.lineTotal) * 100) - ham2.second.reduction,
  );
  expect(Math.round((Math.round(Number(left.unitPriceGross) * 100) * 123) / 1000)).toBe(
    Math.round(Number(left.lineTotal) * 100),
  );
  expect(left.listUnitPriceGross).toBe("24.00");
});
