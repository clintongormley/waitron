import { and, desc, eq, gte, inArray, isNull, sql } from "drizzle-orm";
import {
  kitchenStations,
  locations,
  nowIso,
  tills,
  workingOrderLines,
  workingOrders,
} from "@waitron/db";
import type { Transaction } from "@waitron/db";
import { kitchenPresentationName } from "@waitron/catalogue";
import { businessDayStart } from "@waitron/reporting";
import {
  AppError,
  decimalToThousandths,
  thousandthsToDecimal,
  type Decimal,
} from "@waitron/shared";
import type { VenueScope } from "./operations.js";
import { kitchenNoticeKind, kitchenNotices } from "./schema/kitchen-notices.js";
import { serviceSettings } from "./schema/settings.js";
import "./errors.js";

export type KitchenNoticeKind = (typeof kitchenNoticeKind.enumValues)[number];

export interface KitchenNotice {
  id: string;
  stationId: string;
  workingOrderId: string;
  orderLabel: string;
  kind: KitchenNoticeKind;
  lineName: string;
  quantity: Decimal;
  note: string | null;
  wasStarted: boolean;
  createdAt: string;
}

export interface KitchenNoticeItem {
  workingOrderLineId: string;
  stationId: string;
  quantity: Decimal;
  wasStarted: boolean;
}

const NOTICE_LIMIT = 50;

/** Notices recorded in one call share a timestamp; the row id keeps them in the order given. */
const INSERTION_ORDER = sql`"kitchen_notices"."rowid"`;

/**
 * Records one notice per item, copying the order's label and each line's kitchen name and note as
 * they stand now, so a void calls it BEFORE deleting the line. The order and every station must be
 * at the caller's location (`working_order.not_found`, `station.not_found`) and every quantity
 * positive (`quantity.invalid`). An item whose line is not on the order is the caller's fault and
 * throws a plain `Error`.
 */
export async function recordKitchenNotices(
  tx: Transaction,
  cfg: VenueScope,
  orderId: string,
  items: readonly KitchenNoticeItem[],
  kind: KitchenNoticeKind,
): Promise<void> {
  if (items.length === 0) return;
  const [order] = await tx
    .select({ orderNumber: workingOrders.orderNumber, label: workingOrders.label })
    .from(workingOrders)
    .innerJoin(tills, eq(tills.id, workingOrders.tillId))
    .where(and(eq(workingOrders.id, orderId), eq(tills.locationId, cfg.locationId)));
  if (order === undefined) {
    throw new AppError("working_order.not_found", { workingOrderId: orderId });
  }
  const stationIds = [...new Set(items.map((item) => item.stationId))];
  const stations = await tx
    .select({ id: kitchenStations.id })
    .from(kitchenStations)
    .where(
      and(inArray(kitchenStations.id, stationIds), eq(kitchenStations.locationId, cfg.locationId)),
    );
  const knownStations = new Set(stations.map((station) => station.id));
  const unknownStation = stationIds.find((id) => !knownStations.has(id));
  if (unknownStation !== undefined) {
    throw new AppError("station.not_found", { stationId: unknownStation });
  }
  const quantities = items.map((item) => decimalToThousandths(item.quantity));
  if (quantities.some((count) => count <= 0)) {
    throw new AppError("quantity.invalid", { reason: "positive" });
  }
  const lines = await tx
    .select({
      id: workingOrderLines.id,
      name: workingOrderLines.name,
      kitchenName: workingOrderLines.kitchenName,
      variantName: workingOrderLines.variantName,
      variantKitchenName: workingOrderLines.variantKitchenName,
      note: workingOrderLines.note,
    })
    .from(workingOrderLines)
    .where(
      and(
        eq(workingOrderLines.workingOrderId, orderId),
        inArray(
          workingOrderLines.id,
          items.map((item) => item.workingOrderLineId),
        ),
      ),
    );
  const lineById = new Map(lines.map((line) => [line.id, line]));
  // The label the station screen shows for an order: its number, then its label when it has one.
  const orderLabel =
    order.label === null ? `#${order.orderNumber}` : `#${order.orderNumber} · ${order.label}`;
  const createdAt = nowIso();
  await tx.insert(kitchenNotices).values(
    items.map((item, index) => {
      const line = lineById.get(item.workingOrderLineId);
      if (line === undefined) {
        throw new Error(
          `recordKitchenNotices: line ${item.workingOrderLineId} is not on order ${orderId}`,
        );
      }
      return {
        stationId: item.stationId,
        workingOrderId: orderId,
        orderLabel,
        kind,
        lineName: kitchenPresentationName(line),
        quantity: quantities[index]!,
        note: line.note,
        wasStarted: item.wasStarted,
        createdAt,
      };
    }),
  );
}

