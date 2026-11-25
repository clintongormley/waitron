import { and, eq } from "drizzle-orm";
import { workingOrderLines, type Database } from "@waitron/db";
import { fireLines, unsentDishLines } from "../working-order-kitchen-fire.js";
import { inTx, seatWithNoAllergies, setupPartyVenue } from "./party-venue.js";
import { addPortionRound } from "./portion-bill.js";
import { seedBillSetMenu, setMenuOnFullMenu } from "./set-menu-bill-fixture.js";

export async function setupSetMenuReaders(db: Database) {
  const venue = await setupPartyVenue(db);
  const copy = await inTx(venue, (tx) =>
    setMenuOnFullMenu(tx, venue.tables.menuId, venue.productId("Flan")),
  );
  return { venue, copy };
}

export async function setMenuBill(
  { venue, copy }: Awaited<ReturnType<typeof setupSetMenuReaders>>,
  { send = true }: { send?: boolean } = {},
) {
  const tableId = await venue.table(crypto.randomUUID());
  const { tabId: billId, partyId } = await seatWithNoAllergies(venue, tableId);
  const { menuLineId, dishId } = await inTx(venue, async (tx) => {
    // Sent first: a send works out the bill's set menus, and would remove an empty one.
    const [{ lineId: dishId }] = await addPortionRound(tx, venue.cfg, billId, [
      { menuItemId: venue.item("Flan"), quantity: "1" },
    ]);
    const [grouped] = await tx
      .select({ id: workingOrderLines.id })
      .from(workingOrderLines)
      .where(
        and(
          eq(workingOrderLines.workingOrderId, billId),
          eq(workingOrderLines.setMenuRole, "set_menu"),
        ),
      );
    // Where Flan is dearer a la carte, the send already put it in a Daily: number that 1, Flan 2.
    if (grouped !== undefined) {
      await tx.update(workingOrderLines).set({ lineNo: 3 }).where(eq(workingOrderLines.id, dishId));
      await tx
        .update(workingOrderLines)
        .set({ lineNo: 1 })
        .where(eq(workingOrderLines.id, grouped.id));
      await tx.update(workingOrderLines).set({ lineNo: 2 }).where(eq(workingOrderLines.id, dishId));
      if (send) await fireLines(tx, venue.cfg, billId, await unsentDishLines(tx, billId));
      return { menuLineId: grouped.id, dishId };
    }
    await tx.update(workingOrderLines).set({ lineNo: 2 }).where(eq(workingOrderLines.id, dishId));
    const menuLineId = await seedBillSetMenu(tx, billId, copy, 1);
    await tx
      .update(workingOrderLines)
      .set({
        menuItemId: copy.menuItemId,
        setMenuRole: "dish",
        setMenuId: copy.menuId,
        setMenuLineId: menuLineId,
        setMenuPlace: 0,
        unitPriceGross: 0,
        lineTotal: 0,
      })
      .where(eq(workingOrderLines.id, dishId));
    if (send) await fireLines(tx, venue.cfg, billId, await unsentDishLines(tx, billId));
    return { menuLineId, dishId };
  });
  return { tableId, billId, partyId, menuLineId, dishId };
}
