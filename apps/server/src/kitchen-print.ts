// Kitchen print jobs for fired items, and HOLD tickets and HOLD corrections for held work, each
// enqueued on its caller's transaction so it rolls back with it.
//
// A printer never blocks a fire (CLAUDE.md §5): `enqueuePrintJob` is an outbox insert that opens no
// socket. Its one throw, `printer.not_found` for an inactive printer, cannot happen here: the
// mapping read the enqueue paths use (`printerMappings` without `switchedOffToo`) keeps active
// printers only, and no other write transaction can run between that read and the enqueue, because
// one write transaction runs on the venue file at a time (`withTransaction`,
// `packages/db/src/tenancy.ts`). Receipt: `assertExtraListForWrite` in
// `packages/catalogue/src/extras.ts`.
import { and, eq, inArray, isNotNull, isNull, ne, or, sql } from "drizzle-orm";
import type { SQL } from "drizzle-orm";
import { alias } from "drizzle-orm/sqlite-core";
import {
  kitchenPrintJobLines,
  kitchenPrintJobs,
  kitchenStations,
  orderGroups,
  orderTableLabels,
  printJobs,
  printers,
  stationPrinters,
  ticketItems,
  ticketState,
  parties,
  workingOrderLines,
  workingOrders,
} from "@waitron/db";
import type { Transaction } from "@waitron/db";
import { AppError, perDishOptionQuantity, thousandthsToDecimal } from "@waitron/shared";
import type { Decimal } from "@waitron/shared";
import { kitchenPresentationName, optionSnapshotLabels } from "@waitron/catalogue";
import { columnsFor, enqueuePrintJob } from "@waitron/printing";
import type { CharacterSet, PaperWidth, PrintConfig } from "@waitron/printing";
import { arrangeTicketItems, formatCorrectionSlip, formatKitchenTicket } from "./kitchen-ticket.js";
import { VENUE_SERVICE } from "./modules.js";
import { printJobInTrouble } from "./print-job-trouble.js";
import { partyFamilies, partyFamily } from "./parties.js";
import type { KitchenLayout, KitchenTicketItem, KitchenTicketStation } from "./kitchen-ticket.js";
import type { TillConfig } from "./till-config.js";
import "./errors.js";

/**
 * An item to print: its line, its station and the quantity to print. A fire captures its items from
 * its own write's `RETURNING`, never by re-querying `ticket_items`, which would re-select earlier
 * rounds' items and reprint them.
 */
export interface FiredItem {
  workingOrderLineId: string;
  stationId: string;
  /**
   * The ticket item's fired quantity, as thousandths, printed in place of the line's current
   * quantity. Absent or null prints the line's, as a ticket item older than
   * `0014_order_edit_columns.sql` carries none.
   */
  quantity?: number | null;
}

/** `entry`'s printed item at the quantity `item` was fired at, where it records one. */
function atFiredQuantity(entry: KitchenTicketItem, item: FiredItem): KitchenTicketItem {
  return item.quantity == null ? entry : { ...entry, qty: thousandthsToDecimal(item.quantity) };
}

/**
 * Pick one language out of a snapshotted locale→string map (a line's unit label). A till whose locale
 * is not among the map's keys prints some stored language rather than a blank.
 */
function ticketName(text: Record<string, string>, locale: string): string {
  const localised = text[locale];
  if (localised !== undefined) return localised;
  // The map is never empty: `unit_name` freezes a unit's abbreviation, and `createUnit` and
  // `updateUnit` (`packages/catalogue/src/units.ts`) put it through `requireTranslations`.
  return Object.values(text)[0]!;
}

/**
 * An extras child as its dish's kitchen paper prints it: its frozen staff name — the picked
 * product's own — with ` x<n>` when the dish carries more than one of it each.
 */
function extraLabel(name: string, quantity: Decimal, dishQuantity: Decimal): string {
  const perDish = perDishOptionQuantity(quantity, dishQuantity);
  return perDish > 1 ? `${name} x${perDish}` : name;
}

interface PrinterMapping {
  stationId: string;
  printerId: string;
  ticketScope: "station" | "order";
  paperWidth: PaperWidth;
  characterSet: CharacterSet;
  characterTable: number;
}

/**
 * The station→printer mappings for `stationIds`, ACTIVE printers only unless `switchedOffToo`. The
 * fire and correction paths both resolve printers here without it, so the header's never-block
 * argument covers both.
 */
async function printerMappings(
  tx: Transaction,
  stationIds: string[],
  { switchedOffToo = false }: { switchedOffToo?: boolean } = {},
): Promise<PrinterMapping[]> {
  return tx
    .select({
      stationId: stationPrinters.stationId,
      printerId: stationPrinters.printerId,
      ticketScope: printers.ticketScope,
      paperWidth: printers.paperWidth,
      characterSet: printers.characterSet,
      characterTable: printers.characterTable,
    })
    .from(stationPrinters)
    .innerJoin(printers, eq(stationPrinters.printerId, printers.id))
    .where(
      and(
        inArray(stationPrinters.stationId, stationIds),
        switchedOffToo ? undefined : eq(printers.active, true),
      ),
    );
}

/** The settings that change a kitchen ticket's bytes. Resolution does not: kitchen paper has no QR. */
interface KitchenPrinterLayout {
  paperWidth: PaperWidth;
  characterSet: CharacterSet;
  characterTable: number;
}

function layoutOf(printer: KitchenPrinterLayout): KitchenLayout {
  return {
    columns: columnsFor(printer.paperWidth),
    charset: printer.characterSet,
    characterTable: printer.characterTable,
  };
}

/** `printers` grouped by paper width and character set, in first-seen order: one ticket per group. */
function groupByLayout<T extends KitchenPrinterLayout>(printers: readonly T[]): T[][] {
  const groups = new Map<string, T[]>();
  for (const printer of printers) {
    const key = `${printer.paperWidth}|${printer.characterSet}|${printer.characterTable}`;
    const group = groups.get(key);
    if (group === undefined) groups.set(key, [printer]);
    else group.push(printer);
  }
  return [...groups.values()];
}

/**
 * Each line's printed item, keyed by line id and carrying its `line_no` and the position of the
 * party's group it is in (null in none). The fire and correction paths share it, so a slip lays out
 * a line's item the way its ticket did, from the line as it stands when the slip prints. `lineIds`
 * are parent dish lines; a child modifier line prints as sub-text of its parent.
 */
