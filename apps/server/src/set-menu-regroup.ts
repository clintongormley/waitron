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
import { readInvoiceLocales, readRecordedDocuments } from "@waitron/menu";
import {
  frozenLinesOf,
  planBillGrouping,
  type GroupingCopy,
  type GroupingLine,
  type GroupingPlan,
} from "@waitron/orders-sales/set-menu-grouping-plan.js";
import type { MenuDocument, SetMenuGrouping, SetMenuGroupingInput } from "@waitron/shared";
import { serveRecordedSetMenus } from "@waitron/venue-service";
import {
  hasBillSetMenuLines,
  isSetMenuBillRow,
  readBillSetMenuVersions,
  setMenuLineDescriptions,
} from "./set-menu-bill.js";
import { frozenLineIdSources } from "./set-menu-freeze.js";

type Calculate = (input: SetMenuGroupingInput) => SetMenuGrouping;

/** The set-menu copies the bill records, served once for the whole bill. */
export async function readGroupingCopies(tx: Transaction, billId: string): Promise<GroupingCopy[]> {
  const requests = await readBillSetMenuVersions(tx, billId);
  if (requests.length === 0) return [];
  const served = await serveRecordedSetMenus(tx, requests, "recorded");
  return served.map((copy, index) => ({ copy, versionId: requests[index]!.versionId }));
}

/**
 * Whether the offer a line was ordered from sold it by measure, as its recorded menu version froze
 * it: a unit changed since must not move a dish out of a set menu, or removing another dish could
 * make the bill dearer.
 */
