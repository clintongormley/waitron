import "./errors.js";
import {
  type Transaction,
  workingOrderLines,
  products,
  workingOrders,
  readVenueClock,
} from "@waitron/db";
import { venueMomentAt } from "@waitron/reporting";
import { AppError } from "@waitron/shared";
import { lastOrderDishes, offeredKey, type LastOrdersDecision } from "@waitron/venue-service";
import { inArray, eq } from "drizzle-orm";
import type { LateSendConfirmation } from "./late-send.js";
import { VENUE_SERVICE } from "./modules.js";
import { type FireableLine, routingOnce } from "./working-order-kitchen-fire.js";

/**
 * Refuses `menu_period.ended` unless `lateSend` confirms every menu of `late`, naming `lineIds`
 * when stored lines are being sent; otherwise the person recorded as confirming.
 */
export async function confirmLateDishes(
  tx: Transaction,
  departmentId: string,
  late: readonly { menuId: string; menuItemId: string; periodName: string }[],
  lateSend: LateSendConfirmation | undefined,
  lineIds?: readonly string[],
): Promise<string> {
  const needsManager = await VENUE_SERVICE.readLateSendNeedsManager(tx, departmentId);
  if (lateSend === undefined || late.some((dish) => !lateSend.menuIds.has(dish.menuId))) {
    throw new AppError("menu_period.ended", {
      departmentId,
      menus: [...new Map(late.map(({ menuId, periodName }) => [menuId, periodName]))].map(
        ([menuId, periodName]) => ({ menuId, periodName }),
      ),
      menuItemIds: [...new Set(late.map((dish) => dish.menuItemId))],
      needsManager,
      ...(lineIds === undefined ? {} : { workingOrderLineIds: [...lineIds] }),
    });
  }
  return lateSend.confirm(tx, needsManager);
}
/**
 * How a send treats a stored dish past last orders: `ask` refuses it unless
 * the request confirms it, `"mark"` marks it with no confirmer.
 */
export type LateUnsentMode = { ask: LateSendConfirmation | undefined; periodOnly?: true } | "mark";
/**
 * Judge stored dishes about to fire as entry judges a new one, and mark the late ones before they
 * fire, so their tickets print the mark. A dish already marked was judged when it was entered or by
 * an earlier send. Its menu is the one it was stored from; it is judged by the department of the
 * order's zone now, then by the one it was stored in ({@link unplacedLateDishes}).
 */
export async function lateUnsentDishes(
  tx: Transaction,
  orderId: string,
  lines: readonly FireableLine[],
  mode: LateUnsentMode,
  routing = routingOnce(tx, new Date()),
): Promise<void> {
  await lateUnsentDishesOf(tx, [{ orderId, lines }], mode, routing);
}
/**
 * {@link lateUnsentDishes} over several bills sent together: one refusal names the late lines of
 * every bill, and one confirmation marks them all.
 */
export async function lateUnsentDishesOf(
  tx: Transaction,
  bills: readonly {
    orderId: string;
    lines: readonly Pick<FireableLine, "id" | "parentLineId">[];
  }[],
  mode: LateUnsentMode,
  routing = routingOnce(tx, new Date()),
): Promise<void> {
  const byDepartment = new Map<string, LateUnsentDish[]>();
  for (const { orderId, lines } of bills) {
    const judged = await judgeLateUnsent(
      tx,
      orderId,
      lines,
      routing,
      mode === "mark" || !mode.periodOnly,
    );
    if (judged === null) continue;
    byDepartment.set(judged.departmentId, [
      ...(byDepartment.get(judged.departmentId) ?? []),
      ...judged.late,
    ]);
  }
  for (const [departmentId, late] of byDepartment) {
    const confirmedBy =
      mode === "mark"
        ? null
        : await confirmLateDishes(tx, departmentId, late, mode.ask, [
            ...new Set(late.map(({ namedId }) => namedId)),
          ]);
    await VENUE_SERVICE.recordLateSendMarks(
      tx,
      late.map(({ lineId, periodId, periodName }) => ({
        lineId,
        periodId: confirmedBy === null ? null : periodId,
        periodName,
        confirmedBy,
      })),
    );
  }
}
interface LateUnsentDish {
  lineId: string;
  /** The stored line a refusal names: an extra's dish when the extra is judged without it. */
  namedId: string;
  /** The dish whose product the also-sold rule reads. */
  dishId: string;
  menuId: string;
  menuItemId: string;
  periodId: string | null;
  periodName: string;
}
type LineContext = Awaited<ReturnType<typeof VENUE_SERVICE.listLineContexts>>[number];

