import "./errors.js";
import { and, eq, inArray, isNull, ne, notExists } from "drizzle-orm";
import { AppError, worstBand } from "@waitron/shared";
import {
  ticketItems,
  tills,
  watcherItemMarks,
  workingOrderLines,
  workingOrders,
} from "@waitron/db";
import type { Transaction } from "@waitron/db";
import type { TillConfig } from "./till-config.js";
import { orderWatchZones } from "./watch-zones.js";
import { readWatcher, watcherSees } from "./watchers.js";
import { readPassBoard, type ExpoCourse, type ExpoGroup, type ExpoOrder } from "./working-order.js";

export type WatcherCourse = ExpoCourse & { allReady: boolean };
export type WatcherGroup = ExpoGroup & { allReady: boolean };
export type WatcherOrder = Omit<ExpoOrder, "courses" | "groups"> & {
  courses: WatcherCourse[];
  groups: WatcherGroup[];
};

export interface WatcherBoard {
  watcher: { id: string; name: string; runsPass: boolean; active: boolean };
  orders: WatcherOrder[];
}

export async function listWatcherQueue(
  tx: Transaction,
  cfg: TillConfig,
  watcherId: string,
): Promise<WatcherBoard> {
  const watcher = await readWatcher(tx, cfg, watcherId);
  if (!watcher) throw new AppError("watcher.not_found", { watcherId });
  const board: WatcherBoard = {
    watcher: {
      id: watcher.id,
      name: watcher.name,
      runsPass: watcher.runsPass,
      active: watcher.active,
    },
    orders: [],
  };
  if (!watcher.active) return board;

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
        ne(workingOrders.status, "abandoned"),
        isNull(workingOrders.collectedAt),
        isNull(workingOrderLines.servedAt),
        eq(ticketItems.madeHere, false),
        watcher.everyStation ? undefined : inArray(ticketItems.stationId, [...watcher.stationIds]),
        notExists(
          tx
            .select({ id: watcherItemMarks.ticketItemId })
            .from(watcherItemMarks)
            .where(
              and(
                eq(watcherItemMarks.watcherId, watcherId),
                eq(watcherItemMarks.ticketItemId, ticketItems.id),
              ),
            ),
        ),
      ),
    );
  const distinctOrders = [
    ...new Map(
      candidates.map(({ orderId, partyId, deliveryTableId }) => [
        orderId,
        { id: orderId, partyId, deliveryTableId },
      ]),
    ).values(),
  ];
  const zones = watcher.everyZone ? null : await orderWatchZones(tx, cfg, distinctOrders);
  const kept = candidates.filter((item) =>
    watcherSees(watcher, { stationId: item.stationId, zoneId: zones?.get(item.orderId) ?? null }),
  );
  if (!kept.length) return board;
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
  board.orders = orders.flatMap((order) => {
    const courses = order.courses.flatMap((part) => section(part) ?? []);
    const groups = order.groups.flatMap((part) => section(part) ?? []);
    if (!courses.length && !groups.length) return [];
    const visible = [...courses, ...groups].flatMap((part) => part.items);
    return [
      {
        ...order,
        courses,
        groups,
        worstBand: worstBand(
          visible.filter((item) => item.awayAt === null).map((item) => item.band),
        ),
      },
    ];
  });
  return board;
}

export async function markWatcherItems(
  tx: Transaction,
  cfg: TillConfig,
  watcherId: string,
  ticketItemIds: readonly string[],
  done: boolean,
  by: { personId: string } | { deviceId: string },
  at: Date,
): Promise<void> {
  const watcher = await readWatcher(tx, cfg, watcherId);
  if (!watcher?.active) throw new AppError("watcher.not_found", { watcherId });
  if (!ticketItemIds.length) return;
  const rows = await tx
    .select({ id: ticketItems.id, locationId: tills.locationId })
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
    .innerJoin(tills, eq(tills.id, workingOrders.tillId))
    .where(inArray(ticketItems.id, [...ticketItemIds]));
  if (rows.some(({ locationId }) => locationId !== cfg.locationId)) {
    throw new AppError("management.request_invalid", { field: "ticketItemIds" });
  }
  const localIds = rows.map(({ id }) => id);
  if (!localIds.length) return;
  if (!done) {
    await tx
      .delete(watcherItemMarks)
      .where(
        and(
          eq(watcherItemMarks.watcherId, watcherId),
          inArray(watcherItemMarks.ticketItemId, localIds),
        ),
      );
    return;
  }
  await tx
    .insert(watcherItemMarks)
    .values(
      localIds.map((id) => ({
        watcherId,
        ticketItemId: id,
        doneAt: at.toISOString(),
        doneByPersonId: "personId" in by ? by.personId : null,
        doneByDeviceId: "deviceId" in by ? by.deviceId : null,
      })),
    )
    .onConflictDoNothing({ target: [watcherItemMarks.watcherId, watcherItemMarks.ticketItemId] });
}
