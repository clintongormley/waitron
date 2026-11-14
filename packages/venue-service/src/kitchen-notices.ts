import { and, asc, eq, gte, inArray, isNull, lte, or, sql } from "drizzle-orm";
import {
  KITCHEN_NOTICE_DIRECTIONS,
  kitchenNoticeKind,
  kitchenNotices,
  ticketItems,
  kitchenStations,
  insertInChunks,
  nowIso,
  readVenueClock,
  workingOrderLines,
  workingOrders,
} from "@waitron/db";
import type { Transaction } from "@waitron/db";
import type { KitchenAllergyBlock, KitchenNoteChange, StationNoticeDish } from "@waitron/module";
import { kitchenPresentationName } from "@waitron/catalogue";
import { businessDayStart } from "@waitron/reporting";
import {
  AppError,
  decimalToThousandths,
  thousandthsToDecimal,
  type Decimal,
} from "@waitron/shared";
import { readLinesSoldInEach } from "./operations.js";
import "./errors.js";

export type KitchenNoticeKind = (typeof kitchenNoticeKind.enumValues)[number];
export type KitchenNoticeDirection = (typeof KITCHEN_NOTICE_DIRECTIONS)[number];

export interface KitchenNotice {
  orderNoteChange?: KitchenNoteChange;
  /** On a kitchen-note change, the dishes it affects at this station; matching counted dishes (no
   *  unit or sold in each, whole-number quantity) are merged. */
  dishes?: StationNoticeDish[];
  allergyBlock?: KitchenAllergyBlock | null;
  id: string;
  stationId: string;
  workingOrderId: string;
  orderLabel: string;
  kind: KitchenNoticeKind;
  lineName: string;
  unitName: Record<string, string> | null;
  soldInEach: boolean;
  quantity: Decimal;
  note: string | null;
  wasStarted: boolean;
  movedTo: string | null;
  /** On a `changed` notice, whether the quantity was added to the work or taken from it. */
  direction: KitchenNoticeDirection | null;
  /** On a `changed` notice, the extra taken off the dish. */
  cancelledExtra: string | null;
  reroutedTo: string | null;
  createdAt: string;
}

export interface KitchenNoticeItem {
  workingOrderLineId: string;
  stationId: string;
  quantity: Decimal;
  wasStarted: boolean;
}

export interface KitchenNoticeOptions {
  orderNoteChange?: KitchenNoteChange;
  noteEvent?: { createdAt: string; labels: ReadonlyMap<string, string> };
  allergyBlock?: KitchenAllergyBlock | null;
  movedTo?: string | null;
  direction?: KitchenNoticeDirection | null;
  cancelledExtra?: string | null;
  reroutedTo?: string | null;
  fromNumber?: number | null;
}

const NOTICE_LIMIT = 50;

/** Notices recorded in one call share a timestamp; the row id keeps them in the order given. */
const INSERTION_ORDER = sql`"kitchen_notices"."rowid"`;

/** A party change keeps its bill rows but shares one display and acknowledgment key. */
const FOLD_KEY = sql<string>`case when ${kitchenNotices.orderNoteChange} is null then ${kitchenNotices.id} else json_array(case when json_extract(${kitchenNotices.orderNoteChange}, '$.partyId') is null then 'order' else 'party' end, coalesce(json_extract(${kitchenNotices.orderNoteChange}, '$.partyId'), ${kitchenNotices.workingOrderId}), ${kitchenNotices.createdAt}, json_extract(${kitchenNotices.orderNoteChange}, '$.before'), json_extract(${kitchenNotices.orderNoteChange}, '$.after')) end`;

