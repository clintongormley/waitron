import { and, eq } from "drizzle-orm";
import { workingOrderLines, type Database } from "@waitron/db";
import { inTx, order, seatWithNoAllergies, setupPartyVenue } from "./party-venue.js";
import { seedBillSetMenu, setMenuOnFullMenu } from "./set-menu-bill-fixture.js";

export async function setupSetMenuReaders(db: Database) {
  const venue = await setupPartyVenue(db);
  const copy = await inTx(venue, (tx) =>
    setMenuOnFullMenu(tx, venue.tables.menuId, venue.productId("Flan")),
  );
  return { venue, copy };
}

export async function setMenuBill({
  venue,
  copy,
}: Awaited<ReturnType<typeof setupSetMenuReaders>>) {
  const tableId = await venue.table(crypto.randomUUID());
  const { tabId: billId, partyId } = await seatWithNoAllergies(venue, tableId);
  const menuLineId = await inTx(venue, (tx) => seedBillSetMenu(tx, billId, copy, 1));
  await order(venue, billId, "Flan");
  const [{ id: dishId }] = await inTx(venue, (tx) =>
    tx
      .update(workingOrderLines)
      .set({
        menuItemId: copy.menuItemId,
        setMenuRole: "dish",
        setMenuId: copy.menuId,
        setMenuLineId: menuLineId,
        setMenuPlace: 0,
        setMenuCountsAsCourseId: copy.courseId,
        unitPriceGross: 0,
        lineTotal: 0,
      })
      .where(
        and(
          eq(workingOrderLines.workingOrderId, billId),
          eq(workingOrderLines.productId, copy.productId),
        ),
      )
      .returning({ id: workingOrderLines.id }),
  );
  return { tableId, billId, partyId, menuLineId, dishId };
}
