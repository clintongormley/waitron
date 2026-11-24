import {
  type Transaction,
  workingOrderLines,
  ticketItems,
  orderGroups,
  workingOrders,
  orderGroupHoldStations,
  readVenueClock,
  partySurvivors,
} from "@waitron/db";
import { kitchenPresentationName } from "@waitron/menu";
import type { KitchenAllergyBlock, KitchenNoteChange } from "@waitron/module";
import { enqueuePrintJob, type EscSetting } from "@waitron/printing";
import { compareStationNames, thousandthsToDecimal } from "@waitron/shared";
import { eq, and, inArray, isNull, or, isNotNull } from "drizzle-orm";
import { alias } from "drizzle-orm/sqlite-core";
import { freezeKitchenAllergyItems } from "./kitchen-allergy.js";
import { readKitchenLanguage } from "./kitchen-language.js";
import { markHoldPaper } from "./kitchen-ticket-enqueue.js";
import {
  readOrderHeaders,
  readStations,
  type OrderHeader,
  buildTicketItems,
  changeItem,
  byGroupThenLine,
  extraLabel,
  ticketName,
  type TicketItemsByLine,
  readOrderHeader,
} from "./kitchen-ticket-items.js";
import { linkKitchenJob } from "./kitchen-ticket-links.js";
import { routeKitchenTickets, mappingsByStation } from "./kitchen-ticket-plan.js";
import { printerMappings, groupByLayout } from "./kitchen-ticket-printers.js";
import { firedQuantity, kitchenWork, isStarted, type TicketState } from "./kitchen-ticket-state.js";
import {
  formatPartyNameChangeSlip,
  type KitchenTicketItem,
  formatKitchenNoteChangeSlip,
  arrangeTicketItems,
  mergeKey,
  formatCorrectionSlip,
} from "./kitchen-ticket.js";
import { VENUE_SERVICE } from "./modules.js";
import { heldPaperStations } from "./order-group-hold-paper.js";
import { readOrderKitchenNotes } from "./order-kitchen-note.js";
import { readPartyNames } from "./order-places.js";
import { readWholePortionLines } from "./order-portions.js";
import { partyFamily } from "./parties.js";
import type { TradingContext } from "./trading-context.js";

/** One correction to work a station has: the quantity it corrects, and whether the cook had
 *  started it. */
export interface CorrectionItem {
  workingOrderLineId: string;
  stationId: string;
  /** As thousandths: what the station was asked for on a recall, a move, or a whole void or HOLD
   *  cancellation; the part removed on a partial one; the quantity added or removed on a HOLD
   *  CHANGED. */
  quantity: number;
  wasStarted: boolean;
  /** An ungrouped correction to work waiting on HOLD paper. */
  ungroupedHold?: true;
  /** The permanent number on the HOLD ticket being corrected. */
  group?: number;
  numberPartyLabel?: string;
  /** Held work corrected against this group's HOLD ticket: its slip prints only at a station
   *  recorded for the group ({@link heldPaperStations}). */
  holdGroupId?: string;
}
/** What a correction slip says happened; the slip's header and its sign follow from it. */
type CorrectionChange =
  | { kind: "VOID" | "RECALLED" }
  | { kind: "TO STATION"; toStation: string }
  | { kind: "EXTRA CANCELLED"; held: boolean; cancelledExtra: string }
  | { kind: "ALLERGY"; blocks: ReadonlyMap<string, KitchenAllergyBlock | null> }
  | HoldCorrection;

