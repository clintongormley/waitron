import { and, eq, inArray, sql } from "drizzle-orm";
import {
  insertInChunks,
  newId,
  nowIso,
  products,
  workingOrderLines,
  workingOrders,
  type Transaction,
} from "@waitron/db";
import { readInvoiceLocales } from "@waitron/menu";
import {
  frozenLinesOf,
  planBillGrouping,
  type GroupingCopy,
  type GroupingLine,
} from "@waitron/orders-sales/set-menu-grouping-plan.js";
import type { SetMenuGrouping, SetMenuGroupingInput } from "@waitron/shared";
import { serveRecordedSetMenus } from "@waitron/venue-service";
import {
  hasBillSetMenuLines,
  isSetMenuBill,
  readBillSetMenuVersions,
  setMenuLineDescriptions,
} from "./set-menu-bill.js";
import { namedFrozenLineIds } from "./set-menu-freeze.js";

type Calculate = (input: SetMenuGroupingInput) => SetMenuGrouping;

/** The set-menu copies the bill records, served once for the whole bill. */
export async function readGroupingCopies(tx: Transaction, billId: string): Promise<GroupingCopy[]> {
  const requests = [...(await readBillSetMenuVersions(tx, billId))].map(([menuId, versionId]) => ({
    menuId,
    versionId,
  }));
  if (requests.length === 0) return [];
  const served = await serveRecordedSetMenus(tx, requests);
  return served.map((copy, index) => ({ copy, versionId: requests[index]!.versionId }));
}

/** Every row of the bill, each dish as a set menu lists it (D12: the course is the line's own). */
export async function readGroupingLines(tx: Transaction, billId: string): Promise<GroupingLine[]> {
  const rows = await tx
    .select({
      id: workingOrderLines.id,
      lineNo: workingOrderLines.lineNo,
      parentLineId: workingOrderLines.parentLineId,
      productId: workingOrderLines.productId,
      parentProductId: products.parentId,
      countsAsCourseId: workingOrderLines.countsAsCourseId,
      menuItemId: workingOrderLines.menuItemId,
      quantity: workingOrderLines.quantity,
      countAsPortions: workingOrderLines.countAsPortions,
      listUnitPriceGross: workingOrderLines.listUnitPriceGross,
      unitPriceGross: workingOrderLines.unitPriceGross,
      lineTotal: workingOrderLines.lineTotal,
      aLaCarteUnitPrice: workingOrderLines.aLaCarteUnitPrice,
      creditedTo: workingOrderLines.creditedTo,
      setMenuRole: workingOrderLines.setMenuRole,
      setMenuId: workingOrderLines.setMenuId,
      setMenuVersionId: workingOrderLines.setMenuVersionId,
      setMenuLineId: workingOrderLines.setMenuLineId,
      setMenuPlace: workingOrderLines.setMenuPlace,
      setMenuCountsAsCourseId: workingOrderLines.setMenuCountsAsCourseId,
    })
    .from(workingOrderLines)
    .leftJoin(products, eq(products.id, workingOrderLines.productId))
    .where(eq(workingOrderLines.workingOrderId, billId))
    .orderBy(workingOrderLines.lineNo);
  return rows.map(({ productId, parentProductId, ...line }) => ({
    ...line,
    listedProductId: parentProductId ?? productId,
    listedVariantId: parentProductId === null ? null : productId,
  }));
}

/**
 * Saves the bill's grouping over `copies`, leaving every frozen row as it is (D2, D15). Writes new
 * set-menu rows, then dishes, then surviving set-menu rows, then deletes, so no dish points at a
 * deleted row.
 */
export async function saveBillGrouping(
  tx: Transaction,
  billId: string,
  copies: readonly GroupingCopy[],
  calculate?: Calculate,
): Promise<{ changed: boolean; exact: boolean }> {
  const lines = await readGroupingLines(tx, billId);
  const named = await namedFrozenLineIds(
    tx,
    lines.map(({ id }) => id),
  );
  const plan = planBillGrouping(lines, frozenLinesOf(lines, named), copies, newId, calculate);

  if (plan.inserts.length > 0) {
    const locales = await readInvoiceLocales(tx);
    const now = nowIso();
    await insertInChunks(
      tx,
      workingOrderLines,
      plan.inserts.map(({ id, lineNo, copy: { copy, versionId }, priceCents, creditedTo }) => ({
        id,
        workingOrderId: billId,
        lineNo,
        name: copy.name,
        descriptions: setMenuLineDescriptions(copy, locales),
        quantity: 1000,
        unitPrecision: 0,
        sentAt: now,
        servedAt: now,
        servedQuantity: 1000,
        unitPriceGross: priceCents,
        lineTotal: priceCents,
        vatClass: copy.terms.vatClass,
        takeawayVatClass: copy.terms.takeawayVatClass ?? copy.terms.vatClass,
        creditedTo,
        setMenuRole: "set_menu" as const,
        setMenuId: copy.menuId,
        setMenuVersionId: versionId,
      })),
    );
  }
  for (const { id, ...columns } of plan.dishUpdates) {
    await tx.update(workingOrderLines).set(columns).where(eq(workingOrderLines.id, id));
  }
  for (const { id, priceCents, creditedTo } of plan.menuUpdates) {
    await tx
      .update(workingOrderLines)
      .set({ unitPriceGross: priceCents, lineTotal: priceCents, creditedTo })
      .where(eq(workingOrderLines.id, id));
  }
  if (plan.deletes.length > 0) {
    await tx
      .delete(workingOrderLines)
      .where(
        and(
          eq(workingOrderLines.workingOrderId, billId),
          inArray(
            workingOrderLines.id,
            sql`(select value from json_each(${JSON.stringify(plan.deletes)}))`,
          ),
        ),
      );
  }

  const [bill] = await tx
    .select({ exact: workingOrders.setMenusExact })
    .from(workingOrders)
    .where(eq(workingOrders.id, billId));
  const exactFlipped = bill!.exact !== plan.exact;
  if (exactFlipped) {
    await tx
      .update(workingOrders)
      .set({ setMenusExact: plan.exact })
      .where(eq(workingOrders.id, billId));
  }
  return {
    changed:
      exactFlipped ||
      plan.inserts.length +
        plan.dishUpdates.length +
        plan.menuUpdates.length +
        plan.deletes.length >
        0,
    exact: plan.exact,
  };
}

/**
 * Regroups each open bill among `billIds`, in turn, and answers the bills whose lines or `exact`
 * changed. A takeaway bill is grouped with no set menus (D14), so its set-menu rows go and its
 * dishes are charged à la carte.
 */
export async function regroupBills(
  tx: Transaction,
  billIds: readonly string[],
): Promise<ReadonlySet<string>> {
  const changed = new Set<string>();
  for (const billId of new Set(billIds)) {
    const [bill] = await tx
      .select({ status: workingOrders.status, dining: workingOrders.dining })
      .from(workingOrders)
      .where(eq(workingOrders.id, billId));
    if (bill?.status !== "open") continue;
    const copies =
      bill.dining !== "takeaway" && (await isSetMenuBill(tx, billId))
        ? await readGroupingCopies(tx, billId)
        : [];
    if (copies.length === 0 && !(await hasBillSetMenuLines(tx, billId))) continue;
    if ((await saveBillGrouping(tx, billId, copies)).changed) changed.add(billId);
  }
  return changed;
}