/** Copy line presentation before deleting a line: notices outlive the work they describe. */
export async function recordKitchenNotices(
  tx: Transaction,
  orderId: string,
  items: readonly KitchenNoticeItem[],
  kind: KitchenNoticeKind,
  options: KitchenNoticeOptions = {},
): Promise<void> {
  const {
    movedTo = null,
    direction = null,
    cancelledExtra = null,
    reroutedTo = null,
    fromNumber = null,
    orderNoteChange,
    noteEvent,
    allergyBlock = null,
  } = options;
  if (noteEvent !== undefined && (kind !== "changed" || orderNoteChange === undefined))
    throw new AppError("kitchen_notice.invalid", { field: "noteEvent" });
  if (
    orderNoteChange !== undefined &&
    (kind !== "changed" ||
      direction !== null ||
      cancelledExtra !== null ||
      movedTo !== null ||
      reroutedTo !== null ||
      fromNumber !== null)
  )
    throw new AppError("kitchen_notice.invalid", { field: "orderNoteChange" });
  if (
    direction !== null &&
    (kind !== "changed" || !KITCHEN_NOTICE_DIRECTIONS.includes(direction))
  ) {
    throw new AppError("kitchen_notice.invalid", { field: "direction" });
  }
  if (cancelledExtra !== null && kind !== "changed") {
    throw new AppError("kitchen_notice.invalid", { field: "cancelledExtra" });
  }
  if ((kind === "rerouted") !== (reroutedTo !== null)) {
    throw new AppError("kitchen_notice.invalid", { field: "reroutedTo" });
  }
  if (fromNumber !== null && kind !== "moved") {
    throw new AppError("kitchen_notice.invalid", { field: "fromNumber" });
  }
  if (
    (kind === "allergy_changed") !== (allergyBlock !== null) ||
    ((kind === "allergy_changed" || kind === "allergy_removed") && movedTo !== null)
  ) {
    throw new AppError("kitchen_notice.invalid", { field: "allergyBlock" });
  }
  if (items.length === 0) return;
  const [order] = await tx
    .select({ orderNumber: workingOrders.orderNumber, label: workingOrders.label })
    .from(workingOrders)
    .where(eq(workingOrders.id, orderId));
  if (order === undefined) {
    throw new AppError("working_order.not_found", { workingOrderId: orderId });
  }
  const stationIds = [...new Set(items.map((item) => item.stationId))];
  const stations = await tx
    .select({ id: kitchenStations.id })
    .from(kitchenStations)
    .where(inArray(kitchenStations.id, stationIds));
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
      unitName: workingOrderLines.unitName,
    })
    .from(workingOrderLines)
    .where(
      and(
        eq(workingOrderLines.workingOrderId, orderId),
        inArray(
          workingOrderLines.id,
          sql`(select value from json_each(${JSON.stringify(items.map((item) => item.workingOrderLineId))}))`,
        ),
      ),
    );
  const tickets =
    kind === "moved"
      ? await tx
          .select({ lineId: ticketItems.workingOrderLineId, ticketItemId: ticketItems.id })
          .from(ticketItems)
          .where(
            inArray(
              ticketItems.workingOrderLineId,
              sql`(select value from json_each(${JSON.stringify(items.map((item) => item.workingOrderLineId))}))`,
            ),
          )
      : [];
  const ticketByLine = new Map(tickets.map((ticket) => [ticket.lineId, ticket.ticketItemId]));
  const lineById = new Map(lines.map((line) => [line.id, line]));
  const soldInEach = await readLinesSoldInEach(
    tx,
    lines.map((line) => line.id),
  );
  const number =
    fromNumber === null || fromNumber === order.orderNumber
      ? `#${order.orderNumber}`
      : `#${fromNumber} → #${order.orderNumber}`;
  const orderLabel = order.label === null ? number : `${number} · ${order.label}`;
  const createdAt = noteEvent?.createdAt ?? nowIso();
  await insertInChunks(
    tx,
    kitchenNotices,
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
        orderLabel: noteEvent?.labels.get(item.stationId) ?? orderLabel,
        kind,
        ticketItemId: ticketByLine.get(item.workingOrderLineId) ?? null,
        lineName: kitchenPresentationName(line),
        unitName: line.unitName,
        soldInEach: soldInEach.has(line.id),
        quantity: quantities[index]!,
        note: line.note,
        wasStarted: item.wasStarted,
        movedTo,
        direction,
        cancelledExtra,
        orderNoteChange,
        allergyBlock,
        reroutedTo,
        createdAt,
      };
    }),
  );
}

// Allergy instructions stay actionable until acknowledged, independently of the ordinary notice cap.
export async function listStationNotices(
  tx: Transaction,
  stationId: string,
): Promise<KitchenNotice[]> {
  return (await listStationsNotices(tx, [stationId])).get(stationId)!;
}

/**
 * `listStationNotices` for several stations in one statement, the clock read once, a kitchen-note
 * change's notice kept whole. Every station asked for has an entry.
 */