async function readKitchenChangeItems(
  tx: Transaction,
  orderIds: readonly string[],
): Promise<Map<string, CorrectionItem[]>> {
  if (orderIds.length === 0) return new Map();
  const rows = await tx
    .select({
      orderId: workingOrderLines.workingOrderId,
      workingOrderLineId: ticketItems.workingOrderLineId,
      stationId: ticketItems.stationId,
      quantity: firedQuantity,
      state: ticketItems.state,
      group: orderGroups.displayNumber,
      groupId: workingOrderLines.groupId,
      firedAt: ticketItems.firedAt,
    })
    .from(ticketItems)
    .innerJoin(workingOrderLines, eq(workingOrderLines.id, ticketItems.workingOrderLineId))
    .innerJoin(workingOrders, eq(workingOrders.id, workingOrderLines.workingOrderId))
    .leftJoin(orderGroups, eq(orderGroups.id, workingOrderLines.groupId))
    .leftJoin(
      orderGroupHoldStations,
      and(
        eq(orderGroupHoldStations.groupId, workingOrderLines.groupId),
        eq(orderGroupHoldStations.stationId, ticketItems.stationId),
      ),
    )
    .where(
      and(
        inArray(workingOrderLines.workingOrderId, [...orderIds]),
        kitchenWork(),
        isNull(workingOrderLines.servedAt),
        or(
          isNotNull(ticketItems.firedAt),
          and(eq(orderGroups.state, "held"), isNotNull(orderGroups.holdPrintedAt)),
          and(isNotNull(ticketItems.requestedAt), isNotNull(orderGroupHoldStations.groupId)),
        ),
      ),
    )
    .orderBy(workingOrderLines.lineNo, ticketItems.id);
  const byOrder = new Map<string, CorrectionItem[]>();
  for (const { orderId, group, groupId, firedAt, state, ...row } of rows) {
    const items = byOrder.get(orderId) ?? [];
    items.push({
      ...row,
      wasStarted: isStarted(state),
      ...(group === null ? {} : { group }),
      ...(firedAt === null && groupId !== null ? { holdGroupId: groupId } : {}),
    });
    byOrder.set(orderId, items);
  }
  return byOrder;
}

export async function enqueuePartyNameChange(
  tx: Transaction,
  partyId: string,
  change: { before: string | null; after: string | null },
): Promise<void> {
  if (change.before === change.after) return;
  const orders = await tx
    .select({ id: workingOrders.id })
    .from(workingOrders)
    .where(inArray(workingOrders.partyId, await partyFamily(tx, partyId)));
  const byOrder = await readKitchenChangeItems(
    tx,
    orders.map((order) => order.id),
  );
  const all = [...byOrder].flatMap(([orderId, items]) =>
    items.map((item) => ({ ...item, orderId })),
  );
  const held = [...new Set(all.flatMap((item) => item.holdGroupId ?? []))];
  const recorded =
    held.length === 0 ? new Map<string, ReadonlySet<string>>() : await heldPaperStations(tx, held);
  const items = all.filter(
    (item) =>
      item.holdGroupId === undefined ||
      recorded.get(item.holdGroupId)?.has(item.stationId) === true,
  );
  const stationIds = [...new Set(items.map((item) => item.stationId))];
  if (stationIds.length === 0) return;
  const mappings = await printerMappings(tx, stationIds);
  if (mappings.length === 0) return;
  const language = await readKitchenLanguage(tx);
  const { timeZone } = await readVenueClock(tx);
  const headers = await readOrderHeaders(tx, [...new Set(items.map((item) => item.orderId))]);
  const stations = await readStations(tx, stationIds);
  const sorted = stationIds.sort((a, b) =>
    compareStationNames(stations.get(a)!.name, stations.get(b)!.name),
  );
  const at = new Date().toISOString();
  for (const route of routeKitchenTickets(sorted, mappingsByStation(mappings))) {
    const visible = [
      ...new Set(
        items
          .filter((item) => route.stationIds.includes(item.stationId))
          .map((item) => item.orderId),
      ),
    ].sort((a, b) => Number(headers.get(a)!.orderNumber) - Number(headers.get(b)!.orderNumber));
    const tableLabel =
      [...new Set(visible.flatMap((id) => headers.get(id)!.tableLabel ?? []))].join(" · ") || null;
    const bytes = formatPartyNameChangeSlip(
      {
        locale: language,
        stationNames: route.stationIds.map((id) => stations.get(id)!.name),
        tableLabel,
        orderNumbers: visible.map((id) => headers.get(id)!.orderNumber),
        ...change,
        at,
      },
      route.printers[0]!,
      timeZone,
    );
    for (const printer of route.printers)
      await enqueuePrintJob(tx, printer.printerId, bytes, "document");
  }
}

