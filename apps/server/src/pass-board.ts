import "./errors.js";
import { and, eq, gte, inArray, isNull, ne, notExists, type SQL } from "drizzle-orm";
import { AppError, worstBand } from "@waitron/shared";
import { passItemMarks, ticketItems, workingOrderLines, workingOrders } from "@waitron/db";
import type { Transaction } from "@waitron/db";
import type { ResolvedKitchenScreen } from "@waitron/module";
import type { TillConfig } from "./till-config.js";
import { orderWatchZones } from "./watch-zones.js";
import { readPassBoard, type ExpoCourse, type ExpoGroup, type ExpoOrder } from "./working-order.js";

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

/** The pass screen: dishes kept until this device marks them Done. */
export async function listPassScreen(
  tx: Transaction,
  cfg: TillConfig,
  deviceId: string,
  scope: PassScope,
): Promise<{ orders: PassOrder[] }> {
  const kept = await scopedItems(tx, cfg, scope, (stationScope) =>
    and(
      isNull(workingOrderLines.servedAt),
      stationScope,
      notExists(
        tx
          .select({ id: passItemMarks.ticketItemId })
          .from(passItemMarks)
          .where(
            and(
              eq(passItemMarks.deviceId, deviceId),
              eq(passItemMarks.ticketItemId, ticketItems.id),
            ),
          ),
      ),
    ),
  );
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

/** The pass monitor: the every-station read narrowed to the scope; no marks. With
 *  no Done to clear them, a section whose dishes here are all away drops off. */
export async function listPassMonitor(
  tx: Transaction,
  cfg: TillConfig,
  scope: PassScope,
): Promise<{ orders: ExpoOrder[] }> {
  const kept = await scopedItems(tx, cfg, scope, (stationScope) => stationScope);
  const waiting = new Set(kept.filter((item) => item.awayAt === null).map((item) => item.orderId));
  if (!waiting.size) return { orders: [] };
  const ids = new Set(kept.map((item) => item.id));
  const orders = await readPassBoard(tx, cfg.locationId, inArray(workingOrders.id, [...waiting]));
  const section = <T extends ExpoCourse | ExpoGroup>(part: T): T | null => {
    const items = part.items.filter((item) => ids.has(item.id));
    return items.some((item) => item.awayAt === null) ? { ...part, items } : null;
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

/** Marks or unmarks the device's Done; a dish at another location, or one the scope does not see,
 *  refuses the whole request. */
export async function markPassItems(
  tx: Transaction,
  cfg: TillConfig,
  by: { deviceId: string; personId: string | null },
  scope: PassScope,
  ticketItemIds: readonly string[],
  done: boolean,
  at: Date,
): Promise<void> {
  const rows = await tx
    .select({
      id: ticketItems.id,
      locationId: workingOrders.locationId,
      stationId: ticketItems.stationId,
      orderId: workingOrders.id,
      partyId: workingOrders.partyId,
      deliveryTableId: workingOrders.deliveryTableId,
    })
    .from(ticketItems)
    .innerJoin(workingOrderLines, eq(workingOrderLines.id, ticketItems.workingOrderLineId))
    // The item has a denormalised order id; both paths must name the same order before we write.
    .innerJoin(
      workingOrders,
      and(
        eq(workingOrders.id, workingOrderLines.workingOrderId),
        eq(workingOrders.id, ticketItems.workingOrderId),
      ),
    )
    .where(inArray(ticketItems.id, [...ticketItemIds]));
  const zones =
    scope.zoneIds === null ? new Map<string, string | null>() : await rowsWatchZones(tx, cfg, rows);
  if (
    rows.some(
      (row) =>
        row.locationId !== cfg.locationId ||
        !passSees(scope, { stationId: row.stationId, zoneId: zones.get(row.orderId) ?? null }),
    )
  ) {
    throw new AppError("management.request_invalid", { field: "ticketItemIds" });
  }
  const localIds = rows.map(({ id }) => id);
  if (!localIds.length) return;
  if (!done) {
    await tx
      .delete(passItemMarks)
      .where(
        and(eq(passItemMarks.deviceId, by.deviceId), inArray(passItemMarks.ticketItemId, localIds)),
      );
    return;
  }
  await tx
    .insert(passItemMarks)
    .values(
      localIds.map((id) => ({
        deviceId: by.deviceId,
        ticketItemId: id,
        doneAt: at.toISOString(),
        doneByPersonId: by.personId,
      })),
    )
    .onConflictDoNothing({ target: [passItemMarks.deviceId, passItemMarks.ticketItemId] });
}

/** The live kitchen dishes the scope sees, filtered further by `where`. */
async function scopedItems(
  tx: Transaction,
  cfg: TillConfig,
  scope: PassScope,
  where: (stationScope: SQL | undefined) => SQL | undefined,
): Promise<{ id: string; orderId: string; awayAt: string | null }[]> {
  if (scope.stationIds?.length === 0 || scope.zoneIds?.length === 0) return [];
  const candidates = await tx
    .select({
      id: ticketItems.id,
      orderId: workingOrders.id,
      partyId: workingOrders.partyId,
      deliveryTableId: workingOrders.deliveryTableId,
      stationId: ticketItems.stationId,
      awayAt: ticketItems.awayAt,
    })
    .from(ticketItems)
    .innerJoin(workingOrders, eq(ticketItems.workingOrderId, workingOrders.id))
    .innerJoin(workingOrderLines, eq(ticketItems.workingOrderLineId, workingOrderLines.id))
    .where(
      and(
        eq(workingOrders.locationId, cfg.locationId),
        ne(workingOrders.status, "abandoned"),
        isNull(workingOrders.collectedAt),
        eq(ticketItems.madeHere, false),
        where(
          scope.stationIds === null
            ? undefined
            : inArray(ticketItems.stationId, [...scope.stationIds]),
        ),
      ),
    );
  if (scope.zoneIds === null) return candidates;
  const zones = await rowsWatchZones(tx, cfg, candidates);
  return candidates.filter((item) =>
    passSees(scope, { stationId: item.stationId, zoneId: zones.get(item.orderId)! }),
  );
}

/** Every live kitchen dish fired at or after `firedSince`, with its order's watched zone when
 *  `withZones`, else a null zone. */
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
    servedAt: string | null;
    awayAt: string | null;
  }[]
> {
  const rows = await tx
    .select({
      id: ticketItems.id,
      orderId: workingOrders.id,
      partyId: workingOrders.partyId,
      deliveryTableId: workingOrders.deliveryTableId,
      stationId: ticketItems.stationId,
      servedAt: workingOrderLines.servedAt,
      awayAt: ticketItems.awayAt,
    })
    .from(ticketItems)
    .innerJoin(workingOrders, eq(ticketItems.workingOrderId, workingOrders.id))
    .innerJoin(workingOrderLines, eq(ticketItems.workingOrderLineId, workingOrderLines.id))
    .where(
      and(
        eq(workingOrders.locationId, cfg.locationId),
        ne(workingOrders.status, "abandoned"),
        isNull(workingOrders.collectedAt),
        eq(ticketItems.madeHere, false),
        gte(ticketItems.firedAt, firedSince),
      ),
    );
  const zones = withZones ? await rowsWatchZones(tx, cfg, rows) : new Map<string, string>();
  return rows.map(({ id, orderId, stationId, servedAt, awayAt }) => ({
    id,
    stationId,
    zoneId: zones.get(orderId) ?? null,
    servedAt,
    awayAt,
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
    worstBand: worstBand(visible.filter((item) => item.awayAt === null).map((item) => item.band)),
  };
}
