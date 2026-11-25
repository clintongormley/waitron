import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { expect, it } from "vitest";
import { computeAdjustmentReport } from "@waitron/adjustments";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { addProducts, menuItems, requireMenuRoot } from "@waitron/menu";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { currentBusinessDay, resolveVenueClock } from "@waitron/reporting";
import { ensureOperator } from "./testing/cancel-line.js";
import { placeGroups } from "./testing/group-submit-fixture.js";
import { inTx, seatWithNoAllergies } from "./testing/party-venue.js";
import { publishWorkingMenu } from "./testing/publish-menu.js";
import {
  setupSetMenuSpecVenue,
  specBill,
  specRows,
  type SpecDish,
  type SpecVenue,
} from "./testing/set-menu-spec-fixture.js";

let spec: SpecVenue;
useVenueDb({
  migrations: migrationOptionsFor(manifestSets(), null),
  resetPerTest: false,
  setup: async (db) => {
    spec = await setupSetMenuSpecVenue(db);
    await inTx(spec.venue, async (tx) => {
      const menuId = spec.venue.tables.menuId;
      await addProducts(tx, await requireMenuRoot(tx, menuId), [
        spec.productIds.Soup,
        spec.productIds.Hake,
      ]);
      spec.daily.versionId = spec.special.versionId = await publishWorkingMenu(tx, menuId);
    });
  },
});

const MIA = "cccccccc-0000-4000-8000-0000000000a1";

/** The ordinary menu's offer of `dish`. */
async function ordinary(dish: SpecDish) {
  const [{ id }] = await spec.venue.db
    .select({ id: menuItems.id })
    .from(menuItems)
    .where(
      and(
        eq(menuItems.menuId, spec.venue.tables.menuId),
        eq(menuItems.productId, spec.productIds[dish]),
      ),
    );
  return id;
}

function placeHeld(bill: { partyId: string; tabId: string }, dish: SpecDish, operatorId: string) {
  const { venue } = spec;
  return inTx(venue, async (tx) =>
    placeGroups(tx, venue.cfg, bill.partyId, {
      operatorId,
      billId: bill.tabId,
      groups: [{ lines: [{ menuItemId: await ordinary(dish), quantity: "1" }], release: "hold" }],
    }),
  );
}

it("staff sales credit counts a set menu to whoever has its earliest dish", async () => {
  const { venue } = spec;
  await specBill(spec);
  await inTx(venue, (tx) => ensureOperator(tx, MIA));
  // Mia sends Soup; then the operator's Hake makes it a Daily menu, whose earliest dish is Mia's.
  const bill = await seatWithNoAllergies(venue, await venue.table(randomUUID()));
  await placeHeld(bill, "Soup", MIA);
  await placeHeld(bill, "Hake", venue.operator.personId);
  const menus = (await specRows(spec, bill.tabId)).filter(
    ({ setMenuRole }) => setMenuRole === "set_menu",
  );
  expect(
    menus.map(({ setMenuId, lineTotal, creditedTo }) => ({ setMenuId, lineTotal, creditedTo })),
  ).toEqual([{ setMenuId: spec.daily.menuId, lineTotal: 1400, creditedTo: MIA }]);

  const report = await inTx(venue, async (tx) => {
    const clock = await resolveVenueClock(tx, venue.cfg.nodeId);
    const day = currentBusinessDay(clock);
    return computeAdjustmentReport(tx, { ...clock, fromBusinessDay: day, toBusinessDay: day });
  });

  const sales = (personId: string) => report.people.find((row) => row.personId === personId)?.sales;
  expect(sales(venue.operator.personId)).toBe("72.00");
  expect(sales(MIA)).toBe("14.00");
  expect(report.overall.sales).toBe("86.00");
});