export async function enqueueOrderKitchenNoteChange(
  tx: Transaction,
  cfg: TradingContext,
  orderIds: readonly string[],
  change: KitchenNoteChange,
): Promise<void> {
  if (orderIds.length === 0 || change.before === change.after) return;
  const byOrder = await readKitchenChangeItems(tx, orderIds);
  if (byOrder.size === 0) return;
  const headers = await readOrderHeaders(tx, [...byOrder.keys()]);
  const survivors = await partySurvivors(tx, [
    ...new Set([...headers.values()].flatMap((header) => header.partyId ?? [])),
  ]);
  const groups = new Map<
    string,
    { partyId: string | null; orders: Map<string, CorrectionItem[]> }
  >();
  for (const [orderId, items] of byOrder) {
    const storedPartyId = headers.get(orderId)!.partyId;
    const partyId = storedPartyId === null ? null : (survivors.get(storedPartyId) ?? storedPartyId);
    const key = partyId === null ? `order:${orderId}` : `party:${partyId}`;
    const group = groups.get(key) ?? { partyId, orders: new Map<string, CorrectionItem[]>() };
    group.orders.set(orderId, items);
    groups.set(key, group);
  }
  const at = new Date().toISOString();
  for (const { partyId, orders } of groups.values()) {
    const grouped = partyId !== null && orders.size > 1;
    const changed: KitchenNoteChange = {
      before: change.before,
      after: change.after,
      ...(grouped ? { partyId } : {}),
    };
    const numbers = new Map<string, Set<string>>();
    for (const [id, items] of orders)
      for (const item of items) {
        const set = numbers.get(item.stationId) ?? new Set<string>();
        set.add(id);
        numbers.set(item.stationId, set);
      }
    const noteEvent = grouped
      ? {
          createdAt: at,
          labels: new Map(
            [...numbers].map(([id, values]) => [
              id,
              [...values]
                .sort(
                  (a, b) =>
                    Number(headers.get(a)!.orderNumber) - Number(headers.get(b)!.orderNumber),
                )
                .map((value) => {
                  const header = headers.get(value)!;
                  return `#${header.orderNumber}${header.billLabel === null ? "" : ` · ${header.billLabel}`}`;
                })
                .join(", "),
            ]),
          ),
        }
      : undefined;
    for (const [orderId, items] of orders) {
      await VENUE_SERVICE.recordKitchenNotices(tx, orderId, items.map(toNoticeItem), "changed", {
        orderNoteChange: changed,
        noteEvent,
      });
    }
    await printKitchenNoteChanges(tx, cfg, orders, change, headers, at);
  }
}

async function printKitchenNoteChanges(
  tx: Transaction,
  cfg: TradingContext,
  orders: ReadonlyMap<string, readonly CorrectionItem[]>,
  change: KitchenNoteChange,
  headers: ReadonlyMap<string, OrderHeader>,
  at: string,
): Promise<void> {
  const all = [...orders].flatMap(([orderId, items]) =>
    items.map((item) => ({ ...item, orderId })),
  );
  const held = [...new Set(all.flatMap((item) => item.holdGroupId ?? []))];
  const recorded =
    held.length === 0 ? new Map<string, ReadonlySet<string>>() : await heldPaperStations(tx, held);
  const items = all.filter(
    (item) =>
      item.holdGroupId === undefined ||
      recorded.get(item.holdGroupId)?.has(item.stationId) === true,
  );
  const stationIds = [...new Set(items.map((item) => item.stationId))];
  if (stationIds.length === 0) return;
  const mappings = await printerMappings(tx, stationIds);
  if (mappings.length === 0) return;
  const language = await readKitchenLanguage(tx);
  const { timeZone } = await readVenueClock(tx);
  const lineIds = [...new Set(items.map((item) => item.workingOrderLineId))];
  const built = await buildTicketItems(tx, cfg, lineIds, language);
  const stations = await readStations(tx, stationIds);
  const names = await readPartyNames(tx, [...orders.keys()]);
  const byStation = new Map<
    string,
    { orderId: string; lineNo: number; position: number | null; item: KitchenTicketItem }[]
  >();
  for (const target of items) {
    const entry = built.get(target.workingOrderLineId)!;
    const item = changeItem(entry.item, target);
    const bucket = byStation.get(target.stationId) ?? [];
    bucket.push({
      orderId: target.orderId,
      lineNo: entry.lineNo,
      position: entry.position,
      item:
        target.group === undefined
          ? item
          : {
              ...item,
              group: target.group,
              groupLabel:
                target.numberPartyLabel ??
                (target.group === entry.group ? item.groupLabel : undefined),
            },
    });
    byStation.set(target.stationId, bucket);
  }
  const sorted = [...stationIds].sort((a, b) =>
    compareStationNames(stations.get(a)!.name, stations.get(b)!.name),
  );
  for (const route of routeKitchenTickets(sorted, mappingsByStation(mappings))) {
    const visible = [
      ...new Set(route.stationIds.flatMap((id) => byStation.get(id)!.map((item) => item.orderId))),
    ].sort((a, b) => Number(headers.get(a)!.orderNumber) - Number(headers.get(b)!.orderNumber));
    const first = headers.get(visible[0]!)!;
    const partyName = names.get(visible[0]!)!;
    const label =
      visible.length === 1
        ? first.tableLabel
        : [...new Set(visible.flatMap((id) => headers.get(id)!.tableLabel ?? []))].join(" · ") ||
          null;
    const bytes = formatKitchenNoteChangeSlip(
      {
        locale: language,
        stations: route.stationIds.map((id) => ({
          stationName: stations.get(id)!.name,
          items: arrangeTicketItems(
            byStation
              .get(id)!
              .sort(byGroupThenLine)
              .map((entry) => entry.item),
            stations.get(id)!.ticketGrouping,
          ),
        })),
        tableLabel: label,
        orderNumber: first.orderNumber,
        orderNumbers:
          visible.length === 1 ? undefined : visible.map((id) => headers.get(id)!.orderNumber),
        party: partyName === null ? undefined : { name: partyName, locale: language },
        at,
        orderNoteChange: change,
        takeAway: visible.every((id) => headers.get(id)!.takeAway),
      },
      route.printers[0]!,
      timeZone,
    );
    for (const printer of route.printers)
      await enqueuePrintJob(tx, printer.printerId, bytes, "document");
  }
}
/** A change to unfired work on HOLD paper: quantity `added` or `removed`, or cancelled. */
export type HoldCorrection =
  { kind: "HOLD CHANGED"; direction: "added" | "removed" } | { kind: "HOLD CANCELLED" };
