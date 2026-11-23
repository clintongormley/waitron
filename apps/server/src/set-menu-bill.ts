import { and, eq, gt, inArray, isNotNull, sql } from "drizzle-orm";
import {
  adjustmentLines,
  adjustments,
  billPaymentLines,
  billPayments,
  billSetMenuCopies,
  lineServiceCancellations,
  menuItems,
  orderDraftLines,
  orderDrafts,
  products,
  workingOrderLines,
  workingOrders,
  type Transaction,
} from "@waitron/db";
import {
  AppError,
  contentLanguageCode,
  placeInOrder,
  setMenuCopyOf,
  type BillSetMenuState,
  type Dining,
  type DishPlace,
  type DishToPlace,
  type PlacementResult,
  type ServedSetMenuCopy,
} from "@waitron/shared";
import { serveRecordedSetMenus } from "@waitron/venue-service";
import "./errors.js";

type LineRole = Pick<typeof workingOrderLines.$inferSelect, "setMenuRole">;

export function notSetMenuLine() {
  return sql`${workingOrderLines.setMenuRole} is not 'set_menu'`;
}

export async function hasBillSetMenuLines(
  tx: Transaction,
  workingOrderId: string,
): Promise<boolean> {
  const [line] = await tx
    .select({ id: workingOrderLines.id })
    .from(workingOrderLines)
    .where(
      and(
        eq(workingOrderLines.workingOrderId, workingOrderId),
        isNotNull(workingOrderLines.setMenuRole),
      ),
    )
    .limit(1);
  return line !== undefined;
}

export async function hasDraftSetMenuLines(tx: Transaction, draftId: string): Promise<boolean> {
  const [line] = await tx
    .select({ id: orderDraftLines.id })
    .from(orderDraftLines)
    .where(and(eq(orderDraftLines.draftId, draftId), isNotNull(orderDraftLines.setMenuId)))
    .limit(1);
  return line !== undefined;
}