async function judgeLateUnsent(
  tx: Transaction,
  orderId: string,
  lines: readonly Pick<FireableLine, "id" | "parentLineId">[],
  routing: ReturnType<typeof routingOnce>,
  checkCutoffs: boolean,
): Promise<{ departmentId: string; late: LateUnsentDish[] } | null> {
  if (lines.length === 0) return null;
  const order = await VENUE_SERVICE.findOrderContext(tx, orderId);
  if (order === null) return null;
  const extras = await tx
    .select({ id: workingOrderLines.id, parentLineId: workingOrderLines.parentLineId })
    .from(workingOrderLines)
    .where(
      inArray(
        workingOrderLines.parentLineId,
        lines.map((line) => line.id),
      ),
    );
  const marked = await VENUE_SERVICE.readLateSendMarks(tx, [
    ...lines.map((line) => line.id),
    ...extras.map((extra) => extra.id),
  ]);
  // A marked dish was judged with the extras it had then, which carry its mark; one stored on it
  // since is judged on its own.
  const pending = [
    ...lines
      .filter((line) => !marked.has(line.id))
      .map((line) => ({ lineId: line.id, namedId: line.id, dishId: line.parentLineId ?? line.id })),
    ...extras
      .filter((extra) => !marked.has(extra.id) && marked.has(extra.parentLineId!))
      .map((extra) => ({
        lineId: extra.id,
        namedId: extra.parentLineId!,
        dishId: extra.parentLineId!,
      })),
  ];
  if (pending.length === 0) return null;
  const { at: now } = routing;
  const zone = await VENUE_SERVICE.resolveZoneContext(tx, order.zoneId);
  const service = await VENUE_SERVICE.resolveDepartmentService(tx, zone.departmentId, now);
  const periodOf = new Map(service.endedMenus.map((menu) => [menu.menuId, menu]));
  const contexts = await VENUE_SERVICE.listLineContexts(tx, orderId);
  const contextOf = new Map(contexts.map((context) => [context.workingOrderLineId, context]));
  const settings = new Map([[service.departmentId, checkCutoffs ? service.lastOrders : undefined]]);
  for (const { lineId } of checkCutoffs ? pending : []) {
    const departmentId = contextOf.get(lineId)?.departmentId;
    if (departmentId !== undefined && !settings.has(departmentId))
      settings.set(departmentId, await (await routing()).lastOrdersFor(departmentId));
  }
  const routed = new Map<string, LastOrdersDecision>();
  if ([...settings.values()].some((service) => service !== undefined)) {
    const stored = await tx
      .select({ id: workingOrderLines.id, productId: workingOrderLines.productId })
      .from(workingOrderLines)
      .where(
        inArray(
          workingOrderLines.id,
          pending.map(({ dishId }) => dishId),
        ),
      );
    const productOf = new Map(stored.map(({ id, productId }) => [id, productId]));
    const candidates = pending.flatMap(({ lineId, dishId }) => {
      const context = contextOf.get(lineId);
      const productId = productOf.get(dishId);
      return context === undefined || productId == null
        ? []
        : [{ key: lineId, menuId: context.menuId, productId, departmentId: context.departmentId }];
    });
    for (const [departmentId, service] of settings) {
      const dishes = candidates.filter((line) => line.departmentId === departmentId);
      for (const [id, decision] of await lastOrderDishes(service, zone.zoneId, dishes, routing))
        routed.set(id, decision);
    }
  }
  const cutoffLate: LateUnsentDish[] = [];
  const ended: LateUnsentDish[] = [];
  const unplaced: { line: (typeof pending)[number]; context: LineContext }[] = [];
  for (const line of pending) {
    const context = contextOf.get(line.lineId);
    if (context === undefined) continue;
    const decision = routed.get(line.lineId);
    if (decision !== undefined) {
      if (decision.stopped && decision.route.kind === "station")
        cutoffLate.push({
          ...line,
          menuId: context.menuId,
          menuItemId: context.menuItemId,
          ...decision.run,
        });
      continue;
    }
    if (service.orderableMenuIds.includes(context.menuId)) continue;
    const period = periodOf.get(context.menuId);
    if (period === undefined) unplaced.push({ line, context });
    else ended.push({ ...line, ...period, menuItemId: context.menuItemId });
  }
  ended.push(...(await unplacedLateDishes(tx, orderId, service, unplaced, now)));
  const dishes =
    ended.length === 0
      ? []
      : await tx
          .select({
            id: workingOrderLines.id,
            productId: workingOrderLines.productId,
            parentProductId: products.parentId,
          })
          .from(workingOrderLines)
          .innerJoin(products, eq(products.id, workingOrderLines.productId))
          .where(inArray(workingOrderLines.id, [...new Set(ended.map(({ dishId }) => dishId))]));
  const soldAs = new Map(
    dishes.map((dish) => [
      dish.id,
      dish.parentProductId === null
        ? { productId: dish.productId!, variantId: null }
        : { productId: dish.parentProductId, variantId: dish.productId! },
    ]),
  );
  const alsoSold =
    ended.length === 0
      ? new Set<string>()
      : await VENUE_SERVICE.productsOfferedIn(tx, zone.zoneId, service.orderableMenuIds, [
          ...soldAs.values(),
        ]);
  const late = [
    ...cutoffLate,
    ...ended.filter(({ dishId }) => {
      const sold = soldAs.get(dishId)!;
      return !alsoSold.has(offeredKey(sold.productId, sold.variantId));
    }),
  ];
  if (late.length === 0) return null;
  // A late dish's extras are judged with it, as entry marks them with it.
  const lateDish = new Map(late.map((dish) => [dish.lineId, dish]));
  for (const extra of extras) {
    const dish = lateDish.get(extra.parentLineId!);
    if (dish !== undefined && !marked.has(extra.id)) late.push({ ...dish, lineId: extra.id });
  }
  return { departmentId: service.departmentId, late };
}
/**
 * The late ones of stored lines whose menu the order's department neither sells nor ended today,
 * judged by the department they were stored in. When that one neither sells the menu now nor ended
 * it today, or is gone, no stored row names the period the line was taken under, so the line is late
 * under its menu's name, and only on the business day its order was opened, as no line records when
 * it was added.
 */
