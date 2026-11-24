import "./errors.js";
import {
  type Transaction,
  workingOrders,
  workingOrderLines,
  ticketItems,
  orderGroups,
  ticketItemMoves,
} from "@waitron/db";
import { assertQuantityPrecision, MAX_UNIT_PRECISION } from "@waitron/menu";
import {
  AppError,
  type Decimal,
  decimalToCents,
  compareDecimal,
  decimal,
  stringToThousandths,
  subtractDecimal,
  sumDecimals,
  thousandthsToDecimal,
  centsToDecimal,
  decimalToThousandths,
} from "@waitron/shared";
import { or, eq, and, inArray, sql, isNull, isNotNull, exists } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { setImmediate as nextTurn } from "node:timers/promises";
import { refusePaidLines } from "./bill-payments.js";
import { copyAllergyWorkingTicks } from "./kitchen-allergy.js";
import { copyKitchenJobLines, copyKitchenPrintLinks } from "./kitchen-print.js";
import { splitLineServiceState, readLineCancellations } from "./line-service-state.js";
import { VENUE_SERVICE } from "./modules.js";
import { grossLineTotal, perDishExtraPicks, extraQuantityFor } from "./order-line-quantities.js";
import { recordPortionEvents, carryLineReductions } from "./order-portions.js";
import {
  refuseUnlessSetMenuBill,
  refuseDraftLosingSetMenuPlace,
  carryBillSetMenuCopies,
} from "./set-menu-bill.js";
import { replaceMovedDishes } from "./set-menu-moves.js";
import { totalBeforeEdit, refuseOrderOverSimplifiedLimit } from "./stored-order-lines.js";
import type { TradingContext } from "./trading-context.js";

/**
 * Lines pass between two orders only when both have the same service mode, or neither has a service
 * context. A table bill sends nothing when it is paid, so a quick-sale bill's unsent
 * dishes moved into it would never reach the kitchen.
 */
export async function assertServiceModesMatch(
  tx: Transaction,
  fromOrderId: string,
  toOrderId: string,
): Promise<void> {
  const fromContext = await VENUE_SERVICE.findOrderContext(tx, fromOrderId);
  const toContext = await VENUE_SERVICE.findOrderContext(tx, toOrderId);
  if (!modesMatch(fromContext, toContext)) {
    throw new AppError("service_zone.mode_incompatible", {
      zoneId: toContext?.zoneId ?? "unscoped",
      expected: fromContext?.serviceMode ?? "unscoped",
      actual: toContext?.serviceMode ?? "unscoped",
    });
  }
}
function modesMatch(
  from: { serviceMode: string } | null,
  to: { serviceMode: string } | null,
): boolean {
  if (from === null || to === null) return from === to;
  return from.serviceMode === to.serviceMode;
}
/**
 * Move lines (default all) from one OPEN order to another at the destination's next `line_no`s,
 * keeping each line's id, modifier links and any fired ticket; returns the ids of the lines it
 * moved. A caller naming a set-menu line includes its dishes in the selection. It makes no
 * service-mode check: the caller has made {@link assertServiceModesMatch}'s, or copied the
 * source's context onto the destination.
 */
