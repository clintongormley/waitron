import { eq } from "drizzle-orm";
import { expect, it } from "vitest";
import { adjustments } from "@waitron/adjustments";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { decimalToCents } from "@waitron/shared";
import { crystalliseBillDiscounts } from "./bill-discounts-crystallise.js";
import { readBillDiscounts } from "./bill-discounts-read.js";
import { priceStoredOrder, storedOrderTotal } from "./stored-order-lines.js";
import { holdDiscount } from "./testing/bill-discounts.js";
import { COMP_BILL_REASON, reasonIdOf } from "./testing/cancel-line.js";
import type { AdjustmentVenue } from "./testing/adjustment-venue.js";
import { inTx } from "./testing/party-venue.js";
import {
  setupSetMenuSpecVenue,
  specBill,
  type SpecVenue,
} from "./testing/set-menu-spec-fixture.js";

let spec: SpecVenue;
useVenueDb({
  migrations: migrationOptionsFor(manifestSets(), null),
  resetPerTest: false,
  setup: async (db) => {
    spec = await setupSetMenuSpecVenue(db);
  },
});

it("writes a set menu's discount on its row and the dishes it covers, recorded on the row", async () => {
  const { venue } = spec;
  const bill = await specBill(spec, "fire");
  const row = bill.daily[0]!;
  await inTx(venue, async (tx) => {
    const reason = await reasonIdOf(tx, COMP_BILL_REASON);
    await holdDiscount(
      tx,
      {
        reasonId: { complaint: reason } as AdjustmentVenue["reasonId"],
        staffId: venue.operator.personId,
      },
      {
        workingOrderId: bill.tabId,
        setMenuId: spec.daily.menuId,
        setMenuName: "Daily menu",
        setMenuLineId: row,
      },
    );
  });
  const seen = await inTx(venue, async (tx) => {
    const shown = (await readBillDiscounts(tx, [bill.tabId])).get(bill.tabId)!;
    const before = decimalToCents((await priceStoredOrder(tx, bill.tabId)).total);
    const owedBefore = decimalToCents(await storedOrderTotal(tx, bill.tabId));
    await crystalliseBillDiscounts(tx, venue.cfg, bill.tabId, { asked: true });
    return {
      shown,
      owedBefore: before - owedBefore,
      owedAfter: before - decimalToCents(await storedOrderTotal(tx, bill.tabId)),
      fell: before - decimalToCents((await priceStoredOrder(tx, bill.tabId)).total),
      written: await tx
        .select({ lineId: adjustments.lineId, reduction: adjustments.reduction })
        .from(adjustments)
        .where(eq(adjustments.workingOrderId, bill.tabId)),
    };
  });
  expect(seen.shown.discounts[0]!.holds).toBe("yes");
  expect(seen.shown.takes).toBeGreaterThan(0);
  expect(seen.fell).toBe(seen.shown.takes);
  expect(seen.owedBefore).toBe(seen.shown.takes);
  expect(seen.owedAfter).toBe(seen.shown.takes);
  expect(seen.written).toEqual([{ lineId: row, reduction: seen.shown.takes }]);
});
