import { and, eq, inArray, max } from "drizzle-orm";
import { billSetMenuCopies, menus, nowIso, workingOrderLines, type Transaction } from "@waitron/db";
import { readInvoiceLocales } from "@waitron/menu";
import { AppError, stringToCents, type BillSetMenuState } from "@waitron/shared";
import { serveRecordedSetMenus } from "@waitron/venue-service";
import { assertBillInvariant, readPaidQuantities, refusePaidLines } from "./bill-payments.js";
import { VENUE_SERVICE } from "./modules.js";
import { copiesOnSale } from "./set-menu-links.js";
import {
  readBillSetMenus,
  refuseDraftLosingSetMenuPlace,
  refuseUnlessSetMenuBill,
  setMenuLineDescriptions,
} from "./set-menu-bill.js";
import type { TradingContext } from "./trading-context.js";
import { bumpRevisionKeepingPayment, refusePaymentInFlight } from "./working-order-edit-state.js";
import { refuseOrderOverSimplifiedLimit, totalBeforeEdit } from "./stored-order-lines.js";
import "./errors.js";

export async function setSetMenuCount(
  tx: Transaction,
  cfg: TradingContext,
  billId: string,
  menuId: string,
  count: number,
  personId: string,
): Promise<BillSetMenuState> {
  await refuseUnlessSetMenuBill(tx, billId);
  await refusePaymentInFlight(tx, [billId]);

  const state = await readBillSetMenus(tx, billId);
  const copyIds = new Set(
    state.copies.filter((copy) => copy.setMenuId === menuId).map(({ id }) => id),
  );
  const menusOfType = state.setMenus.filter(({ copyId }) => copyIds.has(copyId));
  const change = count - menusOfType.length;

  if (change < 0) {
    const ids = menusOfType.map(({ lineId }) => lineId);
    const occupied = new Set(state.dishes.map(({ setMenuLineId }) => setMenuLineId));
    const empty = ids.filter((id) => !occupied.has(id));
    if (empty.length < -change) throw await holdsDishes(tx, state, ids);
    const paid = await readPaidQuantities(tx, billId);
    const isPaid = (id: string) => (paid.get(id) ?? 0) > 0;
    const unpaidLast = [...empty.filter(isPaid), ...empty.filter((id) => !isPaid(id))];
    return deleteEmptyMenus(tx, billId, unpaidLast.slice(change), paid);
  }
  if (change === 0) {
    await bumpRevisionKeepingPayment(tx, [billId]);
    return state;
  }

  const before = await totalBeforeEdit(tx, cfg, billId);
  const versionId = state.recorded[menuId];
  const selected =
    versionId === undefined
      ? await firstCopyOnSale(tx, billId, menuId)
      : { versionId, copy: (await serveRecordedSetMenus(tx, [{ menuId, versionId }]))[0]! };
  if (versionId === undefined) {
    await tx.insert(billSetMenuCopies).values({
      workingOrderId: billId,
      setMenuId: menuId,
      menuVersionId: selected.versionId,
    });
  }

  const [last] = await tx
    .select({ lineNo: max(workingOrderLines.lineNo) })
    .from(workingOrderLines)
    .where(eq(workingOrderLines.workingOrderId, billId));
  const { copy } = selected;
  const descriptions = setMenuLineDescriptions(copy, await readInvoiceLocales(tx));
  const price = stringToCents(copy.terms.price);
  const now = nowIso();
  await tx.insert(workingOrderLines).values(
    Array.from({ length: change }, (_, index) => ({
      workingOrderId: billId,
      lineNo: (last?.lineNo ?? 0) + index + 1,
      name: copy.name,
      descriptions,
      quantity: 1000,
      unitPrecision: 0,
      sentAt: now,
      servedAt: now,
      servedQuantity: 1000,
      unitPriceGross: price,
      lineTotal: price,
      vatClass: copy.terms.vatClass,
      takeawayVatClass: copy.terms.takeawayVatClass ?? copy.terms.vatClass,
      creditedTo: personId,
      setMenuRole: "set_menu" as const,
      setMenuId: menuId,
      setMenuVersionId: selected.versionId,
    })),
  );
  await refuseOrderOverSimplifiedLimit(tx, cfg, billId, before);
  await bumpRevisionKeepingPayment(tx, [billId]);
  return readBillSetMenus(tx, billId);
}

async function firstCopyOnSale(tx: Transaction, billId: string, menuId: string) {
  const context = await VENUE_SERVICE.findOrderContext(tx, billId);
  if (context !== null) {
    const zone = await VENUE_SERVICE.listZoneSetMenus(tx, context.zoneId);
    const chosen = copiesOnSale(zone).find((copy) => copy.setMenuId === menuId);
    if (chosen !== undefined) {
      return {
        copy: zone.setMenus.find(({ key }) => key === chosen.id)!,
        versionId: chosen.versionId,
      };
    }
  }
  const [menu] = await tx.select({ name: menus.name }).from(menus).where(eq(menus.id, menuId));
  throw new AppError("set_menu.not_selling", { setMenuName: menu?.name ?? "Set menu" });
}

export async function removeSetMenuLines(
  tx: Transaction,
  billId: string,
  lineIds: string[],
): Promise<BillSetMenuState> {
  await refuseUnlessSetMenuBill(tx, billId);
  await refusePaymentInFlight(tx, [billId]);
  const state = await readBillSetMenus(tx, billId);
  const menus = new Set(state.setMenus.map(({ lineId }) => lineId));
  for (const lineId of lineIds) {
    if (!menus.has(lineId)) throw new AppError("tab.line_not_found", { tabId: billId, lineId });
  }
  if (state.dishes.some(({ setMenuLineId }) => lineIds.includes(setMenuLineId))) {
    throw await holdsDishes(tx, state, lineIds);
  }
  return deleteEmptyMenus(tx, billId, lineIds);
}

async function deleteEmptyMenus(
  tx: Transaction,
  billId: string,
  lineIds: string[],
  paid?: ReadonlyMap<string, number>,
) {
  const lines = await tx
    .select({ id: workingOrderLines.id, lineNo: workingOrderLines.lineNo })
    .from(workingOrderLines)
    .where(inArray(workingOrderLines.id, lineIds))
    .orderBy(workingOrderLines.lineNo);
  await refusePaidLines(
    tx,
    billId,
    lines.map((line) => ({ ...line, keeps: 0 })),
    paid,
  );
  await refuseDraftLosingSetMenuPlace(tx, billId, new Set(lineIds));
  await tx
    .delete(workingOrderLines)
    .where(
      and(eq(workingOrderLines.workingOrderId, billId), inArray(workingOrderLines.id, lineIds)),
    );
  await assertBillInvariant(tx, [billId]);
  await bumpRevisionKeepingPayment(tx, [billId]);
  return readBillSetMenus(tx, billId);
}

async function holdsDishes(tx: Transaction, state: BillSetMenuState, menuIds: string[]) {
  const dishIds = state.dishes
    .filter(({ setMenuLineId }) => menuIds.includes(setMenuLineId))
    .map(({ lineId }) => lineId);
  const dishes = await tx
    .select({ name: workingOrderLines.name })
    .from(workingOrderLines)
    .where(inArray(workingOrderLines.id, dishIds))
    .orderBy(workingOrderLines.lineNo);
  const menu = state.setMenus.find(({ lineId }) => lineId === menuIds[0])!;
  return new AppError("set_menu.holds_dishes", {
    setMenuName: state.copies.find(({ id }) => id === menu.copyId)!.name,
    dishNames: [...new Set(dishes.map(({ name }) => name))],
  });
}
