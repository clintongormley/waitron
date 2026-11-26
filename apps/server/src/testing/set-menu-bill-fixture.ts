import { randomUUID } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
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
import { decimal, decimalToCents } from "@waitron/shared";
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

/**
 * Prices `copy`'s dish on the full menu at `aLaCarte`, and in the set menu at `supplementCents`
 * when given, then republishes; answers the new version. With the dish dearer a la carte than the
 * set menu and its supplement, a bill works the dish out into that set menu.
 */
export async function priceSetMenuDish(
  tx: Transaction,
  copy: { fullMenuId: string; productId: string; menuItemId: string },
  { aLaCarte, supplementCents }: { aLaCarte: number; supplementCents?: number },
): Promise<string> {
  await tx
    .update(menuItems)
    .set({ grossPrice: aLaCarte })
    .where(and(eq(menuItems.menuId, copy.fullMenuId), eq(menuItems.productId, copy.productId)));
  if (supplementCents !== undefined)
    await tx
      .update(menuItems)
      .set({ grossPrice: supplementCents })
      .where(eq(menuItems.id, copy.menuItemId));
  return publishWorkingMenu(tx, copy.fullMenuId);
}

/** Stamps the line's list price one cent above its price, as if reduced, recording no adjustment. */
export async function freezeBillLine(tx: Transaction, lineId: string): Promise<void> {
  await tx
    .update(workingOrderLines)
    .set({ listUnitPriceGross: sql`${workingOrderLines.unitPriceGross} + 1` })
    .where(eq(workingOrderLines.id, lineId));
}

export async function seedBillSetMenu(
  tx: Transaction,
  workingOrderId: string,
  copy: { menuId: string; versionId: string; name: string },
  lineNo: number,
  cents = 1400,
) {
  // A set menu the bill already records keeps its copy, as linking a dish leaves it.
  const [recorded] = await tx
    .select({ id: billSetMenuCopies.setMenuId })
    .from(billSetMenuCopies)
    .where(
      and(
        eq(billSetMenuCopies.workingOrderId, workingOrderId),
        eq(billSetMenuCopies.setMenuId, copy.menuId),
      ),
    );
  if (recorded === undefined) {
    await tx
      .insert(billSetMenuCopies)
      .values({ workingOrderId, setMenuId: copy.menuId, menuVersionId: copy.versionId });
  }
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
  amount = "26.00",
): Promise<string> {
  const [{ id: paymentId }] = await tx
    .insert(billPayments)
    .values({
      workingOrderId,
      submissionId: randomUUID(),
      fingerprint: "pending-card-payment",
      kind: "contribution",
      method: "card",
      applied: decimalToCents(decimal(amount)),
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
    amount: decimal(amount),
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