/** A made-here item has neither kitchen paper nor a station-screen line to correct. */
async function withoutMadeHere<T extends { workingOrderLineId: string }>(
  tx: Transaction,
  items: readonly T[],
): Promise<T[]> {
  if (items.length === 0) return [];
  const madeHere = await tx
    .select({ lineId: ticketItems.workingOrderLineId })
    .from(ticketItems)
    .where(
      and(
        inArray(
          ticketItems.workingOrderLineId,
          items.map((item) => item.workingOrderLineId),
        ),
        eq(ticketItems.madeHere, true),
      ),
    );
  const excluded = new Set(madeHere.map((item) => item.lineId));
  return items.filter((item) => !excluded.has(item.workingOrderLineId));
}
/**
 * A void must call this before deleting the line: the delete cascades its ticket item away, and both
 * the notice and the slip re-read the line from `working_order_lines`.
 */
export async function enqueueCorrectionSlips(
  tx: Transaction,
  cfg: TradingContext,
  orderId: string,
  items: CorrectionItem[],
  kind: "VOID" | "RECALLED",
): Promise<void> {
  items = await withoutMadeHere(tx, items);
  if (items.length === 0) return;

  const { notices, read } = await foldPortionNotices(tx, cfg, items);
  await VENUE_SERVICE.recordKitchenNotices(
    tx,
    orderId,
    notices.map(toNoticeItem),
    kind === "VOID" ? "void" : "recalled",
  );
  await printCorrectionSlips(tx, cfg, orderId, items, { kind }, read);
}
/** Record a reroute and correct the paper at the item's old station before its station changes. */
export async function enqueueStationMoved(
  tx: Transaction,
  cfg: TradingContext,
  orderId: string,
  items: CorrectionItem[],
  toStationName: string,
): Promise<void> {
  if (items.length === 0) return;
  const { notices, read } = await foldPortionNotices(tx, cfg, items);
  await VENUE_SERVICE.recordKitchenNotices(tx, orderId, notices.map(toNoticeItem), "rerouted", {
    reroutedTo: toStationName,
  });
  const onHold = (item: CorrectionItem) => item.ungroupedHold === true || item.group !== undefined;
  const fired = items.filter((item) => !onHold(item));
  const held = items.filter(onHold);
  if (fired.length > 0)
    await printCorrectionSlips(
      tx,
      cfg,
      orderId,
      fired,
      { kind: "TO STATION", toStation: toStationName },
      read,
    );
  if (held.length > 0)
    await printCorrectionSlips(tx, cfg, orderId, held, { kind: "HOLD CANCELLED" }, read);
}
/**
 * Record a kitchen notice per item for a change to unfired work on HOLD paper — `changed`
 * with its direction, or `void` for a cancellation — then enqueue a HOLD correction slip per item,
 * naming its group, as {@link enqueueCorrectionSlips} enqueues a slip.
 */