async function unplacedLateDishes(
  tx: Transaction,
  orderId: string,
  orderService: DepartmentServiceOf,
  unplaced: readonly {
    line: Omit<LateUnsentDish, "menuId" | "menuItemId" | "periodId" | "periodName">;
    context: LineContext;
  }[],
  now: Date,
): Promise<LateUnsentDish[]> {
  const services = new Map<string, DepartmentServiceOf | null>([
    [orderService.departmentId, orderService],
  ]);
  let storedToday: boolean | undefined;
  const late: LateUnsentDish[] = [];
  for (const { line, context } of unplaced) {
    if (!services.has(context.departmentId))
      services.set(
        context.departmentId,
        await activeDepartmentService(tx, context.departmentId, now),
      );
    const own = services.get(context.departmentId)!;
    if (own?.orderableMenuIds.includes(context.menuId) === true) continue;
    const ownPeriod = own?.endedMenus.find((menu) => menu.menuId === context.menuId);
    if (ownPeriod === undefined && !(storedToday ??= await openedToday(tx, orderId, now))) continue;
    late.push({
      ...line,
      menuId: context.menuId,
      menuItemId: context.menuItemId,
      periodId: ownPeriod?.periodId ?? null,
      periodName: ownPeriod?.periodName ?? context.menuName,
    });
  }
  return late;
}
type DepartmentServiceOf = Awaited<ReturnType<typeof VENUE_SERVICE.resolveDepartmentService>>;
export type EndedMenu = DepartmentServiceOf["endedMenus"][number];
/** The department's service now, or null when it has been removed. */
async function activeDepartmentService(
  tx: Transaction,
  departmentId: string,
  now: Date,
): Promise<DepartmentServiceOf | null> {
  try {
    return await VENUE_SERVICE.resolveDepartmentService(tx, departmentId, now);
  } catch (error) {
    if (error instanceof AppError && error.code === "department.not_found") return null;
    throw error;
  }
}
/** Whether the order was opened on the business day `now` falls in. */
async function openedToday(tx: Transaction, orderId: string, now: Date): Promise<boolean> {
  const [order] = await tx
    .select({ openedAt: workingOrders.openedAt })
    .from(workingOrders)
    .where(eq(workingOrders.id, orderId));
  if (order === undefined) return false;
  const clock = await readVenueClock(tx);
  const today = venueMomentAt(now, clock)?.businessDay;
  return (
    today !== undefined && venueMomentAt(new Date(order.openedAt), clock)?.businessDay === today
  );
}