export async function moveOrderLines(
  tx: Transaction,
  cfg: TradingContext,
  fromTabId: string,
  toTabId: string,
  lineNos: number[] | undefined,
  opts: { actorId?: string } = {},
): Promise<string[]> {
  // A self-transfer would allocate line numbers that collide with the rows being moved.
  if (fromTabId === toTabId) {
    throw new AppError("tab.merge_self", { tabId: fromTabId });
  }
  const both = await tx
    .select({
      id: workingOrders.id,
      status: workingOrders.status,
      orderNumber: workingOrders.orderNumber,
      dining: workingOrders.dining,
    })
    .from(workingOrders)
    .where(or(eq(workingOrders.id, fromTabId), eq(workingOrders.id, toTabId)));
  const from = both.find((r) => r.id === fromTabId);
  const to = both.find((r) => r.id === toTabId);
  if (from === undefined || from.status !== "open") {
    throw new AppError("tab.not_open", { tabId: fromTabId });
  }
  if (to === undefined || to.status !== "open") {
    throw new AppError("tab.not_open", { tabId: toTabId });
  }
  // A line is rated by its order's way, so a move across ways would change a sent line's rate.
  if (from.dining !== to.dining) {
    throw new AppError("order.dining_differs", { fromOrderId: fromTabId, toOrderId: toTabId });
  }
  const sourceWhere =
    lineNos === undefined
      ? eq(workingOrderLines.workingOrderId, fromTabId)
      : and(
          eq(workingOrderLines.workingOrderId, fromTabId),
          inArray(
            workingOrderLines.lineNo,
            sql`(select value from json_each(${JSON.stringify(lineNos)}))`,
          ),
        );

  const source = await tx
    .select({
      id: workingOrderLines.id,
      lineNo: workingOrderLines.lineNo,
      setMenuRole: workingOrderLines.setMenuRole,
      setMenuId: workingOrderLines.setMenuId,
      setMenuLineId: workingOrderLines.setMenuLineId,
    })
    .from(workingOrderLines)
    .where(sourceWhere)
    .orderBy(workingOrderLines.lineNo);
  // A moved row takes its id with it, and a paid quantity stays on the bill it was paid on.
  await refusePaidLines(
    tx,
    fromTabId,
    source.map((line) => ({ id: line.id, lineNo: line.lineNo, keeps: 0 })),
  );

  const movedMenus = source.filter(({ setMenuRole }) => setMenuRole === "set_menu");
  const movedMenuIds = new Set(movedMenus.map(({ id }) => id));
  const looseDishes = source.filter(
    ({ setMenuRole, setMenuLineId }) =>
      setMenuRole === "dish" && (setMenuLineId === null || !movedMenuIds.has(setMenuLineId)),
  );
  if (movedMenus.length > 0 || looseDishes.length > 0) {
    await refuseUnlessSetMenuBill(tx, toTabId);
  }
  // A whole-bill merge carries the draft along with its menus.
  if (lineNos !== undefined && movedMenus.length > 0) {
    await refuseDraftLosingSetMenuPlace(
      tx,
      fromTabId,
      movedMenuIds,
      new Set(source.map(({ id }) => id)),
    );
  }
  if (lineNos === undefined || movedMenus.length > 0) {
    await carryBillSetMenuCopies(
      tx,
      fromTabId,
      toTabId,
      lineNos === undefined ? undefined : movedMenus.map(({ setMenuId }) => setMenuId!),
    );
  }

  const [agg] = await tx
    .select({ next: sql<number>`cast(coalesce(max(${workingOrderLines.lineNo}), 0) as int)` })
    .from(workingOrderLines)
    .where(eq(workingOrderLines.workingOrderId, toTabId));
  const base = agg!.next;
  const before = source.length > 0 ? await totalBeforeEdit(tx, cfg, toTabId) : null;

  // Moved in place so every row keyed on the line id survives. Destination numbers start beyond its
  // current maximum, so no update collides on `(working_order_id, line_no)`.
  for (let index = 0; index < source.length; index++) {
    const line = source[index]!;
    await tx
      .update(workingOrderLines)
      .set({ workingOrderId: toTabId, lineNo: base + index + 1 })
      .where(
        and(eq(workingOrderLines.workingOrderId, fromTabId), eq(workingOrderLines.id, line.id)),
      );
  }
  // Loose dishes can take places on menus that arrived in the same move.
  if (looseDishes.length > 0) {
    await replaceMovedDishes(
      tx,
      toTabId,
      looseDishes.map(({ id }) => id),
    );
  }
  if (source.length > 0) {
    const lineIds = source.map((line) => line.id);
    await stampSentOrderNumber(tx, lineIds, from.orderNumber);

    await recordPortionEvents(tx, lineIds, {
      kind: "dish.moved",
      fromOrderId: fromTabId,
      toOrderId: toTabId,
      actorId: opts.actorId ?? null,
    });
    await refuseOrderOverSimplifiedLimit(tx, cfg, toTabId, before);
  }
  return source.map((line) => line.id);
}
/**
 * Give the ticket items of these lines, as they leave order number `fromNumber`, that number as the
 * one they were sent under — only those the kitchen has seen (fired, or in a held group whose HOLD
 * ticket printed at any station), never one made here, and never over a number they already carry. A held item
 * whose HOLD ticket never printed first prints on the order it is on when it fires.
 */