// A takeaway set menu files at its own takeaway class beside lines at their products' takeaway
// rates; VAT-RATES piece B's payment check replaces this refusal.
export async function refuseSetMenuMoney(
  tx: Transaction,
  workingOrderId: string,
  lines?: readonly LineRole[],
  dining?: Dining,
): Promise<void> {
  if (lines !== undefined && !lines.some((line) => line.setMenuRole !== null)) return;
  if (lines !== undefined && dining !== undefined) {
    if (dining === "takeaway") throw new AppError("set_menu.payment_not_ready", {});
    return;
  }
  const [line] = await tx
    .select({ id: workingOrderLines.id })
    .from(workingOrderLines)
    .innerJoin(workingOrders, eq(workingOrders.id, workingOrderLines.workingOrderId))
    .where(
      and(
        eq(workingOrderLines.workingOrderId, workingOrderId),
        isNotNull(workingOrderLines.setMenuRole),
        eq(workingOrders.dining, "takeaway"),
      ),
    )
    .limit(1);
  if (line !== undefined) throw new AppError("set_menu.payment_not_ready", {});
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

export async function carryBillSetMenuCopies(
  tx: Transaction,
  fromBillId: string,
  toBillId: string,
  menuIds?: readonly string[],
): Promise<void> {
  await tx
    .insert(billSetMenuCopies)
    .select(
      tx
        .select({
          workingOrderId: sql<string>`${toBillId}`.as("working_order_id"),
          setMenuId: billSetMenuCopies.setMenuId,
          menuVersionId: billSetMenuCopies.menuVersionId,
        })
        .from(billSetMenuCopies)
        .where(
          and(
            eq(billSetMenuCopies.workingOrderId, fromBillId),
            menuIds === undefined
              ? undefined
              : inArray(
                  billSetMenuCopies.setMenuId,
                  sql`(select value from json_each(${JSON.stringify(menuIds)}))`,
                ),
          ),
        ),
    )
    .onConflictDoNothing({
      target: [billSetMenuCopies.workingOrderId, billSetMenuCopies.setMenuId],
    });
}

export async function readBillSetMenus(
  tx: Transaction,
  workingOrderId: string,
): Promise<BillSetMenuState> {
  return (await readBillsSetMenus(tx, [workingOrderId])).get(workingOrderId)!.setMenus;
}

interface BillSetMenusRead {
  setMenus: BillSetMenuState;
  setMenuCopies: ServedSetMenuCopy[];
}

export async function readBillsSetMenus(
  tx: Transaction,
  billIds: string[],
): Promise<Map<string, BillSetMenusRead>> {
  if (billIds.length === 0) return new Map();
  const billValues = sql`(select value from json_each(${JSON.stringify(billIds)}))`;
  const lines = await tx
    .select({
      billId: workingOrderLines.workingOrderId,
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
      cancellationLineId: lineServiceCancellations.lineId,
      parentProductId: products.parentId,
    })
    .from(workingOrderLines)
    .leftJoin(products, eq(products.id, workingOrderLines.productId))
    .leftJoin(lineServiceCancellations, eq(lineServiceCancellations.lineId, workingOrderLines.id))
    .where(
      and(
        inArray(workingOrderLines.workingOrderId, billValues),
        isNotNull(workingOrderLines.setMenuRole),
      ),
    )
    .orderBy(workingOrderLines.lineNo);
  const versions = await tx
    .select({
      billId: billSetMenuCopies.workingOrderId,
      menuId: billSetMenuCopies.setMenuId,
      versionId: billSetMenuCopies.menuVersionId,
    })
    .from(billSetMenuCopies)
    .where(inArray(billSetMenuCopies.workingOrderId, billValues));

  const menuLines = lines.filter((line) => line.role === "set_menu");
  const key = ({ menuId, versionId }: { menuId: string | null; versionId: string | null }) =>
    `${versionId}:${menuId}`;
  const requests = [
    ...new Map(
      [
        ...versions,
        ...menuLines.map(({ menuId, versionId }) => ({
          menuId: menuId!,
          versionId: versionId!,
        })),
      ].map((request) => [key(request), request]),
    ).values(),
  ];
  const served = requests.length === 0 ? [] : await serveRecordedSetMenus(tx, requests);
  const servedByVersion = new Map(requests.map((request, i) => [key(request), served[i]!]));
  const placed = lines.filter((line) => line.role === "dish" && line.setMenuLineId !== null);
  const dishes = placed.length === 0 ? [] : await placedSetMenuDishes(tx, placed);
  return new Map(
    billIds.map((billId) => {
      const billVersions = versions.filter((row) => row.billId === billId);
      const billMenus = menuLines.filter((row) => row.billId === billId);
      const copies = new Map<string, { copy: ServedSetMenuCopy; versionId: string }>();
      for (const row of [...billVersions, ...billMenus]) {
        const copy = servedByVersion.get(key(row))!;
        if (!copies.has(copy.key)) copies.set(copy.key, { copy, versionId: row.versionId! });
      }
      return [
        billId,
        {
          setMenus: {
            copies: [...copies.values()].map(({ copy, versionId }) =>
              setMenuCopyOf(copy, versionId),
            ),
            recorded: Object.fromEntries(
              billVersions.map(({ menuId, versionId }) => [menuId, versionId]),
            ),
            setMenus: billMenus.map(({ id, lineNo, menuId, versionId }) => ({
              lineId: id,
              lineNo,
              copyId: servedByVersion.get(key({ menuId, versionId }))!.key,
            })),
            dishes: dishes.filter((dish) => dish.billId === billId).map(({ dish }) => dish),
          },
          setMenuCopies: [...copies.values()].map(({ copy }) => copy),
        },
      ];
    }),
  );
}

async function placedSetMenuDishes(
  tx: Transaction,
  placed: {
    billId: string;
    id: string;
    productId: string | null;
    parentProductId: string | null;
    setMenuLineId: string | null;
    place: number | null;
    priceCents: number;
    countsAsCourseId: string | null;
    cancellationLineId: string | null;
  }[],
) {
  const billValues = sql`(select value from json_each(${JSON.stringify([...new Set(placed.map(({ billId }) => billId))])}))`;
  const payments = await tx
    .select({ billId: billPayments.workingOrderId, lineId: billPaymentLines.lineId })
    .from(billPaymentLines)
    .innerJoin(billPayments, eq(billPayments.id, billPaymentLines.billPaymentId))
    .where(inArray(billPayments.workingOrderId, billValues));
  const actions = await tx
    .select({
      billId: adjustments.workingOrderId,
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
    .where(inArray(adjustments.workingOrderId, billValues));
  const key = (billId: string, lineId: string) => `${billId}:${lineId}`;
  const fixed = new Set(payments.map(({ billId, lineId }) => key(billId, lineId)));
  const cancelled = new Set<string>();
  for (const { billId, lineId, action, chargeKept, reducedLineId } of actions) {
    if (action === "cancel" && lineId !== null) {
      if (chargeKept) fixed.add(key(billId, lineId));
      else cancelled.add(key(billId, lineId));
    }
    if (reducedLineId !== null) fixed.add(key(billId, reducedLineId));
  }
  return placed
    .filter(({ billId, id }) => !cancelled.has(key(billId, id)))
    .map((line) => ({
      billId: line.billId,
      dish: {
        lineId: line.id,
        productId: line.parentProductId ?? line.productId!,
        variantId: line.parentProductId === null ? null : line.productId,
        setMenuLineId: line.setMenuLineId!,
        place: line.place!,
        priceCents: line.priceCents,
        countsAsCourseId: line.countsAsCourseId!,
        movable: line.cancellationLineId === null && !fixed.has(key(line.billId, line.id)),
      },
    }));
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

/** Server-validated lines carry their placement order and reservation into pricing. */
export const SET_MENU_DRAFT_LINE = Symbol("setMenuDraftLine");

export interface SetMenuDraftLine {
  draftLineId?: string;
  position: number;
  setMenuId: string;
  held: boolean;
  reserved: DishPlace | null;
}

type WorkingLine = typeof workingOrderLines.$inferInsert;
export interface SetMenuPlacement {
  workingOrderLineId: string;
  draft: Pick<SetMenuDraftLine, "position" | "setMenuId" | "reserved" | "draftLineId">;
  productId: string;
  variantId: string | null;
}

export function setMenuDishColumns(result: PlacementResult) {
  return {
    setMenuLineId: result.setMenuLineId,
    setMenuPlace: result.place,
    setMenuCountsAsCourseId: result.countsAsCourseId,
    unitPriceGross: result.priceCents,
    lineTotal: result.priceCents,
  };
}

export async function readSetMenuReservations(
  tx: Transaction,
  workingOrderId: string,
  sending: ReadonlySet<string> = new Set(),
): Promise<DishPlace[]> {
  const reservations = await tx
    .select({
      draftLineId: orderDraftLines.id,
      setMenuLineId: orderDraftLines.setMenuReservedLineId,
      place: orderDraftLines.setMenuReservedPlace,
    })
    .from(orderDraftLines)
    .innerJoin(orderDrafts, eq(orderDrafts.id, orderDraftLines.draftId))
    .where(
      and(
        eq(orderDrafts.billId, workingOrderId),
        eq(orderDrafts.state, "open"),
        isNotNull(orderDraftLines.setMenuReservedLineId),
      ),
    );
  return reservations.flatMap(({ draftLineId, setMenuLineId, place }) =>
    sending.has(draftLineId) || setMenuLineId === null || place === null
      ? []
      : [{ setMenuLineId, place }],
  );
}

export async function refuseDraftLosingSetMenuPlace(
  tx: Transaction,
  billId: string,
  removedMenus: ReadonlySet<string>,
  leavingLines: ReadonlySet<string> = removedMenus,
): Promise<void> {
  const rows = await tx
    .select({
      id: orderDraftLines.id,
      productId: menuItems.productId,
      variantId: orderDraftLines.variantId,
      name: products.name,
      setMenuLineId: orderDraftLines.setMenuReservedLineId,
      place: orderDraftLines.setMenuReservedPlace,
    })
    .from(orderDraftLines)
    .innerJoin(orderDrafts, eq(orderDrafts.id, orderDraftLines.draftId))
    .innerJoin(menuItems, eq(menuItems.id, orderDraftLines.menuItemId))
    .innerJoin(
      products,
      eq(products.id, sql`coalesce(${orderDraftLines.variantId}, ${menuItems.productId})`),
    )
    .where(
      and(
        eq(orderDrafts.billId, billId),
        eq(orderDrafts.state, "open"),
        isNotNull(orderDraftLines.setMenuId),
      ),
    )
    .orderBy(orderDrafts.createdAt, orderDrafts.id, orderDraftLines.position);
  if (rows.length === 0) return;
  const dishes = rows.map(({ id, productId, variantId, setMenuLineId, place }) => ({
    id,
    productId,
    variantId,
    reserved: setMenuLineId === null || place === null ? null : { setMenuLineId, place },
  }));
  const state = await readBillSetMenus(tx, billId);
  const before = placeInOrder(state, dishes).placed;
  const after = placeInOrder(
    {
      ...state,
      setMenus: state.setMenus.filter(({ lineId }) => !removedMenus.has(lineId)),
      dishes: state.dishes.filter(({ lineId }) => !leavingLines.has(lineId)),
    },
    dishes,
  );
  const unplaced = new Set(after.unplaced);
  const lost = before.filter(({ id }) => unplaced.has(id));
  if (lost.length === 0) return;

  const menu = state.setMenus.find(({ lineId }) => removedMenus.has(lineId))!;
  const copy = state.copies.find(({ id }) => id === menu.copyId)!;
  const names = new Map(rows.map(({ id, name }) => [id, name]));
  throw new AppError("set_menu.needed_by_draft", {
    setMenuName: copy.name,
    dishNames: [...new Set(lost.map(({ id }) => names.get(id)!))],
  });
}

export async function placeSetMenuRows(
  tx: Transaction,
  workingOrderId: string,
  rows: readonly WorkingLine[],
  order: readonly SetMenuPlacement[],
): Promise<readonly WorkingLine[]> {
  if (order.length === 0) return rows;
  const state = await readBillSetMenus(tx, workingOrderId);
  const sending = new Set(order.flatMap(({ draft }) => draft.draftLineId ?? []));
  const held = await readSetMenuReservations(tx, workingOrderId, sending);
  const dishes: DishToPlace[] = [...order]
    .sort((a, b) => a.draft.position - b.draft.position)
    .map(({ workingOrderLineId: id, draft, productId, variantId }) => ({
      id,
      productId,
      variantId,
      reserved: draft.reserved,
    }));
  const { placed, unplaced } = placeInOrder(state, dishes, held);
  const refused = unplaced[0];
  if (refused !== undefined) {
    const draftLineId = order.find(({ workingOrderLineId }) => workingOrderLineId === refused)!
      .draft.draftLineId;
    throw new AppError("set_menu.no_place", {
      dishName: rows.find((row) => row.id === refused)!.name,
      ...(draftLineId === undefined ? {} : { draftLineId }),
    });
  }
  const resultById = new Map(placed.map((place) => [place.id, place]));
  const menuOfRow = new Map(
    order.map(({ workingOrderLineId, draft }) => [workingOrderLineId, draft.setMenuId]),
  );
  return rows.map((row) => {
    const placement = resultById.get(row.id!);
    return placement === undefined
      ? row
      : {
          ...row,
          setMenuRole: "dish",
          setMenuId: menuOfRow.get(placement.id)!,
          ...setMenuDishColumns(placement),
        };
  });
}