export async function enqueueHoldCorrections(
  tx: Transaction,
  cfg: TradingContext,
  orderId: string,
  items: CorrectionItem[],
  change: HoldCorrection,
): Promise<void> {
  items = await withoutMadeHere(tx, items);
  if (items.length === 0) return;
  const { notices, read } = await foldPortionNotices(tx, cfg, items);
  await VENUE_SERVICE.recordKitchenNotices(
    tx,
    orderId,
    notices.map(toNoticeItem),
    change.kind === "HOLD CANCELLED" ? "void" : "changed",
    { direction: change.kind === "HOLD CANCELLED" ? null : change.direction },
  );
  // Work added to a HOLD ticket has its allergy copies frozen inside printCorrectionSlips, after
  // `read` was taken, so its slips read their ticket items afresh.
  const added = change.kind === "HOLD CHANGED" && change.direction === "added";
  await printCorrectionSlips(tx, cfg, orderId, items, change, added ? undefined : read);
}
/** An extra about to come off its dish, and the dish's kitchen item as the kitchen has it. */
export interface CancelledExtra {
  /** The extra as the dish's kitchen paper prints it. */
  label: string;
  dishLineId: string;
  dishGroupId: string | null;
  /** Null when the dish has no kitchen item. */
  item: {
    firedAt: string | null;
    requestedAt: string | null;
    holdPaperQueued: boolean;
    stationId: string | null;
    state: TicketState;
    firedQuantity: number;
  } | null;
}
/** Read before the extra's line is deleted: it names the extra by the line's frozen kitchen name. */
export async function readCancelledExtra(
  tx: Transaction,
  extraLineId: string,
  locale: string,
): Promise<CancelledExtra> {
  const extra = alias(workingOrderLines, "extra");
  const [row] = await tx
    .select({
      name: extra.name,
      kitchenName: extra.kitchenName,
      variantName: extra.variantName,
      variantKitchenName: extra.variantKitchenName,
      quantity: extra.quantity,
      unitName: extra.unitName,
      dishLineId: workingOrderLines.id,
      dishQuantity: workingOrderLines.quantity,
      dishGroupId: workingOrderLines.groupId,
      ticketItemId: ticketItems.id,
      firedAt: ticketItems.firedAt,
      requestedAt: ticketItems.requestedAt,
      holdPaperQueued: ticketItems.holdPaperQueued,
      stationId: ticketItems.stationId,
      state: ticketItems.state,
      firedQuantity,
    })
    .from(extra)
    .innerJoin(workingOrderLines, eq(workingOrderLines.id, extra.parentLineId))
    .leftJoin(ticketItems, eq(ticketItems.workingOrderLineId, workingOrderLines.id))
    .where(eq(extra.id, extraLineId));
  const found = row!;
  const soldInEach = (await VENUE_SERVICE.readLinesSoldInEach(tx, [extraLineId])).has(extraLineId);
  return {
    label: extraLabel(
      kitchenPresentationName(found),
      thousandthsToDecimal(found.quantity),
      thousandthsToDecimal(found.dishQuantity),
      await readKitchenLanguage(tx),
      found.unitName === null || soldInEach ? undefined : ticketName(found.unitName, locale),
    ),
    dishLineId: found.dishLineId,
    dishGroupId: found.dishGroupId,
    item:
      found.ticketItemId === null
        ? null
        : {
            firedAt: found.firedAt,
            requestedAt: found.requestedAt,
            holdPaperQueued: found.holdPaperQueued!,
            stationId: found.stationId,
            state: found.state!,
            firedQuantity: found.firedQuantity,
          },
  };
}
/**
 * Record a `changed` notice on the dish naming `cancelledExtra`, then enqueue a slip of the dish as
 * it now stands with the extra to take off, as {@link enqueueCorrectionSlips} enqueues a slip:
 * headed CHANGED for fired work, or HOLD CHANGED with its group for an item carrying a `group`,
 * unfired work on HOLD paper. Call it after the extra's line is deleted, so the slip prints
 * the extras the dish keeps.
 */