async function buildTicketItems(
  tx: Transaction,
  cfg: TillConfig,
  lineIds: string[],
): Promise<Map<string, { lineNo: number; group: number | null; item: KitchenTicketItem }>> {
  // The customer-facing `descriptions` is deliberately not read: the cook's name falls back to the
  // staff name (`kitchenPresentationName`), as on the station screen.
  const storedLineRows = await tx
    .select({
      id: workingOrderLines.id,
      lineNo: workingOrderLines.lineNo,
      quantity: workingOrderLines.quantity,
      name: workingOrderLines.name,
      optionSnapshots: workingOrderLines.optionSnapshots,
      unitName: workingOrderLines.unitName,
      kitchenName: workingOrderLines.kitchenName,
      variantName: workingOrderLines.variantName,
      variantKitchenName: workingOrderLines.variantKitchenName,
      note: workingOrderLines.note,
      group: orderGroups.position,
    })
    .from(workingOrderLines)
    .leftJoin(orderGroups, eq(orderGroups.id, workingOrderLines.groupId))
    .where(inArray(workingOrderLines.id, lineIds));
  const lineRows = storedLineRows.map((row) => ({
    ...row,
    quantity: thousandthsToDecimal(row.quantity),
  }));
  const lineById = new Map(lineRows.map((row) => [row.id, row]));
  const eachByIdentity = await VENUE_SERVICE.readLinesSoldInEach(tx, lineIds);

  // Ordered by `line_no` so the picks print in the order they were offered.
  const storedChildRows = await tx
    .select({
      parentLineId: workingOrderLines.parentLineId,
      lineNo: workingOrderLines.lineNo,
      quantity: workingOrderLines.quantity,
      name: workingOrderLines.name,
    })
    .from(workingOrderLines)
    .where(inArray(workingOrderLines.parentLineId, lineIds))
    .orderBy(workingOrderLines.lineNo);
  const childRows = storedChildRows.map((row) => ({
    ...row,
    quantity: thousandthsToDecimal(row.quantity),
  }));
  // The per-dish pick count is recovered from the stored combined child quantity. Every child's
  // parent is in `lineById`.
  const modifiersByParent = new Map<string, string[]>();
  for (const child of childRows) {
    const parent = lineById.get(child.parentLineId!)!;
    const names = modifiersByParent.get(child.parentLineId!) ?? [];
    names.push(extraLabel(child.name, child.quantity, parent.quantity));
    modifiersByParent.set(child.parentLineId!, names);
  }

  const byLine = new Map<
    string,
    { lineNo: number; group: number | null; item: KitchenTicketItem }
  >();
  for (const row of lineRows) {
    const unit =
      row.unitName == null || eachByIdentity.has(row.id)
        ? undefined
        : ticketName(row.unitName, cfg.locale);
    byLine.set(row.id, {
      lineNo: row.lineNo,
      group: row.group,
      item: {
        qty: row.quantity,
        unit,
        name: kitchenPresentationName(row),
        note: row.note ?? undefined,
        ...(unit === undefined ? {} : { printedAsSold: true }),
        modifiers: [
          ...optionSnapshotLabels(row.optionSnapshots),
          ...(modifiersByParent.get(row.id) ?? []),
        ],
      },
    });
  }
  return byLine;
}

async function readStationNames(
  tx: Transaction,
  stationIds: string[],
): Promise<Map<string, string>> {
  const rows = await tx
    .select({ id: kitchenStations.id, name: kitchenStations.name })
    .from(kitchenStations)
    .where(inArray(kitchenStations.id, stationIds));
  return new Map(rows.map((row) => [row.id, row.name]));
}

/** The order's table, as {@link orderTableLabels} names it. */
export async function orderTableLabel(
  tx: Transaction,
  cfg: TillConfig,
  orderId: string,
): Promise<string | null> {
  return (await readOrderHeader(tx, cfg, orderId)).tableLabel;
}

/** What a kitchen paper for an order is headed with. */
interface OrderHeader {
  orderNumber: string;
  tableLabel: string | null;
}

/** Each order's number and table ({@link orderTableLabels}), keyed by order. */
async function readOrderHeaders(
  tx: Transaction,
  cfg: TillConfig,
  orderIds: readonly string[],
): Promise<Map<string, OrderHeader>> {
  const orders = await tx
    .select({
      id: workingOrders.id,
      orderNumber: workingOrders.orderNumber,
      partyId: workingOrders.partyId,
      deliveryTableId: workingOrders.deliveryTableId,
      label: workingOrders.label,
    })
    .from(workingOrders)
    .where(inArray(workingOrders.id, [...orderIds]));
  const labels = await orderTableLabels(tx, cfg.locationId, orders);
  return new Map(
    orders.map((order) => [
      order.id,
      { orderNumber: String(order.orderNumber), tableLabel: labels.get(order.id)! },
    ]),
  );
}

async function readOrderHeader(
  tx: Transaction,
  cfg: TillConfig,
  orderId: string,
): Promise<OrderHeader> {
  return (await readOrderHeaders(tx, cfg, [orderId])).get(orderId)!;
}

/** A kitchen ticket's printers, all of one layout so they share its bytes. */
interface KitchenRoute {
  /** A `station`-scope printer's route names the one station; an `order`-scope printer's is null. */
  station: string | null;
  stationIds: string[];
  printers: PrinterMapping[];
}

/** One kitchen print job: its printer, the stations and lines its paper carries, and its bytes. */
type KitchenJob = Omit<KitchenRoute, "printers"> & {
  printerId: string;
  lineIds: string[];
  bytes: Uint8Array;
};

/** Each station's printer mappings, in the order of the list they came from, with their place in it. */
type MappingsByStation = ReadonlyMap<string, readonly (PrinterMapping & { at: number })[]>;

function mappingsByStation(mappings: readonly PrinterMapping[]): MappingsByStation {
  const byStation = new Map<string, (PrinterMapping & { at: number })[]>();
  mappings.forEach((mapping, at) => {
    const bucket = byStation.get(mapping.stationId) ?? [];
    bucket.push({ ...mapping, at });
    byStation.set(mapping.stationId, bucket);
  });
  return byStation;
}

/**
 * Which printers get a ticket for which stations, in job order. For each INVOLVED station, in the
 * order given, each attached `station`-scope printer gets a ticket of that station's own items;
 * every `order`-scope (group) printer attached to an involved station, or to one of
 * `orderScopeAlsoAt`'s, gets ONE consolidated ticket of the whole event, deduped by printer id,
 * which lists, and is linked to, only the involved stations. `mappings` may name other stations.
 */