async function stampSentOrderNumber(
  tx: Transaction,
  lineIds: string[],
  fromNumber: number,
): Promise<void> {
  if (lineIds.length === 0) return;
  await tx
    .update(ticketItems)
    .set({ sentOrderNumber: fromNumber })
    .where(
      and(
        inArray(
          ticketItems.workingOrderLineId,
          sql`(select value from json_each(${JSON.stringify(lineIds)}))`,
        ),
        isNull(ticketItems.sentOrderNumber),
        eq(ticketItems.madeHere, false),
        or(
          isNotNull(ticketItems.firedAt),
          exists(
            tx
              .select({ id: workingOrderLines.id })
              .from(workingOrderLines)
              .innerJoin(orderGroups, eq(orderGroups.id, workingOrderLines.groupId))
              .where(
                and(
                  eq(workingOrderLines.id, ticketItems.workingOrderLineId),
                  isNotNull(orderGroups.holdPrintedAt),
                ),
              ),
          ),
        ),
      ),
    );
}
/**
 * Whether `parts` of `row`, each priced as a row of its own, add up to `row` priced whole. A bill is
 * priced, and filed, row by row from unit price and quantity, never from a stored line total, so a
 * split whose parts round apart would change what the guest pays.
 */
function pricesAddUp(
  row: { unitPriceGross: Decimal; quantity: Decimal; priceQuantity: Decimal },
  parts: readonly Decimal[],
): boolean {
  const cents = (quantity: Decimal) =>
    decimalToCents(grossLineTotal(row.unitPriceGross, quantity, row.priceQuantity));
  return parts.reduce((sum, part) => sum + cents(part), 0) === cents(row.quantity);
}
/**
 * Refuse a batch naming the same source `line_no` twice: each entry is validated against the line's
 * pre-batch quantity and the split sets the source to `original − q`, so two partial "1"s off a line
 * of 3 would add 2 to the destination while the source dropped by 1.
 */
export function assertDistinctTransferLines(tabId: string, transfers: { lineNo: number }[]): void {
  const seenLineNos = new Set<number>();
  for (const { lineNo } of transfers) {
    if (seenLineNos.has(lineNo)) {
      throw new AppError("tab.transfer_duplicate_line", { tabId, lineNo });
    }
    seenLineNos.add(lineNo);
  }
}
/** A line as {@link checkLinePart} reads it, its amounts as decimals. */
export interface PartLine {
  lineNo: number;
  quantity: Decimal;
  unitPriceGross: Decimal;
  priceQuantity: Decimal;
  unitPrecision: number | null;
}
/** An extra split with its dish: what stays on its row and what goes to the new one. */
export interface ExtraPart<L extends PartLine = PartLine> {
  row: L;
  remaining: Decimal;
  moved: Decimal;
}
/**
 * Refuse `quantity` of `line` as {@link carveOffLines} refuses it: `null` when it is the whole
 * line, else how each of its `extras` splits with the part.
 */
export function checkLinePart<L extends PartLine>(
  tabId: string,
  line: L,
  quantity: string,
  extras: readonly L[],
  opts: { splitExtras?: boolean; splitIntoUnits?: boolean },
): ExtraPart<L>[] | null {
  // A malformed literal is reported as the same domain code as an out-of-range one.
  let inRange: boolean;
  try {
    assertQuantityPrecision(quantity, line.unitPrecision ?? MAX_UNIT_PRECISION, {
      positive: true,
    });
    inRange = compareDecimal(decimal(quantity), decimal(line.quantity)) <= 0;
    if (opts.splitIntoUnits) {
      const units = stringToThousandths(line.quantity);
      inRange = inRange && line.unitPrecision === 0 && units >= 2000 && units % 1000 === 0;
      inRange = inRange && pricesAddUp(line, Array(units / 1000).fill(decimal("1")));
    } else if (inRange && compareDecimal(decimal(quantity), decimal(line.quantity)) < 0) {
      const moved = decimal(quantity);
      inRange = pricesAddUp(line, [moved, subtractDecimal(decimal(line.quantity), moved)]);
    }
  } catch {
    inRange = false;
  }
  if (!inRange) {
    throw new AppError("tab.transfer_quantity_invalid", {
      tabId,
      lineNo: line.lineNo,
      quantity: opts.splitIntoUnits ? line.quantity : quantity,
    });
  }
  if (compareDecimal(decimal(quantity), decimal(line.quantity)) === 0) return null;
  if (extras.length > 0 && opts.splitExtras !== true) {
    throw new AppError("tab.transfer_modifier_line", { tabId, lineNo: line.lineNo });
  }
  const moved = decimal(quantity);
  const remaining = subtractDecimal(decimal(line.quantity), moved);
  const children = extras.map((row) => {
    const perDish = perDishExtraPicks(row.quantity, line.quantity, row.priceQuantity);
    return {
      row,
      remaining: extraQuantityFor(perDish, remaining, row.priceQuantity),
      moved: extraQuantityFor(perDish, moved, row.priceQuantity),
    };
  });
  // An extra that is not a whole count a dish would split into parts that do not add up to it,
  // and the bill would drift.
  if (
    children.some(
      (child) =>
        compareDecimal(sumDecimals([child.remaining, child.moved]), child.row.quantity) !== 0 ||
        !pricesAddUp(child.row, [child.remaining, child.moved]),
    )
  ) {
    throw new AppError("tab.transfer_modifier_line", { tabId, lineNo: line.lineNo });
  }
  return children;
}
/**
 * Carry whole lines between two orders, or cut part of a line off into a new row of its own order,
 * keeping each unit's LOCKED prices and CONSERVING quantity. It makes no open-order check and no
 * service-mode check of its own: the CALLER makes the first, and ensures the second by
 * {@link assertServiceModesMatch} or by copying the source's context onto a new order. Every transfer is validated before anything moves. A partial
 * split of a dish with extras is refused `tab.transfer_modifier_line` unless `splitExtras` is set:
 * then each extra is split with it, the part going with the split dish being its count a dish times
 * the part split, and refused the same when an extra is not a whole count a dish. Returns each
 * row a split made, keyed by the row it came from, a dish before its extras.
 */