export async function listStationsNotices(
  tx: Transaction,
  stationIds: readonly string[],
): Promise<Map<string, KitchenNotice[]>> {
  const byStation = new Map<string, KitchenNotice[]>(stationIds.map((id) => [id, []]));
  if (stationIds.length === 0) return byStation;
  const since = businessDayStart(new Date(), await readVenueClock(tx));
  const allergy = inArray(kitchenNotices.kind, ["allergy_changed", "allergy_removed"]);
  const ranked = tx
    .select({
      id: kitchenNotices.id,
      stationId: kitchenNotices.stationId,
      workingOrderId: kitchenNotices.workingOrderId,
      orderLabel: kitchenNotices.orderLabel,
      kind: kitchenNotices.kind,
      lineName: kitchenNotices.lineName,
      unitName: kitchenNotices.unitName,
      soldInEach: kitchenNotices.soldInEach,
      quantity: kitchenNotices.quantity,
      note: kitchenNotices.note,
      wasStarted: kitchenNotices.wasStarted,
      movedTo: kitchenNotices.movedTo,
      direction: kitchenNotices.direction,
      cancelledExtra: kitchenNotices.cancelledExtra,
      orderNoteChange: kitchenNotices.orderNoteChange,
      allergyBlock: kitchenNotices.allergyBlock,
      reroutedTo: kitchenNotices.reroutedTo,
      createdAt: kitchenNotices.createdAt,
      insertionOrder: INSERTION_ORDER.as("insertion_order"),
      foldKey: FOLD_KEY.as("fold_key"),
      newest:
        sql<number>`row_number() over (partition by ${kitchenNotices.stationId}, ${allergy} order by ${kitchenNotices.createdAt} desc, ${INSERTION_ORDER} desc)`.as(
          "newest",
        ),
    })
    .from(kitchenNotices)
    .where(
      and(
        inArray(kitchenNotices.stationId, [...stationIds]),
        isNull(kitchenNotices.acknowledgedAt),
        or(allergy, gte(kitchenNotices.createdAt, since)),
      ),
    )
    .as("ranked");
  // A note change's notice is kept whole when any of its rows is among the newest fifty.
  const keep = Object.fromEntries(
    Object.keys(ranked._.selectedFields).map((key) => [
      key,
      ranked[key as keyof typeof ranked._.selectedFields],
    ]),
  ) as typeof ranked._.selectedFields;
  const folded = tx
    .select({
      ...keep,
      foldNewest:
        sql<number>`min(${ranked.newest}) over (partition by ${ranked.stationId}, ${ranked.foldKey})`.as(
          "fold_newest",
        ),
    })
    .from(ranked)
    .as("folded");
  const rows = await tx
    .select()
    .from(folded)
    .where(
      or(
        inArray(folded.kind, ["allergy_changed", "allergy_removed"]),
        lte(folded.foldNewest, NOTICE_LIMIT),
      ),
    )
    .orderBy(folded.createdAt, asc(folded.insertionOrder));
  const notices = new Map<string, KitchenNotice>();
  /* eslint-disable @typescript-eslint/no-unused-vars -- the ranks and key are not part of a notice */
  for (const {
    newest,
    foldNewest,
    insertionOrder,
    foldKey,
    orderNoteChange,
    allergyBlock,
    ...row
  } of rows) {
    /* eslint-enable @typescript-eslint/no-unused-vars */
    const quantity = thousandthsToDecimal(row.quantity);
    const dish: StationNoticeDish = {
      lineName: row.lineName,
      unitName: row.unitName,
      soldInEach: row.soldInEach,
      quantity,
      note: row.note,
      wasStarted: row.wasStarted,
    };
    const key = `${row.stationId}|${foldKey}`;
    const notice = notices.get(key);
    if (notice !== undefined) {
      // Two measured portions are two pieces to cook, as on the slip (`arrangeTicketItems`).
      const same = !countable(dish)
        ? undefined
        : notice.dishes!.find(
            (other) =>
              countable(other) &&
              other.lineName === dish.lineName &&
              other.soldInEach === dish.soldInEach &&
              other.note === dish.note &&
              other.wasStarted === dish.wasStarted &&
              sameNames(other.unitName, dish.unitName),
          );
      if (same === undefined) notice.dishes!.push(dish);
      else
        same.quantity = thousandthsToDecimal(
          decimalToThousandths(same.quantity) + decimalToThousandths(quantity),
        );
      continue;
    }
    const created: KitchenNotice = {
      ...row,
      quantity,
      ...(orderNoteChange === null ? {} : { orderNoteChange, dishes: [dish] }),
      ...(row.kind === "allergy_changed" || row.kind === "allergy_removed" ? { allergyBlock } : {}),
    };
    notices.set(key, created);
    byStation.get(row.stationId)!.push(created);
  }
  for (const notice of notices.values()) {
    if (notice.dishes !== undefined) Object.assign(notice, notice.dishes[0]);
  }
  return byStation;
}

function countable(dish: StationNoticeDish): boolean {
  return (
    (dish.unitName === null || dish.soldInEach) && decimalToThousandths(dish.quantity) % 1000 === 0
  );
}

function sameNames(a: Record<string, string> | null, b: Record<string, string> | null): boolean {
  if (a === null || b === null) return a === b;
  const keys = Object.keys(a);
  return keys.length === Object.keys(b).length && keys.every((key) => a[key] === b[key]);
}

/**
 * Clears a notice from its station, every dish of a kitchen-note change included. Acknowledging
 * one twice keeps the first time. With `stationId`, a notice at any other station is
 * `kitchen_notice.not_found`, as a kitchen display bound to that station must not clear another's.
 */
export async function acknowledgeKitchenNotice(
  tx: Transaction,
  id: string,
  scope: { stationId?: string } = {},
): Promise<void> {
  const [notice] = await tx
    .select({
      stationId: kitchenNotices.stationId,
      createdAt: kitchenNotices.createdAt,
      foldKey: FOLD_KEY,
    })
    .from(kitchenNotices)
    .where(
      and(
        eq(kitchenNotices.id, id),
        scope.stationId === undefined ? undefined : eq(kitchenNotices.stationId, scope.stationId),
      ),
    );
  if (notice === undefined) throw new AppError("kitchen_notice.not_found", { noticeId: id });
  await tx
    .update(kitchenNotices)
    .set({ acknowledgedAt: nowIso() })
    .where(
      and(
        eq(kitchenNotices.stationId, notice.stationId),
        eq(kitchenNotices.createdAt, notice.createdAt),
        eq(FOLD_KEY, notice.foldKey),
        isNull(kitchenNotices.acknowledgedAt),
      ),
    );
}
