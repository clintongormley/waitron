import "./errors.js";
import { and, eq, gte, inArray, type SQL } from "drizzle-orm";
import { worstBand } from "@waitron/shared";
import { ticketItems, workingOrderLines, workingOrders } from "@waitron/db";
import type { Transaction } from "@waitron/db";
import type { ResolvedKitchenScreen } from "@waitron/module";
import type { TillConfig } from "./till-config.js";
import { orderWatchZones } from "./watch-zones.js";
import {
  liveKitchenDish,
  readPassBoard,
  type ExpoCourse,
  type ExpoGroup,
  type ExpoOrder,
} from "./working-order.js";

/** null: every station (zone). */
export interface PassScope {
  stationIds: readonly string[] | null;
  zoneIds: readonly string[] | null;
}

export type PassCourse = ExpoCourse & { allReady: boolean };
export type PassGroup = ExpoGroup & { allReady: boolean };
export type PassOrder = Omit<ExpoOrder, "courses" | "groups"> & {
  courses: PassCourse[];
  groups: PassGroup[];
};

/** A dish in no zone is seen only by a pass on every zone. */
export function passSees(
  scope: PassScope,
  dish: { stationId: string; zoneId: string | null },
): boolean {
  return (
    (scope.stationIds === null || scope.stationIds.includes(dish.stationId)) &&
    (scope.zoneIds === null || (dish.zoneId !== null && scope.zoneIds.includes(dish.zoneId)))
  );
}

/** What a device's pass screen or pass monitor shows now: its available stations and zones. */
export function passScopeOf(screen: ResolvedKitchenScreen): PassScope {
  const shown = (slots: readonly { id: string; available: boolean }[]) =>
    slots.filter((slot) => slot.available).map((slot) => slot.id);
  return {
    stationIds: shown(screen.stations),
    zoneIds: screen.zones === null ? null : shown(screen.zones),
  };
}

/** The pass retains unserved food until service ends, independently of device marks. */
export async function listPassScreen(
  tx: Transaction,
  cfg: TillConfig,
  deviceId: string,
  scope: PassScope,
): Promise<{ orders: PassOrder[] }> {
  void deviceId;
  const kept = await scopedItems(tx, cfg, scope);
  if (!kept.length) return { orders: [] };
  const ids = new Set(kept.map((item) => item.id));
  const orders = await readPassBoard(
    tx,
    cfg.locationId,
    inArray(workingOrders.id, [...new Set(kept.map((item) => item.orderId))]),
  );
  const section = <T extends ExpoCourse | ExpoGroup>(
    part: T,
  ): (T & { allReady: boolean }) | null => {
    const allReady = part.items.every((item) => item.state === "ready");
    const items = part.items.filter((item) => ids.has(item.id));
    return items.length
      ? ({ ...part, allReady, items } as unknown as T & { allReady: boolean })
      : null;
  };
  return {
    orders: orders.map((order) =>
      withSections(
        order,
        order.courses.flatMap((part) => section(part) ?? []),
        order.groups.flatMap((part) => section(part) ?? []),
      ),
    ),
  };
}

/** The monitor shares the pass's service lifetime and cannot mark work complete. */
export async function listPassMonitor(
  tx: Transaction,
  cfg: TillConfig,
  scope: PassScope,
): Promise<{ orders: ExpoOrder[] }> {
  const kept = await scopedItems(tx, cfg, scope);
  if (!kept.length) return { orders: [] };
  const ids = new Set(kept.map((item) => item.id));
  const orders = await readPassBoard(
    tx,
    cfg.locationId,
    inArray(workingOrders.id, [...new Set(kept.map((item) => item.orderId))]),
  );
  const section = <T extends ExpoCourse | ExpoGroup>(part: T): T | null => {
    const items = part.items.filter((item) => ids.has(item.id));
    return items.length ? { ...part, items } : null;
  };
  return {
    orders: orders.map((order) =>
      withSections(
        order,
        order.courses.flatMap((part) => section(part) ?? []),
        order.groups.flatMap((part) => section(part) ?? []),
      ),
    ),
  };
}