function routeKitchenTickets(
  stationIds: readonly string[],
  orderScopeAlsoAt: readonly string[],
  mappings: MappingsByStation,
): KitchenRoute[] {
  if (stationIds.length === 0) return [];
  const routes: KitchenRoute[] = [];
  const groupPrinters = new Map<string, PrinterMapping>();
  for (const stationId of stationIds) {
    const attached = mappings.get(stationId) ?? [];
    for (const printer of attached) {
      if (printer.ticketScope === "order") groupPrinters.set(printer.printerId, printer);
    }
    const stationScope = attached.filter((printer) => printer.ticketScope === "station");
    for (const printers of groupByLayout(stationScope)) {
      routes.push({ station: stationId, stationIds: [stationId], printers });
    }
  }
  // Back in the list's order, as walking the whole list would add them.
  const orderScope = [...new Set([...stationIds, ...orderScopeAlsoAt])]
    .flatMap((stationId) => mappings.get(stationId) ?? [])
    .filter((mapping) => mapping.ticketScope === "order")
    .sort((a, b) => a.at - b.at);
  for (const mapping of orderScope) {
    if (!groupPrinters.has(mapping.printerId)) groupPrinters.set(mapping.printerId, mapping);
  }
  for (const printers of groupByLayout([...groupPrinters.values()])) {
    routes.push({ station: null, stationIds: [...stationIds], printers });
  }
  return routes;
}

/**
 * The kitchen tickets for a set of just-fired lines, routed by {@link routeKitchenTickets} over the
 * involved stations in name order. A `HOLD` ticket's `firedItems` are the held items printed in
 * advance.
 */