export async function carveOffLines(
  tx: Transaction,
  cfg: TradingContext,
  fromTabId: string,
  toTabId: string,
  transfers: { lineNo: number; quantity?: string }[],
  opts: { splitExtras?: boolean; actorId?: string },
): Promise<{ splitLines: Map<string, SplitRow> }> {
  return carveLines(tx, cfg, fromTabId, toTabId, transfers, opts);
}

async function carveLines(
  tx: Transaction,
  cfg: TradingContext,
  fromTabId: string,
  toTabId: string,
  transfers: { lineNo: number; quantity?: string }[],
  opts: { splitExtras?: boolean; splitIntoUnits?: boolean; actorId?: string },
): Promise<{ splitLines: Map<string, SplitRow> }> {
  // Every line, not only the named ones: which dishes carry modifiers needs the whole tab.
  const sourceRows = await tx
    .select({
      id: workingOrderLines.id,
      lineNo: workingOrderLines.lineNo,
      parentLineId: workingOrderLines.parentLineId,
      productId: workingOrderLines.productId,
      name: workingOrderLines.name,
      descriptions: workingOrderLines.descriptions,
      optionSnapshots: workingOrderLines.optionSnapshots,
      quantity: workingOrderLines.quantity,
      unitPriceGross: workingOrderLines.unitPriceGross,
      priceQuantity: workingOrderLines.priceQuantity,
      vatClass: workingOrderLines.vatClass,
      takeawayVatClass: workingOrderLines.takeawayVatClass,
      category: workingOrderLines.category,
      unitName: workingOrderLines.unitName,
      unitPrecision: workingOrderLines.unitPrecision,
      countAsPortions: workingOrderLines.countAsPortions,
      variantName: workingOrderLines.variantName,
      variantDescriptions: workingOrderLines.variantDescriptions,
      variantKitchenName: workingOrderLines.variantKitchenName,
      kitchenName: workingOrderLines.kitchenName,
      classification: workingOrderLines.classification,
      sentAt: workingOrderLines.sentAt,
      servedAt: workingOrderLines.servedAt,
      servedQuantity: workingOrderLines.servedQuantity,
      courseId: workingOrderLines.courseId,
      makeAtStationId: workingOrderLines.makeAtStationId,
      note: workingOrderLines.note,
      extraListId: workingOrderLines.extraListId,
      groupId: workingOrderLines.groupId,
      creditedTo: workingOrderLines.creditedTo,
      listUnitPriceGross: workingOrderLines.listUnitPriceGross,
      context: {
        setMenuRole: workingOrderLines.setMenuRole,
        setMenuId: workingOrderLines.setMenuId,
        setMenuVersionId: workingOrderLines.setMenuVersionId,
        setMenuLineId: workingOrderLines.setMenuLineId,
        setMenuPlace: workingOrderLines.setMenuPlace,
        setMenuCountsAsCourseId: workingOrderLines.setMenuCountsAsCourseId,
        menuItemId: workingOrderLines.menuItemId,
        menuId: workingOrderLines.menuId,
        menuName: workingOrderLines.menuName,
        menuVersionId: workingOrderLines.menuVersionId,
        offerDepartmentId: workingOrderLines.offerDepartmentId,
        departmentName: workingOrderLines.departmentName,
        unitId: workingOrderLines.unitId,
        soldInEach: workingOrderLines.soldInEach,
        hardwareUnit: workingOrderLines.hardwareUnit,
        allergens: workingOrderLines.allergens,
        diet: workingOrderLines.diet,
        dietOverride: workingOrderLines.dietOverride,
        latePeriodId: workingOrderLines.latePeriodId,
        latePeriodName: workingOrderLines.latePeriodName,
        lateConfirmedBy: workingOrderLines.lateConfirmedBy,
        sentNutrition: workingOrderLines.sentNutrition,
        offerUnitName: workingOrderLines.offerUnitName,
        offerUnitPrecision: workingOrderLines.offerUnitPrecision,
        offerVatClass: workingOrderLines.offerVatClass,
        offerCategoryName: workingOrderLines.offerCategoryName,
      },
      ticketItemId: ticketItems.id,
    })
    .from(workingOrderLines)
    .leftJoin(ticketItems, eq(ticketItems.workingOrderLineId, workingOrderLines.id))
    .where(eq(workingOrderLines.workingOrderId, fromTabId))
    .orderBy(workingOrderLines.lineNo);
  const sourceLines = sourceRows.map((l) => ({
    ...l,
    quantity: thousandthsToDecimal(l.quantity),
    unitPriceGross: centsToDecimal(l.unitPriceGross),
    priceQuantity: thousandthsToDecimal(l.priceQuantity),
  }));
  const byLineNo = new Map(sourceLines.map((l) => [l.lineNo, l]));
  const lineNoById = new Map(sourceLines.map((l) => [l.id, l.lineNo]));
  const childLineNosByParent = new Map<number, number[]>();
  for (const l of sourceLines) {
    if (l.parentLineId == null) {
      continue;
    }
    const parentLineNo = lineNoById.get(l.parentLineId);
    if (parentLineNo === undefined) {
      continue;
    }
    const siblings = childLineNosByParent.get(parentLineNo) ?? [];
    siblings.push(l.lineNo);
    childLineNosByParent.set(parentLineNo, siblings);
  }

  // A quantity equal to the line's own is a whole-line move: a split would leave a zero-quantity
  // source, which `working_order_lines_quantity_ck` refuses.
  const wholeLineNos: number[] = [];
  type SourceLine = (typeof sourceLines)[number];
  const partials: { line: SourceLine; quantity: string; children: ExtraPart<SourceLine>[] }[] = [];
  for (const t of transfers) {
    const line = byLineNo.get(t.lineNo);
    if (line === undefined) {
      throw new AppError("tab.line_not_found", { tabId: fromTabId, lineNo: t.lineNo });
    }
    // A modifier CHILD transfers only WITH its dish.
    if (line.parentLineId != null) {
      throw new AppError("tab.transfer_modifier_line", { tabId: fromTabId, lineNo: t.lineNo });
    }
    const childLineNos = childLineNosByParent.get(t.lineNo) ?? [];
    if (t.quantity === undefined) {
      wholeLineNos.push(t.lineNo, ...childLineNos);
      continue;
    }
    const children = checkLinePart(
      fromTabId,
      line,
      t.quantity,
      childLineNos.map((childLineNo) => byLineNo.get(childLineNo)!),
      opts,
    );
    if (children === null) wholeLineNos.push(t.lineNo, ...childLineNos);
    else partials.push({ line, quantity: t.quantity, children });
  }
  if (fromTabId !== toTabId && partials.length > 0) {
    throw new Error("a part of a line is cut only within its order");
  }
  // A split keeps the source row, so its paid quantity may stay there while unpaid units move.
  await refusePaidLines(
    tx,
    fromTabId,
    partials.map(({ line, quantity }) => ({
      id: line.id,
      lineNo: line.lineNo,
      keeps: opts.splitIntoUnits
        ? 1000
        : decimalToThousandths(line.quantity) - stringToThousandths(quantity),
    })),
  );

  const movedLineIds =
    wholeLineNos.length > 0
      ? await moveOrderLines(tx, cfg, fromTabId, toTabId, wholeLineNos, { actorId: opts.actorId })
      : [];

  const splitLines = new Map<string, SplitRow>();
  const carried: { from: string; to: string }[] = [];
  // Split line numbers are allocated after the moves, so they do not collide with moved rows.
  if (partials.length > 0) {
    const [{ maxLineNo }] = await tx
      .select({
        maxLineNo: sql<number>`cast(coalesce(max(${workingOrderLines.lineNo}), 0) as int)`,
      })
      .from(workingOrderLines)
      .where(eq(workingOrderLines.workingOrderId, toTabId));
    let nextLineNo = maxLineNo!;
    /** Leave `row` holding `remaining`, and add a row of `moved` of it under the next line number;
     * answers the new row's id. */
    const splitRow = async (
      row: SourceLine,
      remaining: Decimal,
      moved: Decimal,
      parentLineId: string | null,
    ): Promise<string> => {
      const movedThousandths = decimalToThousandths(moved);
      const splitRowId = randomUUID();
      const lineNo = ++nextLineNo;
      await tx.insert(workingOrderLines).values({
        ...row.context,
        id: splitRowId,
        workingOrderId: toTabId,
        lineNo,
        productId: row.productId,
        parentLineId,
        name: row.name,
        descriptions: row.descriptions,
        optionSnapshots: row.optionSnapshots ?? [],
        quantity: movedThousandths,
        unitPriceGross: decimalToCents(row.unitPriceGross),
        priceQuantity: decimalToThousandths(row.priceQuantity),
        vatClass: row.vatClass,
        takeawayVatClass: row.takeawayVatClass,
        lineTotal: decimalToCents(grossLineTotal(row.unitPriceGross, moved, row.priceQuantity)),
        category: row.category,
        unitName: row.unitName,
        unitPrecision: row.unitPrecision,
        countAsPortions: row.countAsPortions,
        variantName: row.variantName,
        variantDescriptions: row.variantDescriptions,
        variantKitchenName: row.variantKitchenName,
        kitchenName: row.kitchenName,
        classification: row.classification,
        sentAt: row.sentAt,
        servedQuantity: 0,
        servedAt: null,
        courseId: row.courseId,
        makeAtStationId: row.makeAtStationId,
        note: row.note,
        extraListId: row.extraListId,
        groupId: row.groupId,
        creditedTo: row.creditedTo,
        listUnitPriceGross: row.listUnitPriceGross,
      });
      await splitLineServiceState(tx, row.id, splitRowId, movedThousandths);
      await tx
        .update(workingOrderLines)
        .set({
          quantity: decimalToThousandths(remaining),
          lineTotal: decimalToCents(
            grossLineTotal(row.unitPriceGross, remaining, row.priceQuantity),
          ),
        })
        .where(eq(workingOrderLines.id, row.id));
      splitLines.set(row.id, { id: splitRowId, lineNo });
      carried.push({ from: row.id, to: splitRowId });
      if (parentLineId === null)
        await copyAllergyWorkingTicks(tx, [{ from: row.id, to: splitRowId }]);
      return splitRowId;
    };
    for (const partial of partials) {
      let line = partial.line;
      const { quantity, children } = partial;
      const count = opts.splitIntoUnits ? stringToThousandths(line.quantity) / 1000 - 1 : 1;
      for (let part = 0; part < count; part += 1) {
        const remaining = subtractDecimal(decimal(line.quantity), decimal(quantity));
        const splitLineId = await splitRow(line, remaining, decimal(quantity), null);
        // Numbered straight after their dish: a receipt reads a dish's extras from the rows after it.
        for (const child of children) {
          const splitChildId = await splitRow(child.row, child.remaining, child.moved, splitLineId);
          if (child.row.ticketItemId !== null) {
            const splitTicketId = await splitTicketItem(
              tx,
              child.row.ticketItemId,
              child.row.quantity,
              splitChildId,
              child.moved,
            );
            if (splitTicketId !== null) await copyKitchenJobLines(tx, child.row.id, splitChildId);
          }
        }
        if (line.ticketItemId !== null) {
          const splitTicketId = await splitTicketItem(
            tx,
            line.ticketItemId,
            line.quantity,
            splitLineId,
            quantity,
          );
          if (splitTicketId !== null) await copyKitchenJobLines(tx, line.id, splitLineId);
        }

        line = {
          ...line,
          quantity: remaining,
          servedQuantity: Math.min(line.servedQuantity, decimalToThousandths(remaining)),
        };
        if (opts.splitIntoUnits && (part + 1) % 32 === 0) await nextTurn();
      }
    }
    await carryLineReductions(tx, carried);
  }
  if (fromTabId !== toTabId) await copyKitchenPrintLinks(tx, fromTabId, toTabId, movedLineIds);
  return { splitLines };
}
/**
 * Refuse `group.held_leaves_party` for the lowest-numbered of these lines whose group is held: a
 * bill going to the counter leaves its party, and a counter order has no groups to hold a dish in.
 */