export async function enqueueExtraCancelled(
  tx: Transaction,
  cfg: TradingContext,
  orderId: string,
  item: CorrectionItem,
  cancelledExtra: string,
): Promise<void> {
  if ((await withoutMadeHere(tx, [item])).length === 0) return;
  await VENUE_SERVICE.recordKitchenNotices(tx, orderId, [toNoticeItem(item)], "changed", {
    cancelledExtra,
  });
  await printCorrectionSlips(tx, cfg, orderId, [item], {
    kind: "EXTRA CANCELLED",
    held: item.ungroupedHold === true || item.group !== undefined,
    cancelledExtra,
  });
}
/**
 * `items` as the kitchen screen should be told of them: identical whole portions
 * ({@link readWholePortionLines}) at one station, started alike, with the same `sameAs`, folded into
 * the first of them with their quantities summed, as one line of that quantity is told; every other
 * item as it is.
 */
export async function foldPortionNotices<T extends CorrectionItem>(
  tx: Transaction,
  cfg: TradingContext,
  items: readonly T[],
  sameAs: (item: T) => unknown = () => null,
): Promise<{ notices: T[]; read: PortionRead }> {
  const whole = await readWholePortionLines(
    tx,
    items.map((item) => item.workingOrderLineId),
  );
  if (whole.size === 0) return { notices: [...items], read: { whole, built: new Map() } };
  const language = await readKitchenLanguage(tx);
  const built = await buildTicketItems(tx, cfg, [...whole], language);
  const read = { whole, built, language };
  const out: T[] = [];
  const byKey = new Map<string, number>();
  for (const item of items) {
    const entry = whole.has(item.workingOrderLineId)
      ? built.get(item.workingOrderLineId)
      : undefined;
    const merge = entry === undefined ? undefined : mergeKey(changeItem(entry.item, item));
    const key =
      merge === undefined
        ? undefined
        : JSON.stringify([
            item.stationId,
            item.wasStarted,
            item.group ?? null,
            merge,
            sameAs(item),
          ]);
    const at = key === undefined ? undefined : byKey.get(key);
    if (at !== undefined) {
      out[at] = { ...out[at]!, quantity: out[at]!.quantity + item.quantity };
      continue;
    }
    if (key !== undefined) byKey.set(key, out.length);
    out.push(item);
  }
  return { notices: out, read };
}
/** What {@link foldPortionNotices} read, handed on so the slips that follow do not read it again:
 * the whole-portion lines among the items, their ticket items and the language of their cross-references. */
export interface PortionRead {
  whole: ReadonlySet<string>;
  built: TicketItemsByLine;
  language?: string;
}
export function toNoticeItem(item: CorrectionItem) {
  return {
    workingOrderLineId: item.workingOrderLineId,
    stationId: item.stationId,
    quantity: thousandthsToDecimal(item.quantity),
    wasStarted: item.wasStarted,
  };
}

export async function enqueueAllergyCorrectionSlips(
  tx: Transaction,
  cfg: TradingContext,
  orderId: string,
  items: readonly (CorrectionItem & { allergyBlock: KitchenAllergyBlock | null })[],
  read?: PortionRead,
): Promise<void> {
  await printCorrectionSlips(
    tx,
    cfg,
    orderId,
    [...items],
    {
      kind: "ALLERGY",
      blocks: new Map(items.map((item) => [item.workingOrderLineId, item.allergyBlock])),
    },
    read,
  );
}