async function planKitchenTickets(
  tx: Transaction,
  cfg: TillConfig,
  orderId: string,
  firedItems: FiredItem[],
  {
    reprint,
    mark,
    orderScopeAlsoAt = [],
  }: { reprint: boolean; mark?: "HOLD" | "FIRE"; orderScopeAlsoAt?: readonly string[] },
): Promise<KitchenJob[]> {
  if (firedItems.length === 0) return [];

  const stationIds = [...new Set(firedItems.map((f) => f.stationId))];

  const mappingRows = await printerMappings(tx, [...new Set([...stationIds, ...orderScopeAlsoAt])]);

  if (mappingRows.length === 0) return [];

  const lineIds = [...new Set(firedItems.map((f) => f.workingOrderLineId))];

  const itemsByLine = await buildTicketItems(tx, cfg, lineIds);
  const stationNames = await readStationNames(tx, stationIds);
  const order = await readOrderHeader(tx, cfg, orderId);
  const grouping = await VENUE_SERVICE.readKitchenTicketGrouping(tx);

  const itemsByStation = new Map<string, { lineNo: number; item: KitchenTicketItem }[]>();
  for (const fired of firedItems) {
    const entry = itemsByLine.get(fired.workingOrderLineId)!;
    const item = atFiredQuantity(entry.item, fired);
    const bucket = itemsByStation.get(fired.stationId) ?? [];
    bucket.push({
      lineNo: entry.lineNo,
      item: entry.group === null ? item : { ...item, group: entry.group },
    });
    itemsByStation.set(fired.stationId, bucket);
  }

  // Group-less items first, then group by group: the ticket heads each group's run of items.
  const groupOrder = (item: KitchenTicketItem) => item.group ?? 0;
  // Station names are unique per location, so the name alone orders them.
  const stations = [...stationNames.entries()]
    .map(([id, name]) => ({
      id,
      name,
      items: arrangeTicketItems(
        itemsByStation
          .get(id)!
          .sort((a, b) => groupOrder(a.item) - groupOrder(b.item) || a.lineNo - b.lineNo)
          .map((entry) => entry.item),
        grouping,
      ),
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
  const stationById = new Map(stations.map((station) => [station.id, station]));

  const jobs: KitchenJob[] = [];
  const routes = routeKitchenTickets(
    stations.map((station) => station.id),
    orderScopeAlsoAt,
    mappingsByStation(mappingRows),
  );
  const head = {
    reprint,
    mark,
    tableLabel: order.tableLabel ?? "",
    orderNumber: order.orderNumber,
    firedAt: new Date(),
  };
  for (const route of routes) {
    const station = route.station === null ? null : stationById.get(route.station)!;
    const bytes = formatKitchenTicket(
      station === null
        ? {
            ...head,
            scope: "order",
            stations: stations.map((each): KitchenTicketStation => ({
              stationName: each.name,
              items: each.items,
            })),
          }
        : { ...head, scope: "station", stationName: station.name, items: station.items },
      layoutOf(route.printers[0]!),
    );
    const lineIds = [
      ...new Set(
        firedItems
          .filter((fired) => route.stationIds.includes(fired.stationId))
          .map((fired) => fired.workingOrderLineId),
      ),
    ];
    for (const printer of route.printers) {
      jobs.push({
        printerId: printer.printerId,
        station: route.station,
        stationIds: route.stationIds,
        lineIds,
        bytes,
      });
    }
  }
  return jobs;
}

/** Enqueue each job and link it to the bill and to every station and line its paper carries. */
async function enqueueKitchenJobs(
  tx: Transaction,
  cfg: TillConfig,
  orderId: string,
  jobs: readonly KitchenJob[],
  reprint: boolean,
): Promise<void> {
  const printCfg: PrintConfig = { locationId: cfg.locationId };
  for (const job of jobs) {
    const { jobId } = await enqueuePrintJob(tx, printCfg, job.printerId, job.bytes);
    await linkKitchenJob(tx, jobId, orderId, job.stationIds, reprint);
    await tx
      .insert(kitchenPrintJobLines)
      .values(job.lineIds.map((workingOrderLineId) => ({ printJobId: jobId, workingOrderLineId })));
  }
}

/**
 * Enqueue the kitchen tickets for a set of just-fired lines ({@link planKitchenTickets}), each job
 * linked to the bill and to every station its ticket carries (`kitchen_print_jobs`) and to every
 * line it carries (`kitchen_print_job_lines`). Answers whether any job was enqueued.
 */
export async function enqueueKitchenTickets(
  tx: Transaction,
  cfg: TillConfig,
  orderId: string,
  firedItems: FiredItem[],
  { mark }: { mark?: "HOLD" | "FIRE" } = {},
): Promise<boolean> {
  const jobs = await planKitchenTickets(tx, cfg, orderId, firedItems, { reprint: false, mark });
  await enqueueKitchenJobs(tx, cfg, orderId, jobs, false);
  return jobs.length > 0;
}

/** Record which bill and stations a kitchen ticket's job carried. */
async function linkKitchenJob(
  tx: Transaction,
  printJobId: string,
  workingOrderId: string,
  stationIds: string[],
  reprint: boolean,
): Promise<void> {
  await tx
    .insert(kitchenPrintJobs)
    .values(stationIds.map((stationId) => ({ printJobId, workingOrderId, stationId, reprint })));
}

/** `queued → preparing → ready`. */
export type TicketState = (typeof ticketState.enumValues)[number];

/** Whether the cook has started an item. */
export function isStarted(state: TicketState | null): boolean {
  return state === "preparing" || state === "ready";
}

/**
 * What the kitchen was asked to make: the ticket item's fired quantity. A ticket item with none (every
 * row older than `0014_order_edit_columns.sql`) reads its line's current quantity instead. For a
 * query joining `ticket_items` to its `working_order_lines` row.
 */
export const firedQuantity = sql<number>`coalesce(${ticketItems.quantity}, ${workingOrderLines.quantity})`;

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
  /** On a HOLD correction, the position of the group whose HOLD ticket it corrects. */
  group?: number;
}

/** What a correction slip says happened; the slip's header and its sign follow from it. */
type CorrectionChange =
  | { kind: "VOID" | "RECALLED" }
  | { kind: "MOVED"; movedFrom: { tableLabel: string | null; orderNumber: string } }
  | { kind: "EXTRA CANCELLED"; held: boolean; cancelledExtra: string; locale: string }
  | HoldCorrection;

/** A change to held work on a queued HOLD ticket: quantity `added` or `removed`, or cancelled. */
export type HoldCorrection =
  { kind: "HOLD CHANGED"; direction: "added" | "removed" } | { kind: "HOLD CANCELLED" };

/**
 * Record a kitchen notice per item for a RECALL ({@link recallLines}) or VOID ({@link removeFromLine})
 * of a line that had already fired, then enqueue a correction slip per item where its station has
 * an active printer; callers pass only fired lines. The notice is recorded whether or not a printer
 * exists, so a station screen sees every correction. Each slip goes to every active printer on the
 * line's station, whatever its scope, and prints the item through {@link buildTicketItems}, at the
 * item's quantity. The header's never-block argument applies unchanged.
 *
 * A void must call this before deleting the line: the delete cascades its ticket item away, and both
 * the notice and the slip re-read the line from `working_order_lines`.
 */
export async function enqueueCorrectionSlips(
  tx: Transaction,
  cfg: TillConfig,
  orderId: string,
  items: CorrectionItem[],
  kind: "VOID" | "RECALLED",
): Promise<void> {
  if (items.length === 0) return;

  await VENUE_SERVICE.recordKitchenNotices(
    tx,
    cfg,
    orderId,
    items.map(toNoticeItem),
    kind === "VOID" ? "void" : "recalled",
  );
  await printCorrectionSlips(tx, cfg, orderId, items, { kind });
}

/**
 * Record a kitchen notice per item for a change to held work on a queued HOLD ticket — `changed`
 * with its direction, or `void` for a cancellation — then enqueue a HOLD correction slip per item,
 * naming its group, as {@link enqueueCorrectionSlips} enqueues a slip.
 */
export async function enqueueHoldCorrections(
  tx: Transaction,
  cfg: TillConfig,
  orderId: string,
  items: (CorrectionItem & { group: number })[],
  change: HoldCorrection,
): Promise<void> {
  await VENUE_SERVICE.recordKitchenNotices(
    tx,
    cfg,
    orderId,
    items.map(toNoticeItem),
    change.kind === "HOLD CANCELLED" ? "void" : "changed",
    null,
    change.kind === "HOLD CANCELLED" ? null : change.direction,
  );
  await printCorrectionSlips(tx, cfg, orderId, items, change);
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
    stationId: string | null;
    state: TicketState;
    firedQuantity: number;
  } | null;
}

/** Read before the extra's line is deleted: it names the extra from the line. */
export async function readCancelledExtra(
  tx: Transaction,
  extraLineId: string,
): Promise<CancelledExtra> {
  const extra = alias(workingOrderLines, "extra");
  const [row] = await tx
    .select({
      name: extra.name,
      quantity: extra.quantity,
      dishLineId: workingOrderLines.id,
      dishQuantity: workingOrderLines.quantity,
      dishGroupId: workingOrderLines.groupId,
      ticketItemId: ticketItems.id,
      firedAt: ticketItems.firedAt,
      stationId: ticketItems.stationId,
      state: ticketItems.state,
      firedQuantity,
    })
    .from(extra)
    .innerJoin(workingOrderLines, eq(workingOrderLines.id, extra.parentLineId))
    .leftJoin(ticketItems, eq(ticketItems.workingOrderLineId, workingOrderLines.id))
    .where(eq(extra.id, extraLineId));
  const found = row!;
  return {
    label: extraLabel(
      found.name,
      thousandthsToDecimal(found.quantity),
      thousandthsToDecimal(found.dishQuantity),
    ),
    dishLineId: found.dishLineId,
    dishGroupId: found.dishGroupId,
    item:
      found.ticketItemId === null
        ? null
        : {
            firedAt: found.firedAt,
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
 * held work on a queued HOLD ticket. Call it after the extra's line is deleted, so the slip prints
 * the extras the dish keeps.
 */
export async function enqueueExtraCancelled(
  tx: Transaction,
  cfg: TillConfig,
  orderId: string,
  item: CorrectionItem,
  cancelledExtra: string,
): Promise<void> {
  await VENUE_SERVICE.recordKitchenNotices(
    tx,
    cfg,
    orderId,
    [toNoticeItem(item)],
    "changed",
    null,
    null,
    cancelledExtra,
  );
  await printCorrectionSlips(tx, cfg, orderId, [item], {
    kind: "EXTRA CANCELLED",
    held: item.group !== undefined,
    cancelledExtra,
    locale: cfg.locale,
  });
}

function toNoticeItem(item: CorrectionItem) {
  return {
    workingOrderLineId: item.workingOrderLineId,
    stationId: item.stationId,
    quantity: thousandthsToDecimal(item.quantity),
    wasStarted: item.wasStarted,
  };
}

/** One slip per item, to every active printer on its station, headed with the order's CURRENT table. */
async function printCorrectionSlips(
  tx: Transaction,
  cfg: TillConfig,
  orderId: string,
  items: CorrectionItem[],
  change: CorrectionChange,
  knownHeader?: OrderHeader,
): Promise<void> {
  const stationIds = [...new Set(items.map((i) => i.stationId))];
  const mappingRows = await printerMappings(tx, stationIds);
  if (mappingRows.length === 0) return;

  const lineIds = [...new Set(items.map((i) => i.workingOrderLineId))];
  const itemsByLine = await buildTicketItems(tx, cfg, lineIds);
  const stationNames = await readStationNames(tx, stationIds);
  const header = knownHeader ?? (await readOrderHeader(tx, cfg, orderId));

  const printersByStation = new Map<string, (KitchenPrinterLayout & { printerId: string })[]>();
  for (const mapping of mappingRows) {
    const bucket = printersByStation.get(mapping.stationId) ?? [];
    bucket.push({
      printerId: mapping.printerId,
      paperWidth: mapping.paperWidth,
      characterSet: mapping.characterSet,
      characterTable: mapping.characterTable,
    });
    printersByStation.set(mapping.stationId, bucket);
  }

  const printCfg: PrintConfig = { locationId: cfg.locationId };
  const at = new Date().toISOString();

  for (const target of items) {
    const attachedPrinters = printersByStation.get(target.stationId);
    // A line whose station has no active printer produced no paper — nothing to correct there.
    if (attachedPrinters === undefined) continue;
    const entry = itemsByLine.get(target.workingOrderLineId)!;
    const item = atFiredQuantity(entry.item, target);
    for (const group of groupByLayout(attachedPrinters)) {
      const bytes = formatCorrectionSlip(
        {
          ...change,
          stationName: stationNames.get(target.stationId)!,
          tableLabel: header.tableLabel,
          orderNumber: header.orderNumber,
          at,
          item: target.group === undefined ? item : { ...item, group: target.group },
        },
        layoutOf(group[0]!),
      );
      for (const printer of group) {
        await enqueuePrintJob(tx, printCfg, printer.printerId, bytes);
      }
    }
  }
}

/** An order's fired kitchen work, and the table and order number its correction slips name. */
export interface SentWork {
  tableLabel: string | null;
  orderNumber: string;
  ticketItemIds: ReadonlySet<string>;
}

/** Read before a path moves an order's lines to another table. */
export async function readSentWork(
  tx: Transaction,
  cfg: TillConfig,
  orderId: string,
): Promise<SentWork> {
  const fired = await tx
    .select({ id: ticketItems.id })
    .from(ticketItems)
    .where(and(eq(ticketItems.workingOrderId, orderId), isNotNull(ticketItems.firedAt)));
  if (fired.length === 0) return { tableLabel: null, orderNumber: "", ticketItemIds: new Set() };
  return {
    ...(await readOrderHeader(tx, cfg, orderId)),
    ticketItemIds: new Set(fired.map((row) => row.id)),
  };
}

/**
 * Tell the kitchen of sent work that moved to another table. When the table a correction slip names
 * for `toOrderId` now differs from the one `before` read, each of `before`'s fired items now on
 * `toOrderId` gets a `moved` notice, at the quantity its ticket asks for, and a MOVED slip where its
 * station has an active printer. `splitFrom` maps a ticket item a split made to the one it copied.
 * `force` tells the kitchen whatever the two labels read: a bill moved to or from the counter can
 * read the same on both sides.
 */
export async function enqueueMovedSlips(
  tx: Transaction,
  cfg: TillConfig,
  before: SentWork,
  toOrderId: string,
  splitFrom: ReadonlyMap<string, string> = new Map(),
  options: { force?: boolean } = {},
): Promise<void> {
  if (before.ticketItemIds.size === 0) return;
  const header = await readOrderHeader(tx, cfg, toOrderId);
  if (options.force !== true && header.tableLabel === before.tableLabel) return;
  const fired = await readTicketItemsOn(tx, [toOrderId]);
  await notifyMoved(tx, cfg, before, toOrderId, header, fired.get(toOrderId) ?? [], splitFrom);
}

/** A ticket item on an order, as a MOVED notice reads it. */
interface ItemOnOrder {
  id: string;
  workingOrderLineId: string;
  stationId: string | null;
  state: TicketState;
  quantity: number;
}

/** The ticket items on each order, in line order, keyed by order. */
async function readTicketItemsOn(
  tx: Transaction,
  orderIds: readonly string[],
): Promise<Map<string, ItemOnOrder[]>> {
  const rows = await tx
    .select({
      orderId: ticketItems.workingOrderId,
      id: ticketItems.id,
      workingOrderLineId: ticketItems.workingOrderLineId,
      stationId: ticketItems.stationId,
      state: ticketItems.state,
      quantity: firedQuantity,
    })
    .from(ticketItems)
    .innerJoin(workingOrderLines, eq(workingOrderLines.id, ticketItems.workingOrderLineId))
    .where(inArray(ticketItems.workingOrderId, [...orderIds]))
    .orderBy(workingOrderLines.lineNo, ticketItems.id);
  const byOrder = new Map<string, ItemOnOrder[]>();
  for (const { orderId, ...item } of rows) {
    const items = byOrder.get(orderId) ?? [];
    items.push(item);
    byOrder.set(orderId, items);
  }
  return byOrder;
}

/**
 * The `moved` notices and MOVED slips for `before`'s items now on `toOrderId`, whose current
 * header and ticket items the caller has read and whose table differs from `before`'s.
 */
async function notifyMoved(
  tx: Transaction,
  cfg: TillConfig,
  before: SentWork,
  toOrderId: string,
  header: OrderHeader,
  onOrder: readonly ItemOnOrder[],
  splitFrom: ReadonlyMap<string, string>,
): Promise<void> {
  const moved: CorrectionItem[] = onOrder
    .filter((item) => before.ticketItemIds.has(splitFrom.get(item.id) ?? item.id))
    .map((item) => ({
      workingOrderLineId: item.workingOrderLineId,
      stationId: item.stationId!,
      quantity: item.quantity,
      wasStarted: isStarted(item.state),
    }));
  if (moved.length === 0) return;

  await VENUE_SERVICE.recordKitchenNotices(
    tx,
    cfg,
    toOrderId,
    moved.map(toNoticeItem),
    "moved",
    header.tableLabel,
  );
  await printCorrectionSlips(
    tx,
    cfg,
    toOrderId,
    moved,
    {
      kind: "MOVED",
      movedFrom: { tableLabel: before.tableLabel, orderNumber: before.orderNumber },
    },
    header,
  );
}

/**
 * The sent work of every open, placed or settled bill of `partyIds` and of every party merged into
 * them ({@link partyFamilies}), keyed by bill; a bill with nothing fired is left out. Read before a
 * table action changes which tables those bills belong to.
 */
export async function readPartiesSentWork(
  tx: Transaction,
  cfg: TillConfig,
  partyIds: readonly string[],
): Promise<Map<string, SentWork>> {
  const work = new Map<string, SentWork>();
  const ofParties = [...new Set([...(await partyFamilies(tx, partyIds)).values()].flat())];
  const rows = await tx
    .select({
      id: workingOrders.id,
      orderNumber: workingOrders.orderNumber,
      partyId: workingOrders.partyId,
      deliveryTableId: workingOrders.deliveryTableId,
      label: workingOrders.label,
      ticketItemId: ticketItems.id,
    })
    .from(workingOrders)
    .innerJoin(
      ticketItems,
      and(eq(ticketItems.workingOrderId, workingOrders.id), isNotNull(ticketItems.firedAt)),
    )
    .where(
      and(
        inArray(workingOrders.status, ["open", "placed", "settled"]),
        inArray(workingOrders.partyId, ofParties),
      ),
    );
  const sent = new Map<
    string,
    { bill: Omit<(typeof rows)[number], "ticketItemId">; fired: Set<string> }
  >();
  for (const { ticketItemId, ...bill } of rows) {
    const entry = sent.get(bill.id) ?? { bill, fired: new Set<string>() };
    entry.fired.add(ticketItemId);
    sent.set(bill.id, entry);
  }
  const labels = await orderTableLabels(
    tx,
    cfg.locationId,
    [...sent.values()].map(({ bill }) => bill),
  );
  for (const { bill, fired } of sent.values()) {
    work.set(bill.id, {
      tableLabel: labels.get(bill.id)!,
      orderNumber: String(bill.orderNumber),
      ticketItemIds: fired,
    });
  }
  return work;
}

/**
 * {@link enqueueMovedSlips} for each bill `before` read, onto the bill `mergedInto` maps it to, else
 * onto itself, reading every destination's header and ticket items once.
 */
export async function enqueueMovedSlipsFor(
  tx: Transaction,
  cfg: TillConfig,
  before: ReadonlyMap<string, SentWork>,
  mergedInto: ReadonlyMap<string, string> = new Map(),
): Promise<void> {
  const moves = [...before]
    .filter(([, work]) => work.ticketItemIds.size > 0)
    .map(([billId, work]) => ({ work, to: mergedInto.get(billId) ?? billId }));
  if (moves.length === 0) return;
  const headers = await readOrderHeaders(tx, cfg, [...new Set(moves.map((move) => move.to))]);
  const changed = moves.filter((move) => headers.get(move.to)!.tableLabel !== move.work.tableLabel);
  if (changed.length === 0) return;
  const onOrders = await readTicketItemsOn(tx, [...new Set(changed.map((move) => move.to))]);
  for (const { work, to } of changed) {
    await notifyMoved(tx, cfg, work, to, headers.get(to)!, onOrders.get(to) ?? [], new Map());
  }
}

interface ReprintPart {
  items: FiredItem[];
  mark?: "HOLD";
  orderScopeAlsoAt: string[];
}

/**
 * What a Reprint of each of `orderIds` prints: every fired item across every round, and the held
 * items of each still-held group whose HOLD ticket was queued, marked HOLD. Pass printers are chosen
 * over both parts: a pass printer's failed ticket can name a station it is not attached to, and no
 * print but a reprint on that printer linked to that station clears it.
 */
async function readReprintParts(
  tx: Transaction,
  orderIds: readonly string[],
): Promise<Map<string, readonly [fired: ReprintPart, held: ReprintPart]>> {
  const fired = await tx
    .select({
      workingOrderId: ticketItems.workingOrderId,
      workingOrderLineId: ticketItems.workingOrderLineId,
      stationId: ticketItems.stationId,
      quantity: ticketItems.quantity,
    })
    .from(ticketItems)
    .where(and(inArray(ticketItems.workingOrderId, [...orderIds]), isNotNull(ticketItems.firedAt)));
  const held = await tx
    .select({
      workingOrderId: ticketItems.workingOrderId,
      workingOrderLineId: ticketItems.workingOrderLineId,
      stationId: ticketItems.stationId,
      quantity: ticketItems.quantity,
    })
    .from(ticketItems)
    .innerJoin(workingOrderLines, eq(workingOrderLines.id, ticketItems.workingOrderLineId))
    .innerJoin(orderGroups, eq(orderGroups.id, workingOrderLines.groupId))
    .where(
      and(
        inArray(ticketItems.workingOrderId, [...orderIds]),
        isNull(ticketItems.firedAt),
        eq(orderGroups.state, "held"),
        isNotNull(orderGroups.holdPrintedAt),
      ),
    );
  const byOrder = (rows: typeof fired) => {
    const items = new Map<string, FiredItem[]>(orderIds.map((id) => [id, []]));
    for (const { workingOrderId, ...item } of rows) items.get(workingOrderId)!.push(item);
    return items;
  };
  const firedByOrder = byOrder(fired);
  const heldByOrder = byOrder(held);
  return new Map(
    orderIds.map((id) => {
      const firedItems = firedByOrder.get(id)!;
      const heldItems = heldByOrder.get(id)!;
      const parts = [
        { items: firedItems, orderScopeAlsoAt: heldItems.map((item) => item.stationId) },
        {
          items: heldItems,
          mark: "HOLD",
          orderScopeAlsoAt: firedItems.map((item) => item.stationId),
        },
      ] as const;
      return [id, parts];
    }),
  );
}

/**
 * Each of `orderIds`' `printer|station` pairs a Reprint of it would link a ticket to were every
 * printer switched on ({@link readReprintParts}, {@link routeKitchenTickets}).
 */
async function readReprintTargets(
  tx: Transaction,
  orderIds: readonly string[],
): Promise<Map<string, Set<string>>> {
  const partsByOrder = await readReprintParts(tx, orderIds);
  const stationIds = new Set<string>();
  for (const parts of partsByOrder.values()) {
    for (const part of parts) for (const item of part.items) stationIds.add(item.stationId);
  }
  // A switched-off printer's failed ticket still names unprinted dishes: once it is back on, a
  // Reprint prints them there.
  const mappings = mappingsByStation(
    stationIds.size === 0
      ? []
      : await printerMappings(tx, [...stationIds], { switchedOffToo: true }),
  );
  const targets = new Map<string, Set<string>>();
  for (const [orderId, parts] of partsByOrder) {
    const pairs = new Set<string>();
    for (const part of parts) {
      const involved = [...new Set(part.items.map((item) => item.stationId))];
      for (const route of routeKitchenTickets(involved, part.orderScopeAlsoAt, mappings)) {
        for (const printer of route.printers) {
          for (const stationId of route.stationIds) pairs.add(`${printer.printerId}|${stationId}`);
        }
      }
    }
    targets.set(orderId, pairs);
  }
  return targets;
}

/**
 * Reprint an order's kitchen tickets ({@link readReprintParts}). Each ticket is marked REPRINT and
 * stamped with the reprint time, not the original fire time. Both tickets for one printer and
 * station, or for one pass printer, go as ONE job: as two, the later one's printing would clear
 * every earlier failure for that bill and station on that printer, including tickets it does not
 * carry ({@link readPrintProblems}). It changes no line, ticket item or group event. An order with
 * nothing to print is a no-op.
 */
export async function reprintOrderTickets(
  tx: Transaction,
  cfg: TillConfig,
  orderId: string,
): Promise<void> {
  const [fired, held] = (await readReprintParts(tx, [orderId])).get(orderId)!;
  const jobs = await planKitchenTickets(tx, cfg, orderId, fired.items, {
    reprint: true,
    orderScopeAlsoAt: fired.orderScopeAlsoAt,
  });
  const holdJobs = await planKitchenTickets(tx, cfg, orderId, held.items, {
    reprint: true,
    mark: held.mark,
    orderScopeAlsoAt: held.orderScopeAlsoAt,
  });
  for (const hold of holdJobs) {
    const same = jobs.find(
      (job) => job.printerId === hold.printerId && job.station === hold.station,
    );
    if (same === undefined) {
      jobs.push(hold);
      continue;
    }
    same.bytes = concatBytes(same.bytes, hold.bytes);
    same.stationIds = [...new Set([...same.stationIds, ...hold.stationIds])];
    same.lineIds = [...new Set([...same.lineIds, ...hold.lineIds])];
  }
  await enqueueKitchenJobs(tx, cfg, orderId, jobs, true);
}

function concatBytes(a: Uint8Array, b: Uint8Array): Uint8Array {
  const joined = new Uint8Array(a.length + b.length);
  joined.set(a);
  joined.set(b, a.length);
  return joined;
}

/** A kitchen ticket for a bill and station not printed after `JOBS_WAITING_MS`, or given up on. */
export interface PrintProblem {
  workingOrderId: string;
  stationId: string;
  stationName: string;
  /** When the oldest such ticket was queued. */
  since: string;
}

/**
 * The printing problems among the kitchen tickets `scope` selects, abandoned bills left out. A
 * ticket is a problem while {@link printJobInTrouble} holds for its job, until a reprint for the same
 * bill and station, on the same printer, queued after it has printed: only a reprint carries every
 * dish still fired on the bill, and the held dishes of each still-held group whose HOLD ticket was
 * queued, so a later round's ticket printing clears nothing, and another printer's paper says
 * nothing of this one's. It is no problem either once a Reprint of the bill would link nothing on
 * that printer to that station, were the printer switched on ({@link readReprintTargets}), as when
 * its dishes there are voided or the printer is detached from the station.
 * "After" is the link row's `rowid`, not `created_at`, which two jobs can share to the millisecond:
 * SQLite gives a new row one more than the table's largest `rowid`, and a link row goes only when
 * its job or its bill is deleted, or when {@link writeLinksAfter} writes it again. Oldest first.
 */
async function readPrintProblems(tx: Transaction, scope: SQL, now: Date): Promise<PrintProblem[]> {
  const troubled = printJobInTrouble(now);
  const rows = await tx
    .select({
      workingOrderId: kitchenPrintJobs.workingOrderId,
      stationId: kitchenPrintJobs.stationId,
      stationName: kitchenStations.name,
      printerId: printJobs.printerId,
      createdAt: printJobs.createdAt,
      queued: sql<number>`${kitchenPrintJobs}.rowid`,
      troubled: sql<number>`${troubled}`,
    })
    .from(kitchenPrintJobs)
    .innerJoin(printJobs, eq(printJobs.id, kitchenPrintJobs.printJobId))
    .innerJoin(workingOrders, eq(workingOrders.id, kitchenPrintJobs.workingOrderId))
    .innerJoin(kitchenStations, eq(kitchenStations.id, kitchenPrintJobs.stationId))
    .where(
      and(
        scope,
        ne(workingOrders.status, "abandoned"),
        or(troubled, and(eq(kitchenPrintJobs.reprint, true), eq(printJobs.status, "done"))),
      ),
    );

  const key = (row: { workingOrderId: string; stationId: string }) =>
    `${row.workingOrderId}|${row.stationId}`;
  const printerKey = (row: { workingOrderId: string; stationId: string; printerId: string }) =>
    `${key(row)}|${row.printerId}`;
  const lastReprinted = new Map<string, number>();
  for (const row of rows) {
    if (row.troubled) continue;
    const seen = lastReprinted.get(printerKey(row));
    if (seen === undefined || row.queued > seen) lastReprinted.set(printerKey(row), row.queued);
  }
  const uncleared = rows.filter((row) => {
    if (!row.troubled) return false;
    const reprinted = lastReprinted.get(printerKey(row));
    return reprinted === undefined || reprinted <= row.queued;
  });
  if (uncleared.length === 0) return [];
  const targets = await readReprintTargets(tx, [
    ...new Set(uncleared.map((row) => row.workingOrderId)),
  ]);
  const problems = new Map<string, PrintProblem>();
  for (const row of uncleared) {
    if (!targets.get(row.workingOrderId)!.has(`${row.printerId}|${row.stationId}`)) continue;
    const known = problems.get(key(row));
    if (known === undefined || row.createdAt < known.since) {
      problems.set(key(row), {
        workingOrderId: row.workingOrderId,
        stationId: row.stationId,
        stationName: row.stationName,
        since: row.createdAt,
      });
    }
  }
  return [...problems.values()].sort(
    (a, b) =>
      a.since.localeCompare(b.since) ||
      a.stationName.localeCompare(b.stationName) ||
      a.workingOrderId.localeCompare(b.workingOrderId),
  );
}

/**
 * `orderId`'s link rows that no printed reprint for the same station, on the same printer, queued
 * after them, has covered: the ones still able to name a missing dish. Oldest first.
 */
async function readUncoveredLinks(tx: Transaction, orderId: string) {
  const rows = await tx
    .select({
      id: kitchenPrintJobs.id,
      printJobId: kitchenPrintJobs.printJobId,
      stationId: kitchenPrintJobs.stationId,
      reprint: kitchenPrintJobs.reprint,
      createdAt: kitchenPrintJobs.createdAt,
      printerId: printJobs.printerId,
      status: printJobs.status,
      queued: sql<number>`${kitchenPrintJobs}.rowid`,
    })
    .from(kitchenPrintJobs)
    .innerJoin(printJobs, eq(printJobs.id, kitchenPrintJobs.printJobId))
    .where(eq(kitchenPrintJobs.workingOrderId, orderId))
    .orderBy(sql`${kitchenPrintJobs}.rowid`);

  const printerKey = (row: { stationId: string; printerId: string }) =>
    `${row.stationId}|${row.printerId}`;
  const lastReprinted = new Map<string, number>();
  for (const row of rows) {
    if (row.reprint && row.status === "done") lastReprinted.set(printerKey(row), row.queued);
  }
  return rows.filter((row) => row.queued > (lastReprinted.get(printerKey(row)) ?? 0));
}

/**
 * Write `rows` onto `orderId` in order, after every link row it already has, replacing its own row
 * for the same job and station, so none of its earlier reprints, which never carried the dishes
 * that brought them, covers them. None counts as a reprint, as none carried `orderId`'s own dishes.
 */
async function writeLinksAfter(
  tx: Transaction,
  orderId: string,
  rows: readonly { id?: string; printJobId: string; stationId: string; createdAt: string }[],
): Promise<void> {
  if (rows.length === 0) return;
  await tx
    .delete(kitchenPrintJobs)
    .where(
      and(
        eq(kitchenPrintJobs.workingOrderId, orderId),
        or(
          ...rows.map((row) =>
            and(
              eq(kitchenPrintJobs.printJobId, row.printJobId),
              eq(kitchenPrintJobs.stationId, row.stationId),
            ),
          ),
        ),
      ),
    );
  await tx.insert(kitchenPrintJobs).values(
    rows.map((row) => ({
      ...(row.id === undefined ? {} : { id: row.id }),
      printJobId: row.printJobId,
      workingOrderId: orderId,
      stationId: row.stationId,
      reprint: false,
      createdAt: row.createdAt,
    })),
  );
}

/**
 * Carry `fromOrderId`'s kitchen tickets onto `intoOrderId` when its dishes move there whole. A
 * ticket a printed reprint already covered stays behind with its reprint, since nothing is left
 * missing. The rest are written again ({@link writeLinksAfter}).
 */
export async function moveKitchenPrintLinks(
  tx: Transaction,
  fromOrderId: string,
  intoOrderId: string,
): Promise<void> {
  const moving = await readUncoveredLinks(tx, fromOrderId);
  if (moving.length === 0) return;
  await tx.delete(kitchenPrintJobs).where(
    inArray(
      kitchenPrintJobs.id,
      moving.map((row) => row.id),
    ),
  );
  await writeLinksAfter(tx, intoOrderId, moving);
}

/**
 * Give `toOrderId` a link to each of `fromOrderId`'s unprinted kitchen tickets that no printed
 * reprint has covered and that carried one of `lineIds`, which have just moved there off
 * `fromOrderId`, some or all of them, at that line's station. Both bills then show the problem until
 * {@link readPrintProblems} clears it for each. The new links are written as {@link writeLinksAfter}
 * writes them.
 */
export async function copyKitchenPrintLinks(
  tx: Transaction,
  fromOrderId: string,
  toOrderId: string,
  lineIds: readonly string[],
): Promise<void> {
  if (lineIds.length === 0) return;
  const carried = await tx
    .selectDistinct({
      printJobId: kitchenPrintJobLines.printJobId,
      stationId: ticketItems.stationId,
    })
    .from(kitchenPrintJobLines)
    .innerJoin(
      ticketItems,
      eq(ticketItems.workingOrderLineId, kitchenPrintJobLines.workingOrderLineId),
    )
    .where(inArray(kitchenPrintJobLines.workingOrderLineId, [...lineIds]));
  const jobStations = new Set(carried.map((row) => `${row.printJobId}|${row.stationId}`));
  const copies = (await readUncoveredLinks(tx, fromOrderId))
    .filter((row) => row.status !== "done" && jobStations.has(`${row.printJobId}|${row.stationId}`))
    .map(({ printJobId, stationId, createdAt }) => ({ printJobId, stationId, createdAt }));
  await writeLinksAfter(tx, toOrderId, copies);
}

/** Record that every kitchen ticket which carried `fromLineId` carried `toLineId`, split off it. */
export async function copyKitchenJobLines(
  tx: Transaction,
  fromLineId: string,
  toLineId: string,
): Promise<void> {
  const jobs = await tx
    .select({ printJobId: kitchenPrintJobLines.printJobId })
    .from(kitchenPrintJobLines)
    .where(eq(kitchenPrintJobLines.workingOrderLineId, fromLineId));
  if (jobs.length === 0) return;
  await tx
    .insert(kitchenPrintJobLines)
    .values(jobs.map(({ printJobId }) => ({ printJobId, workingOrderLineId: toLineId })));
}

/**
 * The printing problems on a seated party's bills, the bills of every party merged into it
 * included. A party that does not exist is `party.not_open`, as on the other party reads.
 */
export async function listPrintProblems(
  tx: Transaction,
  partyId: string,
  now: Date = new Date(),
): Promise<PrintProblem[]> {
  const [party] = await tx.select({ id: parties.id }).from(parties).where(eq(parties.id, partyId));
  if (party === undefined) throw new AppError("party.not_open", { partyId });
  const family = await partyFamily(tx, partyId);
  return readPrintProblems(tx, inArray(workingOrders.partyId, family), now);
}

/** Which of `orderIds` have a printing problem at `stationId`. */
export async function ordersWithPrintProblem(
  tx: Transaction,
  stationId: string,
  orderIds: readonly string[],
  now: Date,
): Promise<Set<string>> {
  if (orderIds.length === 0) return new Set();
  const problems = await readPrintProblems(
    tx,
    and(
      eq(kitchenPrintJobs.stationId, stationId),
      inArray(kitchenPrintJobs.workingOrderId, [...orderIds]),
    )!,
    now,
  );
  return new Set(problems.map((problem) => problem.workingOrderId));
}