export async function refuseHeldLeavingParty(
  tx: Transaction,
  tabId: string,
  lineIds: readonly string[],
): Promise<void> {
  if (lineIds.length === 0) return;
  const [held] = await tx
    .select({ lineNo: workingOrderLines.lineNo })
    .from(workingOrderLines)
    .innerJoin(orderGroups, eq(orderGroups.id, workingOrderLines.groupId))
    .where(and(inArray(workingOrderLines.id, [...lineIds]), eq(orderGroups.state, "held")))
    .orderBy(workingOrderLines.lineNo)
    .limit(1);
  if (held !== undefined) {
    throw new AppError("group.held_leaves_party", { tabId, lineNo: held.lineNo });
  }
}
/** Take these lines, and their extras children, out of their group: they left its party. */
export async function clearGroups(tx: Transaction, lineIds: readonly string[]): Promise<void> {
  if (lineIds.length === 0) return;
  await tx
    .update(workingOrderLines)
    .set({ groupId: null })
    .where(
      or(
        inArray(workingOrderLines.id, [...lineIds]),
        inArray(workingOrderLines.parentLineId, [...lineIds]),
      ),
    );
}
/** A row a split made. */
export interface SplitRow {
  id: string;
  lineNo: number;
}
/**
 * Split `quantity` of each of these top-level lines off into a new row of the same order, which
 * keeps its prices, group, credit and a ticket item of its own for the part; returns each new row
 * keyed by the id of the line it split. Each `quantity` must be less than its line's. A dish with
 * extras is refused unless `splitExtras` is set, as {@link carveOffLines} describes.
 */