/**
 * A station's unacknowledged notices, oldest first: the newest fifty, and none from before the
 * venue's current business day, so a station nobody watches does not accumulate them.
 */
export async function listStationNotices(
  tx: Transaction,
  cfg: VenueScope,
  stationId: string,
): Promise<KitchenNotice[]> {
  const [clock] = await tx
    .select({ timeZone: locations.timeZone, dayCutover: locations.dayCutover })
    .from(locations)
    .where(eq(locations.id, cfg.locationId));
  const since = businessDayStart(new Date(), {
    timeZone: clock!.timeZone,
    dayCutover: clock!.dayCutover.slice(0, 5),
  });
  const rows = await tx
    .select({
      id: kitchenNotices.id,
      stationId: kitchenNotices.stationId,
      workingOrderId: kitchenNotices.workingOrderId,
      orderLabel: kitchenNotices.orderLabel,
      kind: kitchenNotices.kind,
      lineName: kitchenNotices.lineName,
      quantity: kitchenNotices.quantity,
      note: kitchenNotices.note,
      wasStarted: kitchenNotices.wasStarted,
      createdAt: kitchenNotices.createdAt,
    })
    .from(kitchenNotices)
    .innerJoin(kitchenStations, eq(kitchenStations.id, kitchenNotices.stationId))
    .where(
      and(
        eq(kitchenNotices.stationId, stationId),
        eq(kitchenStations.locationId, cfg.locationId),
        isNull(kitchenNotices.acknowledgedAt),
        gte(kitchenNotices.createdAt, since),
      ),
    )
    .orderBy(desc(kitchenNotices.createdAt), desc(INSERTION_ORDER))
    .limit(NOTICE_LIMIT);
  return rows.reverse().map((row) => ({ ...row, quantity: thousandthsToDecimal(row.quantity) }));
}

/** Clears a notice from its station. Acknowledging one twice keeps the first time. */
export async function acknowledgeKitchenNotice(
  tx: Transaction,
  cfg: VenueScope,
  id: string,
): Promise<void> {
  const [notice] = await tx
    .select({ acknowledgedAt: kitchenNotices.acknowledgedAt })
    .from(kitchenNotices)
    .innerJoin(kitchenStations, eq(kitchenStations.id, kitchenNotices.stationId))
    .where(and(eq(kitchenNotices.id, id), eq(kitchenStations.locationId, cfg.locationId)));
  if (notice === undefined) throw new AppError("kitchen_notice.not_found", { noticeId: id });
  if (notice.acknowledgedAt !== null) return;
  await tx
    .update(kitchenNotices)
    .set({ acknowledgedAt: nowIso() })
    .where(eq(kitchenNotices.id, id));
}

/** Whether staff may change an item already sent to the kitchen. A venue with no row reads ON. */
export async function readEditSentLines(tx: Transaction): Promise<boolean> {
  const [row] = await tx
    .select({ editSentLines: serviceSettings.editSentLines })
    .from(serviceSettings)
    .where(eq(serviceSettings.id, 1));
  return row?.editSentLines ?? true;
}

export async function writeEditSentLines(tx: Transaction, value: boolean): Promise<void> {
  await tx
    .insert(serviceSettings)
    .values({ id: 1, editSentLines: value })
    .onConflictDoUpdate({ target: serviceSettings.id, set: { editSentLines: value } });
}