function orderedByMeasure(
  document: MenuDocument,
  menuItemId: string,
  productId: string | null,
): boolean {
  const offer = Object.hasOwn(document.offers, menuItemId)
    ? document.offers[menuItemId]
    : Object.values(document.setMenus ?? {}).find((copy) => Object.hasOwn(copy.offers, menuItemId))
        ?.offers[menuItemId];
  const sold = offer?.variants.find(({ id }) => id === productId) ?? offer;
  return sold?.unit.measure === true;
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
      menuVersionId: workingOrderLines.menuVersionId,
      quantity: workingOrderLines.quantity,
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
    })
    .from(workingOrderLines)
    .leftJoin(products, eq(products.id, workingOrderLines.productId))
    .where(eq(workingOrderLines.workingOrderId, billId))
    .orderBy(workingOrderLines.lineNo);
  const documents = await readRecordedDocuments(
    tx,
    rows.flatMap(({ parentLineId, menuVersionId }) =>
      parentLineId === null && menuVersionId !== null ? [menuVersionId] : [],
    ),
  );
  return rows.map(({ productId, parentProductId, menuVersionId, ...line }) => ({
    ...line,
    soldByMeasure:
      line.parentLineId === null &&
      line.menuItemId !== null &&
      menuVersionId !== null &&
      orderedByMeasure(documents.get(menuVersionId)!, line.menuItemId, productId),
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
  const [bill] = await tx
    .select({ setMenusExact: workingOrders.setMenusExact })
    .from(workingOrders)
    .where(eq(workingOrders.id, billId));
  return writeBillGrouping(tx, billId, bill!.setMenusExact, copies, calculate);
}

async function planGrouping(
  tx: Transaction,
  lines: readonly GroupingLine[],
  copies: readonly GroupingCopy[],
  calculate?: Calculate,
): Promise<GroupingPlan> {
  const sources = await frozenLineIdSources(
    tx,
    lines.map(({ id }) => id),
  );
  return planBillGrouping(lines, frozenLinesOf(lines, sources), copies, newId, calculate);
}

/** {@link saveBillGrouping} for a bill whose stored `set_menus_exact` is `wasExact`. */
async function writeBillGrouping(
  tx: Transaction,
  billId: string,
  wasExact: boolean,
  copies: readonly GroupingCopy[],
  calculate?: Calculate,
): Promise<{ changed: boolean; exact: boolean }> {
  const lines = await readGroupingLines(tx, billId);
  const plan = await planGrouping(tx, lines, copies, calculate);

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
        // vat_class and takeaway_vat_class are required; no rate reads them.
        vatClass: "reduced" as const,
        takeawayVatClass: "reduced" as const,
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

  const exactFlipped = wasExact !== plan.exact;
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
 * changed.
 */
export async function regroupBills(
  tx: Transaction,
  billIds: readonly string[],
): Promise<ReadonlySet<string>> {
  const changed = new Set<string>();
  for (const billId of new Set(billIds)) {
    const bill = await readOpenBill(tx, billId);
    if (bill === null) continue;
    if (bill.copies.length === 0 && !(await hasBillSetMenuLines(tx, billId))) continue;
    if ((await writeBillGrouping(tx, billId, bill.setMenusExact, bill.copies)).changed) {
      changed.add(billId);
    }
  }
  return changed;
}

/** An open bill's stored `set_menus_exact` and the copies it is grouped over; null when not open. */
async function readOpenBill(
  tx: Transaction,
  billId: string,
): Promise<{ setMenusExact: boolean; copies: GroupingCopy[] } | null> {
  const [bill] = await tx
    .select({
      status: workingOrders.status,
      dining: workingOrders.dining,
      partyId: workingOrders.partyId,
      serviceMode: workingOrders.serviceMode,
      setMenusExact: workingOrders.setMenusExact,
    })
    .from(workingOrders)
    .where(eq(workingOrders.id, billId));
  if (bill?.status !== "open") return null;
  return { setMenusExact: bill.setMenusExact, copies: await copiesOf(tx, billId, bill) };
}

/** The copies a bill is grouped over: none when it takes no set menus. */
async function copiesOf(
  tx: Transaction,
  billId: string,
  bill: Parameters<typeof isSetMenuBillRow>[0],
): Promise<GroupingCopy[]> {
  return isSetMenuBillRow(bill) ? readGroupingCopies(tx, billId) : [];
}

/** A removal's line writes: rows deleted with their extras, and rows left at a new size. */
export interface BillRowRemoval {
  deleted: ReadonlySet<string>;
  resized: ReadonlyMap<string, { quantity: number; lineTotal: number }>;
}

/**
 * By how much, in cents, {@link regroupBills} would lower the bill's total once `removal`'s writes
 * were made, writing nothing (D24).
 */
export async function regroupDropAfter(
  tx: Transaction,
  billId: string,
  removal: BillRowRemoval,
): Promise<number> {
  const bill = await readOpenBill(tx, billId);
  if (bill === null) return 0;
  const gone = (line: GroupingLine) =>
    removal.deleted.has(line.id) ||
    (line.parentLineId !== null && removal.deleted.has(line.parentLineId));
  const lines = (await readGroupingLines(tx, billId)).flatMap((line) =>
    gone(line) ? [] : [{ ...line, ...removal.resized.get(line.id) }],
  );
  return planDrop(tx, lines, bill.copies);
}

/** A bill's rows taken to a bill of their own: whole with their extras, or at a new size. */
export interface TakenRows {
  ids: ReadonlySet<string>;
  resized: ReadonlyMap<string, { quantity: number; lineTotal: number }>;
}

/**
 * What a new bill holding only `taken` would come to, in cents, once {@link regroupBills} had
 * grouped it over the set menus `billId` records, writing nothing. The payment refuses
 * `bill.allocation_changed` where the bill turns out otherwise.
 */
export async function totalOnOwnBill(
  tx: Transaction,
  billId: string,
  taken: TakenRows,
): Promise<number> {
  return totalOfRows(tx, billId, (line) =>
    taken.ids.has(line.id) ? { ...line, ...taken.resized.get(line.id) } : null,
  );
}

/**
 * What `billId` would come to, in cents, once `taken` had left it and {@link regroupBills} had
 * grouped what stays, writing nothing.
 */
export async function totalLeftBehind(
  tx: Transaction,
  billId: string,
  taken: TakenRows,
): Promise<number> {
  return totalOfRows(tx, billId, (line) => {
    const part = taken.resized.get(line.id);
    if (part === undefined) return taken.ids.has(line.id) ? null : line;
    const { quantity, lineTotal } = line;
    return { ...line, quantity: quantity - part.quantity, lineTotal: lineTotal - part.lineTotal };
  });
}

/** What the bill's rows, each as `rowOf` answers it (null for none), come to once grouped. */
async function totalOfRows(
  tx: Transaction,
  billId: string,
  rowOf: (line: GroupingLine) => GroupingLine | null,
): Promise<number> {
  const [bill] = await tx
    .select({
      dining: workingOrders.dining,
      partyId: workingOrders.partyId,
      serviceMode: workingOrders.serviceMode,
    })
    .from(workingOrders)
    .where(eq(workingOrders.id, billId));
  const lines = (await readGroupingLines(tx, billId)).flatMap((line) => rowOf(line) ?? []);
  const drop = await planDrop(tx, lines, await copiesOf(tx, billId, bill!));
  return sum(lines.map(({ lineTotal }) => lineTotal)) - drop;
}

function sum(cents: readonly number[]): number {
  return cents.reduce((total, one) => total + one, 0);
}

/** By how much, in cents, grouping `lines` over `copies` would lower their total. */
async function planDrop(
  tx: Transaction,
  lines: readonly GroupingLine[],
  copies: readonly GroupingCopy[],
): Promise<number> {
  if (copies.length === 0 && !lines.some(({ setMenuRole }) => setMenuRole !== null)) return 0;
  const plan = await planGrouping(tx, lines, copies);
  const was = new Map(lines.map(({ id, lineTotal }) => [id, lineTotal]));
  return (
    sum(plan.deletes.map((id) => was.get(id)!)) +
    sum(plan.dishUpdates.map(({ id, lineTotal }) => was.get(id)! - lineTotal)) +
    sum(plan.menuUpdates.map(({ id, priceCents }) => was.get(id)! - priceCents)) -
    sum(plan.inserts.map(({ priceCents }) => priceCents))
  );
}
