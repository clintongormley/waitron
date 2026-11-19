import { and, eq, gt, isNotNull, sql } from "drizzle-orm";
import {
  adjustmentLines,
  adjustments,
  billPaymentLines,
  billPayments,
  billSetMenuCopies,
  products,
  workingOrderLines,
  workingOrders,
  type Transaction,
} from "@waitron/db";
import {
  AppError,
  contentLanguageCode,
  setMenuCopyOf,
  type BillSetMenuState,
  type ServedSetMenuCopy,
  type SetMenuCopy,
} from "@waitron/shared";
import { serveRecordedSetMenus } from "@waitron/venue-service";
import "./errors.js";

type LineRole = Pick<typeof workingOrderLines.$inferSelect, "setMenuRole">;

export function notSetMenuLine() {
  return sql`${workingOrderLines.setMenuRole} is not 'set_menu'`;
}

// Set-menu billing replaces this refusal once it can price the menu and its dishes together.
export async function refuseSetMenuMoney(
  tx: Transaction,
  workingOrderId: string,
  lines?: readonly LineRole[],
): Promise<void> {
  const hasSetMenu =
    lines === undefined
      ? (
          await tx
            .select({ id: workingOrderLines.id })
            .from(workingOrderLines)
            .where(
              and(
                eq(workingOrderLines.workingOrderId, workingOrderId),
                isNotNull(workingOrderLines.setMenuRole),
              ),
            )
            .limit(1)
        ).length > 0
      : lines.some((line) => line.setMenuRole !== null);
  if (hasSetMenu) throw new AppError("set_menu.payment_not_ready", {});
}

export async function refuseUnlessSetMenuBill(
  tx: Transaction,
  workingOrderId: string,
): Promise<void> {
  const [order] = await tx
    .select({
      partyId: workingOrders.partyId,
      dining: workingOrders.dining,
      serviceMode: workingOrders.serviceMode,
    })
    .from(workingOrders)
    .where(eq(workingOrders.id, workingOrderId));
  if (
    order === undefined ||
    (order.dining !== "takeaway" && (order.partyId === null || order.serviceMode !== "table_tab"))
  ) {
    throw new AppError("set_menu.not_seated", {});
  }
}

export async function readBillSetMenuVersions(
  tx: Transaction,
  workingOrderId: string,
): Promise<Map<string, string>> {
  const rows = await tx
    .select({ menuId: billSetMenuCopies.setMenuId, versionId: billSetMenuCopies.menuVersionId })
    .from(billSetMenuCopies)
    .where(eq(billSetMenuCopies.workingOrderId, workingOrderId));
  return new Map(rows.map(({ menuId, versionId }) => [menuId, versionId]));
}

export async function readBillSetMenus(
  tx: Transaction,
  workingOrderId: string,
): Promise<BillSetMenuState> {
  const lines = await tx
    .select({
      id: workingOrderLines.id,
      lineNo: workingOrderLines.lineNo,
      role: workingOrderLines.setMenuRole,
      menuId: workingOrderLines.setMenuId,
      versionId: workingOrderLines.setMenuVersionId,
      setMenuLineId: workingOrderLines.setMenuLineId,
      place: workingOrderLines.setMenuPlace,
      countsAsCourseId: workingOrderLines.setMenuCountsAsCourseId,
      priceCents: workingOrderLines.unitPriceGross,
      productId: workingOrderLines.productId,
      parentProductId: products.parentId,
    })
    .from(workingOrderLines)
    .leftJoin(products, eq(products.id, workingOrderLines.productId))
    .where(
      and(
        eq(workingOrderLines.workingOrderId, workingOrderId),
        isNotNull(workingOrderLines.setMenuRole),
      ),
    )
    .orderBy(workingOrderLines.lineNo);
  const versions = await readBillSetMenuVersions(tx, workingOrderId);
  const recorded = Object.fromEntries(versions);
  const setMenuLines = lines.filter((line) => line.role === "set_menu");
  const requests = new Map<string, { menuId: string; versionId: string }>();
  for (const [menuId, versionId] of versions) {
    requests.set(`${versionId}:${menuId}`, { menuId, versionId });
  }
  for (const { menuId, versionId } of setMenuLines) {
    requests.set(`${versionId}:${menuId}`, { menuId: menuId!, versionId: versionId! });
  }
  if (requests.size === 0) return { copies: [], recorded, setMenus: [], dishes: [] };
  const requested = [...requests];
  const served = await serveRecordedSetMenus(
    tx,
    requested.map(([, request]) => request),
  );
  const copies = new Map<string, SetMenuCopy>();
  const copyIds = new Map<string, string>();
  for (const [index, [key, { versionId }]] of requested.entries()) {
    const copy = served[index]!;
    copyIds.set(key, copy.key);
    if (!copies.has(copy.key)) copies.set(copy.key, setMenuCopyOf(copy, versionId));
  }
  const setMenus = setMenuLines.map(({ id, lineNo, menuId, versionId }) => ({
    lineId: id,
    lineNo,
    copyId: copyIds.get(`${versionId}:${menuId}`)!,
  }));

  const placed = lines.filter((line) => line.role === "dish" && line.setMenuLineId !== null);
  if (placed.length === 0) return { copies: [...copies.values()], recorded, setMenus, dishes: [] };
  const payments = await tx
    .select({ lineId: billPaymentLines.lineId })
    .from(billPaymentLines)
    .innerJoin(billPayments, eq(billPayments.id, billPaymentLines.billPaymentId))
    .where(eq(billPayments.workingOrderId, workingOrderId));
  const actions = await tx
    .select({
      lineId: adjustments.lineId,
      action: adjustments.action,
      reducedLineId: adjustmentLines.lineId,
      chargeKept: adjustments.chargeKept,
    })
    .from(adjustments)
    .leftJoin(
      adjustmentLines,
      and(eq(adjustmentLines.adjustmentId, adjustments.id), gt(adjustmentLines.reduction, 0)),
    )
    .where(eq(adjustments.workingOrderId, workingOrderId));
  const fixed = new Set(payments.map(({ lineId }) => lineId));
  const cancelled = new Set<string>();
  for (const { lineId, action, chargeKept, reducedLineId } of actions) {
    if (action === "cancel" && !chargeKept && lineId !== null) cancelled.add(lineId);
    if (reducedLineId !== null) fixed.add(reducedLineId);
  }
  const dishes = placed
    .filter(({ id }) => !cancelled.has(id))
    .map((line) => ({
      lineId: line.id,
      productId: line.parentProductId ?? line.productId!,
      variantId: line.parentProductId === null ? null : line.productId,
      setMenuLineId: line.setMenuLineId!,
      place: line.place!,
      priceCents: line.priceCents,
      countsAsCourseId: line.countsAsCourseId!,
      movable: !fixed.has(line.id),
    }));
  return { copies: [...copies.values()], recorded, setMenus, dishes };
}

export function setMenuLineDescriptions(
  { name, terms }: { name: string; terms: Pick<ServedSetMenuCopy["terms"], "names"> },
  invoiceLocales: readonly string[],
): Record<string, string> {
  return Object.fromEntries(
    invoiceLocales.map((locale) => [
      locale,
      terms.names[locale]?.trim() || terms.names[contentLanguageCode(locale)]?.trim() || name,
    ]),
  );
}