async function printCorrectionSlips(
  tx: Transaction,
  cfg: TradingContext,
  orderId: string,
  items: CorrectionItem[],
  change: CorrectionChange,
  read?: PortionRead,
): Promise<void> {
  const heldGroups = items.flatMap((item) => item.holdGroupId ?? []);
  if (heldGroups.length > 0) {
    const recorded = await heldPaperStations(tx, heldGroups);
    items = items.filter(
      (item) =>
        item.holdGroupId === undefined ||
        recorded.get(item.holdGroupId)?.has(item.stationId) === true,
    );
  }
  const stationIds = [...new Set(items.map((i) => i.stationId))];
  if (stationIds.length === 0) return;
  const mappingRows = await printerMappings(tx, stationIds);
  if (mappingRows.length === 0) return;

  if (change.kind === "HOLD CHANGED" && change.direction === "added") {
    const receiving = new Set(mappingRows.map((mapping) => mapping.stationId));
    await freezeKitchenAllergyItems(
      tx,
      orderId,
      items.filter((item) => receiving.has(item.stationId)),
    );
    await markHoldPaper(tx, items, receiving);
  }

  const lineIds = [...new Set(items.map((i) => i.workingOrderLineId))];
  const language = read?.language ?? (await readKitchenLanguage(tx));
  const { timeZone } = await readVenueClock(tx);
  const unread = lineIds.filter((id) => read?.built.has(id) !== true);
  const itemsByLine: TicketItemsByLine = new Map([
    ...(read?.built ?? []),
    ...(unread.length === 0 ? [] : await buildTicketItems(tx, cfg, unread, language)),
  ]);
  const stationNames = await readStations(tx, stationIds);
  const header = await readOrderHeader(tx, orderId);
  const partyName = (await readPartyNames(tx, [orderId])).get(orderId)!;
  const kitchenNote = (await readOrderKitchenNotes(tx, [orderId])).get(orderId)!.note;

  const printersByStation = new Map<string, (EscSetting & { printerId: string })[]>();
  for (const mapping of mappingRows) {
    const bucket = printersByStation.get(mapping.stationId) ?? [];
    bucket.push({
      printerId: mapping.printerId,
      paperWidth: mapping.paperWidth,
      resolution: mapping.resolution,
    });
    printersByStation.set(mapping.stationId, bucket);
  }

  const at = new Date().toISOString();

  // Identical whole portions at a station with the same correction share one slip, whatever the
  // station's grouping, as one line of their summed quantity would.
  const whole = read?.whole ?? (await readWholePortionLines(tx, lineIds));
  const slips: {
    stationId: string;
    item: KitchenTicketItem;
    block: KitchenAllergyBlock | null;
    thousandths: number;
  }[] = [];
  const byKey = new Map<string, (typeof slips)[number]>();
  for (const target of items) {
    if (!printersByStation.has(target.stationId)) continue;
    const entry = itemsByLine.get(target.workingOrderLineId)!;
    const fired = changeItem(entry.item, target);
    const item =
      target.group === undefined
        ? fired
        : {
            ...fired,
            group: target.group,
            groupLabel:
              target.numberPartyLabel ??
              (target.group === entry.group ? fired.groupLabel : undefined),
          };
    const block =
      change.kind === "ALLERGY" ? (change.blocks.get(target.workingOrderLineId) ?? null) : null;
    const merge = whole.has(target.workingOrderLineId) ? mergeKey(item) : undefined;
    const key = merge === undefined ? undefined : JSON.stringify([target.stationId, merge, block]);
    const same = key === undefined ? undefined : byKey.get(key);
    if (same !== undefined) {
      same.thousandths += target.quantity;
      continue;
    }
    const slip = { stationId: target.stationId, item, block, thousandths: target.quantity };
    slips.push(slip);
    if (key !== undefined) byKey.set(key, slip);
  }

  for (const { stationId, item, block, thousandths } of slips) {
    const targets = printersByStation.get(stationId)!;
    const correction =
      change.kind !== "ALLERGY"
        ? change
        : block === null
          ? { kind: "ALLERGY REMOVED" as const, allergyBlock: null }
          : { kind: "ALLERGY CHANGED" as const, allergyBlock: block };
    for (const group of groupByLayout(targets)) {
      const bytes = formatCorrectionSlip(
        {
          ...correction,
          locale: language,
          kitchenNote: kitchenNote === null ? undefined : { text: kitchenNote, locale: language },
          party: partyName === null ? undefined : { name: partyName, locale: language },
          stationName: stationNames.get(stationId)!.name,
          tableLabel: header.tableLabel,
          orderNumber: header.orderNumber,
          takeAway: header.takeAway,
          at,
          item: { ...item, qty: thousandthsToDecimal(thousandths) },
        },
        group[0]!,
        timeZone,
      );
      for (const printer of group) {
        const { jobId } = await enqueuePrintJob(tx, printer.printerId, bytes, "document");
        // A Reprint repeats the original allergy instructions. Only resending delivers the change.
        if (change.kind !== "ALLERGY") {
          await linkKitchenJob(tx, jobId, orderId, [stationId], "correction");
        }
      }
    }
  }
}