export async function splitLinesWithinOrder(
  tx: Transaction,
  cfg: TradingContext,
  orderId: string,
  splits: { lineNo: number; quantity: string }[],
  opts: { splitExtras?: boolean } = {},
): Promise<Map<string, SplitRow>> {
  const { splitLines } = await carveOffLines(tx, cfg, orderId, orderId, splits, {
    ...opts,
  });
  return splitLines;
}

export async function splitUnitsWithinOrder(
  tx: Transaction,
  cfg: TradingContext,
  orderId: string,
  lineNo: number,
): Promise<void> {
  await carveLines(tx, cfg, orderId, orderId, [{ lineNo, quantity: "1" }], {
    splitIntoUnits: true,
  });
}

async function splitTicketItem(
  tx: Transaction,
  ticketItemId: string,
  lineQuantity: string,
  splitLineId: string,
  moved: string,
): Promise<string | null> {
  const [ticket] = await tx.select().from(ticketItems).where(eq(ticketItems.id, ticketItemId));
  const cancellations = await readLineCancellations(tx, [splitLineId]);
  const movedThousandths = stringToThousandths(moved) - (cancellations.get(splitLineId) ?? 0);
  if (movedThousandths === 0) return null;
  const asked = ticket!.quantity ?? decimalToThousandths(decimal(lineQuantity));
  await tx
    .update(ticketItems)
    .set({ quantity: asked - movedThousandths })
    .where(eq(ticketItems.id, ticketItemId));
  const id = randomUUID();
  await tx
    .insert(ticketItems)
    .values({ ...ticket!, id, workingOrderLineId: splitLineId, quantity: movedThousandths });
  await VENUE_SERVICE.copyTicketAllergy(tx, ticketItemId, id);
  const moves = await tx
    .select()
    .from(ticketItemMoves)
    .where(eq(ticketItemMoves.workingOrderLineId, ticket!.workingOrderLineId))
    .orderBy(sql`${ticketItemMoves}.rowid`);
  if (moves.length) {
    await tx
      .insert(ticketItemMoves)
      .values(
        moves.map((move) => ({ ...move, id: randomUUID(), workingOrderLineId: splitLineId })),
      );
  }
  return id;
}
