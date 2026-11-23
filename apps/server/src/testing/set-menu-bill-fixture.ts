import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import {
  billPayments,
  billSetMenuCopies,
  kitchenCourses,
  products,
  workingOrderLines,
  type Transaction,
} from "@waitron/db";
import {
  addMember,
  addSetMenuDishes,
  createMenu,
  menuItems,
  readInvoiceLocales,
  requireMenuRoot,
} from "@waitron/menu";
import { insertCapturedPayment } from "@waitron/payments";
import { decimal } from "@waitron/shared";
import { saveDraftForTest } from "./draft-command-fixture.js";
import { inTx, type PartyVenue } from "./party-venue.js";
import { publishWorkingMenu } from "./publish-menu.js";

export async function setMenuOnFullMenu(
  tx: Transaction,
  fullMenuId: string,
  productId: string,
  name = "Daily menu",
  price = "14.00",
) {
  const { id: menuId } = await createMenu(tx, {
    kind: "set_menu",
    name,
    setPrice: price,
    setVatClass: "reduced",
    setTakeawayVatClass: "general",
  });
  const [{ id: courseId }] = await tx
    .insert(kitchenCourses)
    .values({ name: `${name} course`, displayOrder: 4 })
    .returning({ id: kitchenCourses.id });
  await tx.update(products).set({ courseId }).where(eq(products.id, productId));
  await addSetMenuDishes(tx, menuId, [{ productId, excludedVariantIds: [] }]);
  await addMember(tx, await requireMenuRoot(tx, fullMenuId), { kind: "set_menu", menuId });
  const [{ id: menuItemId }] = await tx
    .select({ id: menuItems.id })
    .from(menuItems)
    .where(eq(menuItems.menuId, menuId));
  const versionId = await publishWorkingMenu(tx, fullMenuId);
  return { menuId, versionId, fullMenuId, menuItemId, courseId, productId, name };
}

export async function seedBillSetMenu(
  tx: Transaction,
  workingOrderId: string,
  copy: { menuId: string; versionId: string; name: string },
  lineNo: number,
  cents = 1400,
) {
  await tx
    .insert(billSetMenuCopies)
    .values({ workingOrderId, setMenuId: copy.menuId, menuVersionId: copy.versionId })
    .onConflictDoNothing({
      target: [billSetMenuCopies.workingOrderId, billSetMenuCopies.setMenuId],
    });
  const locales = await readInvoiceLocales(tx);
  const [{ id }] = await tx
    .insert(workingOrderLines)
    .values({
      workingOrderId,
      lineNo,
      name: copy.name,
      descriptions: Object.fromEntries(locales.map((locale) => [locale, copy.name])),
      quantity: 1000,
      unitPriceGross: cents,
      lineTotal: cents,
      vatClass: "reduced",
      takeawayVatClass: "general",
      sentAt: "2026-11-19T12:00:00.000Z",
      servedAt: "2026-11-19T12:00:00.000Z",
      servedQuantity: 1000,
      setMenuRole: "set_menu",
      setMenuId: copy.menuId,
      setMenuVersionId: copy.versionId,
    })
    .returning({ id: workingOrderLines.id });
  return id;
}

/** A €26.00 card payment on the bill that the provider captured and the bill has not yet received;
 * returns the bill payment's id. */
export async function capturedCardPayment(
  tx: Transaction,
  venue: PartyVenue,
  workingOrderId: string,
): Promise<string> {
  const [{ id: paymentId }] = await tx
    .insert(billPayments)
    .values({
      workingOrderId,
      submissionId: randomUUID(),
      fingerprint: "pending-card-payment",
      kind: "contribution",
      method: "card",
      applied: 2600,
      state: "pending",
      requestedBy: venue.operator.personId,
      source: venue.cfg.origin.source,
      deviceId: venue.cfg.origin.deviceId,
    })
    .returning({ id: billPayments.id });
  await insertCapturedPayment(tx, {
    origin: venue.cfg.origin,
    nodeId: venue.cfg.nodeId,
    workingOrderId,
    billPaymentId: paymentId,
    provider: "fake",
    paymentRef: randomUUID(),
    amount: decimal("26.00"),
    settledAt: venue.clock.now().instant,
  });
  return paymentId;
}

export function saveSetMenuDraft(
  venue: PartyVenue,
  { partyId, tabId }: { partyId: string; tabId: string },
  ...lines: unknown[]
) {
  return inTx(venue, (tx) =>
    saveDraftForTest(tx, partyId, venue.operator.personId, {
      billId: tabId,
      draftId: null,
      revision: 0,
      lines,
    }),
  );
}