/** A live kitchen dish at this location. `scopedItems` and `firedPassDishes` both read it, so the
 *  dark-pass alert counts only dishes a pass board would list. */
function liveKitchenDishAt(cfg: TillConfig): SQL | undefined {
  return and(eq(workingOrders.locationId, cfg.locationId), liveKitchenDish());
}

/** The live kitchen dishes the scope sees. */
async function scopedItems(
  tx: Transaction,
  cfg: TillConfig,
  scope: PassScope,
): Promise<{ id: string; orderId: string }[]> {
  if (scope.stationIds?.length === 0 || scope.zoneIds?.length === 0) return [];
  const candidates = await tx
    .select({
      id: ticketItems.id,
      orderId: workingOrders.id,
      partyId: workingOrders.partyId,
      deliveryTableId: workingOrders.deliveryTableId,
      stationId: ticketItems.stationId,
    })
    .from(ticketItems)
    .innerJoin(workingOrders, eq(ticketItems.workingOrderId, workingOrders.id))
    .innerJoin(workingOrderLines, eq(ticketItems.workingOrderLineId, workingOrderLines.id))
    .where(
      and(
        liveKitchenDishAt(cfg),
        scope.stationIds === null
          ? undefined
          : inArray(ticketItems.stationId, [...scope.stationIds]),
      ),
    );
  if (scope.zoneIds === null) return candidates;
  const zones = await rowsWatchZones(tx, cfg, candidates);
  return candidates.filter((item) =>
    passSees(scope, { stationId: item.stationId, zoneId: zones.get(item.orderId)! }),
  );
}

/** Every live kitchen dish at this location fired at or after `firedSince`, with its order's
 *  watched zone when `withZones`, else a null zone. */
export async function firedPassDishes(
  tx: Transaction,
  cfg: TillConfig,
  firedSince: string,
  withZones: boolean,
): Promise<
  {
    id: string;
    stationId: string;
    zoneId: string | null;
  }[]
> {
  const rows = await tx
    .select({
      id: ticketItems.id,
      orderId: workingOrders.id,
      partyId: workingOrders.partyId,
      deliveryTableId: workingOrders.deliveryTableId,
      stationId: ticketItems.stationId,
    })
    .from(ticketItems)
    .innerJoin(workingOrders, eq(ticketItems.workingOrderId, workingOrders.id))
    .innerJoin(workingOrderLines, eq(ticketItems.workingOrderLineId, workingOrderLines.id))
    .where(and(liveKitchenDishAt(cfg), gte(ticketItems.firedAt, firedSince)));
  const zones = withZones ? await rowsWatchZones(tx, cfg, rows) : new Map<string, string>();
  return rows.map(({ id, orderId, stationId }) => ({
    id,
    stationId,
    zoneId: zones.get(orderId) ?? null,
  }));
}

/** The watched zone of each order the rows belong to, each order asked about once. */
function rowsWatchZones(
  tx: Transaction,
  cfg: TillConfig,
  rows: readonly { orderId: string; partyId: string | null; deliveryTableId: string | null }[],
): Promise<Map<string, string | null>> {
  return orderWatchZones(tx, cfg, [
    ...new Map(
      rows.map(({ orderId, partyId, deliveryTableId }) => [
        orderId,
        { id: orderId, partyId, deliveryTableId },
      ]),
    ).values(),
  ]);
}

function withSections<C extends ExpoCourse, G extends ExpoGroup>(
  order: ExpoOrder,
  courses: C[],
  groups: G[],
): Omit<ExpoOrder, "courses" | "groups"> & { courses: C[]; groups: G[] } {
  const visible = [...courses, ...groups].flatMap((part) => part.items);
  return {
    ...order,
    courses,
    groups,
    worstBand: worstBand(visible.map((item) => item.band)),
  };
}
