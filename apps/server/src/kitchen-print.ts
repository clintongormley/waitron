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
  watcherPrinters,
  watchers,
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
import { enqueuePrintJob } from "@waitron/printing";
import type { EscSetting, PaperWidth, PrintConfig, Resolution } from "@waitron/printing";
import {
  arrangeTicketItems,
  crossRefText,
  formatCorrectionSlip,
  formatKitchenTicket,
} from "./kitchen-ticket.js";
import { VENUE_SERVICE } from "./modules.js";
import { printJobInTrouble, printedOrResent } from "./print-job-trouble.js";
import { readRestOfOrder } from "./rest-of-order.js";
import { partyFamilies, partyFamily } from "./parties.js";
import type { KitchenTicketItem, KitchenTicketStation } from "./kitchen-ticket.js";
import type { TillConfig } from "./till-config.js";
import { listWatchers, watcherSees } from "./watchers.js";
import type { WatcherFollows } from "./watchers.js";
import { orderWatchZones } from "./watch-zones.js";
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

/** Display the physical amount for measured extras and the per-dish count for Each extras. */
export function extraLabel(
  name: string,
  quantity: Decimal,
  dishQuantity: Decimal,
  unitName?: string,
): string {
  if (unitName !== undefined) return `${name} ${quantity} ${unitName}`;
  const perDish = perDishOptionQuantity(quantity, dishQuantity);
  return perDish > 1 ? `${name} x${perDish}` : name;
}

interface PrinterMapping {
  stationId: string;
  printerId: string;
  paperWidth: PaperWidth;
  resolution: Resolution;
}

export type WatcherCopies = "all" | "none" | { newSince: string };

interface WatcherPrinter extends EscSetting {
  printerId: string;
  watcherId: string;
  watcherName: string;
  follows: WatcherFollows;
}

async function readWatcherPrinters(tx: Transaction, cfg: TillConfig): Promise<WatcherPrinter[]> {
  const rows = await tx
    .select({
      printerId: watcherPrinters.printerId,
      watcherId: watcherPrinters.watcherId,
      paperWidth: printers.paperWidth,
      resolution: printers.resolution,
    })
    .from(watcherPrinters)
    .innerJoin(printers, eq(printers.id, watcherPrinters.printerId))
    .innerJoin(watchers, eq(watchers.id, watcherPrinters.watcherId))
    .where(
      and(
        eq(watchers.locationId, cfg.locationId),
        eq(watchers.active, true),
        eq(printers.active, true),
      ),
    );
  if (rows.length === 0) return [];
  const followed = new Map((await listWatchers(tx, cfg)).map((watcher) => [watcher.id, watcher]));
  return rows.map((row) => ({
    ...row,
    watcherName: followed.get(row.watcherId)!.name,
    follows: followed.get(row.watcherId)!,
  }));
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
      paperWidth: printers.paperWidth,
      resolution: printers.resolution,
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

/** `printers` grouped by paper width and resolution, in first-seen order: one ticket per group. */
function groupByLayout<T extends EscSetting>(printers: readonly T[]): T[][] {
  const groups = new Map<string, T[]>();
  for (const printer of printers) {
    const key = `${printer.paperWidth}|${printer.resolution}`;
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
 * include parent dish lines and separately prepared extra lines.
 */
async function buildTicketItems(
  tx: Transaction,
  cfg: TillConfig,
  lineIds: string[],
): Promise<Map<string, { lineNo: number; group: number | null; item: KitchenTicketItem }>> {
  // The customer-facing `descriptions` is deliberately not read: the cook's name falls back to the
  // staff name (`kitchenPresentationName`), as on the station screen.
  const parentLine = alias(workingOrderLines, "ticket_parent_line");
  const parentRecord = alias(ticketItems, "ticket_parent_record");
  const parentStation = alias(kitchenStations, "ticket_parent_station");
  const storedLineRows = await tx
    .select({
      id: workingOrderLines.id,
      parentLineId: workingOrderLines.parentLineId,
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
      parentName: parentLine.name,
      parentKitchenName: parentLine.kitchenName,
      parentVariantName: parentLine.variantName,
      parentVariantKitchenName: parentLine.variantKitchenName,
      parentStationName: parentStation.name,
    })
    .from(workingOrderLines)
    .leftJoin(orderGroups, eq(orderGroups.id, workingOrderLines.groupId))
    .leftJoin(parentLine, eq(parentLine.id, workingOrderLines.parentLineId))
    .leftJoin(parentRecord, eq(parentRecord.workingOrderLineId, parentLine.id))
    .leftJoin(parentStation, eq(parentStation.id, parentRecord.stationId))
    .where(inArray(workingOrderLines.id, lineIds));
  const lineRows = storedLineRows.map((row) => ({
    ...row,
    quantity: thousandthsToDecimal(row.quantity),
  }));
  const lineById = new Map(lineRows.map((row) => [row.id, row]));

  // Ordered by `line_no` so the picks print in the order they were offered.
  const childRecord = alias(ticketItems, "ticket_child_record");
  const childStation = alias(kitchenStations, "ticket_child_station");
  const storedChildRows = await tx
    .select({
      id: workingOrderLines.id,
      parentLineId: workingOrderLines.parentLineId,
      lineNo: workingOrderLines.lineNo,
      quantity: workingOrderLines.quantity,
      unitName: workingOrderLines.unitName,
      name: workingOrderLines.name,
      kitchenName: workingOrderLines.kitchenName,
      variantName: workingOrderLines.variantName,
      variantKitchenName: workingOrderLines.variantKitchenName,
      recordId: childRecord.id,
      stationName: childStation.name,
    })
    .from(workingOrderLines)
    .leftJoin(childRecord, eq(childRecord.workingOrderLineId, workingOrderLines.id))
    .leftJoin(childStation, eq(childStation.id, childRecord.stationId))
    .where(inArray(workingOrderLines.parentLineId, lineIds))
    .orderBy(workingOrderLines.lineNo);
  const childRows = storedChildRows.map((row) => ({
    ...row,
    quantity: thousandthsToDecimal(row.quantity),
  }));
  const eachByIdentity = await VENUE_SERVICE.readLinesSoldInEach(tx, [
    ...lineIds,
    ...childRows.map((row) => row.id),
  ]);
  // The per-dish pick count is recovered from the stored combined child quantity. Every child's
  // parent is in `lineById` because children are read by parent id.
  const modifiersByParent = new Map<string, string[]>();
  const crossRefsByParent = new Map<string, string[]>();
  for (const child of childRows) {
    const parent = lineById.get(child.parentLineId!)!;
    const extraUnit =
      child.unitName == null || eachByIdentity.has(child.id)
        ? undefined
        : ticketName(child.unitName, cfg.locale);
    if (child.recordId !== null) {
      const refs = crossRefsByParent.get(child.parentLineId!) ?? [];
      refs.push(
        crossRefText(
          {
            kind: "with",
            name: extraLabel(
              kitchenPresentationName(child),
              child.quantity,
              parent.quantity,
              extraUnit,
            ),
            stationName: child.stationName!,
          },
          cfg.locale,
        ),
      );
      crossRefsByParent.set(child.parentLineId!, refs);
      continue;
    }
    const names = modifiersByParent.get(child.parentLineId!) ?? [];
    names.push(extraLabel(child.name, child.quantity, parent.quantity, extraUnit));
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
        ...(row.parentLineId === null
          ? { crossRefs: crossRefsByParent.get(row.id) ?? [] }
          : {
              crossRefs: [
                crossRefText(
                  {
                    kind: "for",
                    name: kitchenPresentationName({
                      name: row.parentName!,
                      kitchenName: row.parentKitchenName,
                      variantName: row.parentVariantName,
                      variantKitchenName: row.parentVariantKitchenName,
                    }),
                    stationName: row.parentStationName,
                  },
                  cfg.locale,
                ),
              ],
            }),
      },
    });
  }
  return byLine;
}

async function readStations(
  tx: Transaction,
  stationIds: string[],
): Promise<Map<string, { name: string; showsRestOfOrder: boolean }>> {
  const rows = await tx
    .select({
      id: kitchenStations.id,
      name: kitchenStations.name,
      showsRestOfOrder: kitchenStations.showsRestOfOrder,
    })
    .from(kitchenStations)
    .where(inArray(kitchenStations.id, stationIds));
  return new Map(rows.map(({ id, ...station }) => [id, station]));
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
  id: string;
  partyId: string | null;
  deliveryTableId: string | null;
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
      {
        id: order.id,
        partyId: order.partyId,
        deliveryTableId: order.deliveryTableId,
        orderNumber: String(order.orderNumber),
        tableLabel: labels.get(order.id)!,
      },
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

/**
 * A kitchen ticket's printers, all of one layout and each listed by exactly `stationIds` among the
 * send's stations, so they share its bytes.
 */
interface KitchenRoute {
  stationIds: string[];
  printers: PrinterMapping[];
}

/** One kitchen print job: its printer, the stations and lines its paper carries, and its bytes. */
type KitchenJob = Omit<KitchenRoute, "printers"> & {
  printerId: string;
  watcherId?: string;
  lineIds: string[];
  bytes: Uint8Array;
};

/** Each station's printer mappings, in the order of the list they came from. */
type MappingsByStation = ReadonlyMap<string, readonly PrinterMapping[]>;

function mappingsByStation(mappings: readonly PrinterMapping[]): MappingsByStation {
  const byStation = new Map<string, PrinterMapping[]>();
  mappings.forEach((mapping) => {
    const bucket = byStation.get(mapping.stationId) ?? [];
    bucket.push(mapping);
    byStation.set(mapping.stationId, bucket);
  });
  return byStation;
}

/**
 * One ticket per printer: each printer carries the involved stations that list it, in
 * `stationIds`' order. Printers carrying the same stations are grouped by layout, and a group is
 * placed at its first station's turn.
 */
function routeKitchenTickets(
  stationIds: readonly string[],
  mappings: MappingsByStation,
): KitchenRoute[] {
  const carried = new Map<string, { stationIds: string[]; printer: PrinterMapping }>();
  for (const stationId of stationIds) {
    for (const printer of mappings.get(stationId) ?? []) {
      const seen = carried.get(printer.printerId);
      if (seen === undefined) carried.set(printer.printerId, { stationIds: [stationId], printer });
      else seen.stationIds.push(stationId);
    }
  }
  const routes: KitchenRoute[] = [];
  for (const stationId of stationIds) {
    const bySet = new Map<string, { stationIds: string[]; printers: PrinterMapping[] }>();
    for (const { printerId } of mappings.get(stationId) ?? []) {
      const { stationIds: set, printer } = carried.get(printerId)!;
      if (set[0] !== stationId) continue;
      const key = set.join("|");
      const group = bySet.get(key);
      if (group === undefined) bySet.set(key, { stationIds: set, printers: [printer] });
      else group.printers.push(printer);
    }
    for (const { stationIds: set, printers } of bySet.values()) {
      for (const layout of groupByLayout(printers))
        routes.push({ stationIds: set, printers: layout });
    }
  }
  return routes;
}

/**
 * What one printer's whole paper prints of the rest of the order when the paper joins more than one
 * planned ticket: nothing, or the dishes at stations other than `stationIds`.
 */
interface PaperRest {
  stationIds: readonly string[];
  shows: boolean;
}

/** Live station printer assignments and stations already read for a superset of a plan's stations. */
interface KnownStations {
  mappings: readonly PrinterMapping[];
  stations: Awaited<ReturnType<typeof readStations>>;
}

/**
 * The kitchen tickets for a set of just-fired lines, routed by {@link routeKitchenTickets} over the
 * involved stations in name order. A `HOLD` ticket's `firedItems` are the held items printed in
 * advance. A printer in `papers` prints the rest of the order as its entry says, in place of what
 * its route alone would decide.
 */
async function planKitchenTickets(
  tx: Transaction,
  cfg: TillConfig,
  orderId: string,
  firedItems: FiredItem[],
  {
    reprint,
    mark,
    from,
    makers = true,
    watchers: copies = "all",
    rerouted,
    papers,
    known,
  }: {
    reprint: boolean;
    mark?: "HOLD" | "FIRE";
    from?: string;
    makers?: boolean;
    watchers?: WatcherCopies;
    rerouted?: ReadonlyMap<string, { stationId: string; stationName: string }>;
    papers?: ReadonlyMap<string, PaperRest>;
    known?: KnownStations;
  },
): Promise<KitchenJob[]> {
  if (firedItems.length === 0) return [];

  const stationIds = [...new Set(firedItems.map((f) => f.stationId))];

  const mappingRows = !makers
    ? []
    : known === undefined
      ? await printerMappings(tx, stationIds)
      : known.mappings.filter((mapping) => stationIds.includes(mapping.stationId));
  const watcherRows = copies === "none" ? [] : await readWatcherPrinters(tx, cfg);
  if (mappingRows.length === 0 && watcherRows.length === 0) return [];

  const lineIds = [...new Set(firedItems.map((f) => f.workingOrderLineId))];

  const itemsByLine = await buildTicketItems(tx, cfg, lineIds);
  const stationNames =
    known === undefined
      ? await readStations(tx, stationIds)
      : new Map(stationIds.map((id) => [id, known.stations.get(id)!]));
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
    .map(([id, station]) => ({
      id,
      name: station.name,
      showsRestOfOrder: station.showsRestOfOrder,
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
    mappingsByStation(mappingRows),
  );
  // Each printer's rest of the order: null for none, else the stations whose dishes it leaves out.
  const restLeavesOut = new Map<string, readonly string[] | null>();
  for (const route of routes) {
    const shows = route.stationIds.some((id) => stationById.get(id)!.showsRestOfOrder);
    for (const { printerId } of route.printers) {
      const paper = papers?.get(printerId);
      restLeavesOut.set(
        printerId,
        paper === undefined
          ? shows
            ? route.stationIds
            : null
          : paper.shows
            ? paper.stationIds
            : null,
      );
    }
  }
  const anyRest = [...restLeavesOut.values()].some((leavesOut) => leavesOut !== null);
  const rest = anyRest ? (await readRestOfOrder(tx, [orderId])).get(orderId)! : [];
  const eachByIdentity = !anyRest
    ? new Set<string>()
    : await VENUE_SERVICE.readLinesSoldInEach(tx, [
        ...new Set(rest.map((item) => item.workingOrderLineId)),
      ]);
  const head = {
    reprint,
    mark,
    from: from === undefined ? undefined : { stationName: from, locale: cfg.locale },
    tableLabel: order.tableLabel ?? "",
    orderNumber: order.orderNumber,
    firedAt: new Date(),
  };
  for (const route of routes) {
    const onTicket = route.stationIds.map((id) => stationById.get(id)!);
    const render = (leavesOut: readonly string[] | null) =>
      formatKitchenTicket(
        {
          ...head,
          ...(onTicket.length === 1
            ? { scope: "station", stationName: onTicket[0]!.name, items: onTicket[0]!.items }
            : {
                scope: "stations",
                stations: onTicket.map((station) => ({
                  stationName: station.name,
                  items: station.items,
                })),
              }),
          ...(leavesOut !== null
            ? {
                alsoOnOrder: {
                  locale: cfg.locale,
                  items: rest
                    .filter((item) => !leavesOut.includes(item.stationId))
                    .map((item) => ({
                      qty: item.quantity,
                      unit:
                        item.unitName === null || eachByIdentity.has(item.workingOrderLineId)
                          ? undefined
                          : ticketName(item.unitName, cfg.locale),
                      name: item.name,
                      stationName: item.stationName,
                      held: item.held,
                    })),
                },
              }
            : {}),
        },
        route.printers[0]!,
      );
    const bytesByRest = new Map<string, Uint8Array>();
    const lineIds = [
      ...new Set(
        firedItems
          .filter((fired) => route.stationIds.includes(fired.stationId))
          .map((fired) => fired.workingOrderLineId),
      ),
    ];
    for (const printer of route.printers) {
      const leavesOut = restLeavesOut.get(printer.printerId)!;
      const key = leavesOut === null ? "" : [...leavesOut].sort().join("|");
      let bytes = bytesByRest.get(key);
      if (bytes === undefined) {
        bytes = render(leavesOut);
        bytesByRest.set(key, bytes);
      }
      jobs.push({
        printerId: printer.printerId,
        stationIds: route.stationIds,
        lineIds,
        bytes,
      });
    }
  }
  if (watcherRows.length > 0) {
    const printable = await withoutMadeHere(tx, firedItems);
    const zoneId = (await orderWatchZones(tx, cfg, [order])).get(orderId) ?? null;
    const byWatcher = new Map<string, WatcherPrinter[]>();
    for (const printer of watcherRows) {
      const group = byWatcher.get(printer.watcherId) ?? [];
      group.push(printer);
      byWatcher.set(printer.watcherId, group);
    }
    for (const printers of [...byWatcher.values()].sort((a, b) =>
      a[0]!.watcherName.localeCompare(b[0]!.watcherName),
    )) {
      const watcher = printers[0]!;
      if (
        typeof copies === "object" &&
        watcherSees(watcher.follows, { stationId: copies.newSince, zoneId })
      )
        continue;
      const seen = stations.filter((station) =>
        watcherSees(watcher.follows, { stationId: station.id, zoneId }),
      );
      if (seen.length === 0) continue;
      const sections = new Map<string | null, FiredItem[]>();
      for (const fired of printable) {
        if (!seen.some((station) => station.id === fired.stationId)) continue;
        const previous = rerouted?.get(fired.workingOrderLineId);
        const from =
          previous !== undefined &&
          !watcherSees(watcher.follows, { stationId: previous.stationId, zoneId })
            ? previous.stationName
            : null;
        sections.set(from, [...(sections.get(from) ?? []), fired]);
      }
      for (const [from, sectionItems] of sections) {
        const sectionStations = seen.filter((station) =>
          sectionItems.some((item) => item.stationId === station.id),
        );
        const stationTicketSections = sectionStations.map((station): KitchenTicketStation => ({
          stationName: station.name,
          items: arrangeTicketItems(
            sectionItems
              .filter((item) => item.stationId === station.id)
              .map((item) => {
                const entry = itemsByLine.get(item.workingOrderLineId)!;
                const printed = atFiredQuantity(entry.item, item);
                return {
                  lineNo: entry.lineNo,
                  item: entry.group === null ? printed : { ...printed, group: entry.group },
                };
              })
              .sort((a, b) => groupOrder(a.item) - groupOrder(b.item) || a.lineNo - b.lineNo)
              .map((entry) => entry.item),
            grouping,
          ),
        }));
        const lineIds = [...new Set(sectionItems.map((item) => item.workingOrderLineId))];
        for (const layout of groupByLayout(printers)) {
          const bytes = formatKitchenTicket(
            {
              ...head,
              mark: from === null ? mark : undefined,
              from: from === null ? head.from : { stationName: from, locale: cfg.locale },
              scope: "watcher",
              watcherName: watcher.watcherName,
              stations: stationTicketSections,
            },
            layout[0]!,
          );
          for (const printer of layout)
            jobs.push({
              printerId: printer.printerId,
              watcherId: watcher.watcherId,
              stationIds: [],
              lineIds,
              bytes,
            });
        }
      }
    }
  }
  return jobs;
}

/** Enqueue each job; only station tickets receive bill, station and line links. */
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
    if (job.watcherId !== undefined) continue;
    await linkKitchenJob(tx, jobId, orderId, job.stationIds, reprint);
    await tx
      .insert(kitchenPrintJobLines)
      .values(job.lineIds.map((workingOrderLineId) => ({ printJobId: jobId, workingOrderLineId })));
  }
}

/**
 * Enqueue the kitchen tickets for a set of just-fired lines ({@link planKitchenTickets}). Station
 * jobs receive bill, station and line links. Answers whether any job was enqueued.
 */
export async function enqueueKitchenTickets(
  tx: Transaction,
  cfg: TillConfig,
  orderId: string,
  firedItems: FiredItem[],
  {
    mark,
    from,
    watchers,
  }: { mark?: "HOLD" | "FIRE"; from?: string; watchers?: WatcherCopies } = {},
): Promise<boolean> {
  const jobs = await planKitchenTickets(tx, cfg, orderId, firedItems, {
    reprint: false,
    mark,
    from,
    watchers,
  });
  await enqueueKitchenJobs(tx, cfg, orderId, jobs, false);
  return jobs.length > 0;
}

export async function enqueueWatcherCopies(
  tx: Transaction,
  cfg: TillConfig,
  orderId: string,
  items: FiredItem[],
  options: {
    mark?: "HOLD" | "FIRE";
    rerouted?: ReadonlyMap<string, { stationId: string; stationName: string }>;
  } = {},
): Promise<boolean> {
  const jobs = await planKitchenTickets(tx, cfg, orderId, items, {
    reprint: false,
    makers: false,
    watchers: "all",
    ...options,
  });
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
  | { kind: "TO STATION"; toStation: string; locale: string }
  | { kind: "EXTRA CANCELLED"; held: boolean; cancelledExtra: string; locale: string }
  | HoldCorrection;

/** A change to held work on a queued HOLD ticket: quantity `added` or `removed`, or cancelled. */
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
 * Record a kitchen notice per item for a RECALL ({@link recallLines}) or VOID ({@link removeFromLine})
 * of a line that had already fired, then enqueue a correction slip per item for its station and
 * watchers; callers pass only fired lines. The notice is recorded whether or not a printer exists,
 * so a station screen sees every correction. Each slip prints the item through
 * {@link buildTicketItems}, at the item's quantity. The header's never-block argument applies unchanged.
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
  items = await withoutMadeHere(tx, items);
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

/** Record a reroute and correct the paper at the item's old station before its station changes. */
export async function enqueueStationMoved(
  tx: Transaction,
  cfg: TillConfig,
  orderId: string,
  items: CorrectionItem[],
  toStationName: string,
  toStationId: string,
): Promise<void> {
  if (items.length === 0) return;
  await VENUE_SERVICE.recordKitchenNotices(
    tx,
    cfg,
    orderId,
    items.map(toNoticeItem),
    "rerouted",
    null,
    null,
    null,
    toStationName,
  );
  const fired = items.filter((item) => item.group === undefined);
  const held = items.filter((item) => item.group !== undefined);
  if (fired.length > 0)
    await printCorrectionSlips(
      tx,
      cfg,
      orderId,
      fired,
      {
        kind: "TO STATION",
        toStation: toStationName,
        locale: cfg.locale,
      },
      undefined,
      { kind: "followed_until", toStationId },
    );
  if (held.length > 0)
    await printCorrectionSlips(tx, cfg, orderId, held, { kind: "HOLD CANCELLED" }, undefined, {
      kind: "followed_until",
      toStationId,
    });
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
  items = await withoutMadeHere(tx, items);
  if (items.length === 0) return;
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
  locale: string,
): Promise<CancelledExtra> {
  const extra = alias(workingOrderLines, "extra");
  const [row] = await tx
    .select({
      name: extra.name,
      quantity: extra.quantity,
      unitName: extra.unitName,
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
  const soldInEach = (await VENUE_SERVICE.readLinesSoldInEach(tx, [extraLineId])).has(extraLineId);
  return {
    label: extraLabel(
      found.name,
      thousandthsToDecimal(found.quantity),
      thousandthsToDecimal(found.dishQuantity),
      found.unitName === null || soldInEach ? undefined : ticketName(found.unitName, locale),
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
  if ((await withoutMadeHere(tx, [item])).length === 0) return;
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

type WatcherSlipRule =
  | { kind: "follows" }
  | { kind: "followed_in"; zoneIds: readonly (string | null)[] }
  | { kind: "followed_until"; toStationId: string };

/** One slip per item, to its station and eligible watcher printers, headed with the current table. */
async function printCorrectionSlips(
  tx: Transaction,
  cfg: TillConfig,
  orderId: string,
  items: CorrectionItem[],
  change: CorrectionChange,
  knownHeader?: OrderHeader,
  watchers: WatcherSlipRule = { kind: "follows" },
): Promise<void> {
  const stationIds = [...new Set(items.map((i) => i.stationId))];
  const mappingRows = await printerMappings(tx, stationIds);
  const watcherRows = await readWatcherPrinters(tx, cfg);
  if (mappingRows.length === 0 && watcherRows.length === 0) return;

  const lineIds = [...new Set(items.map((i) => i.workingOrderLineId))];
  const itemsByLine = await buildTicketItems(tx, cfg, lineIds);
  const stationNames = await readStations(tx, stationIds);
  const header = knownHeader ?? (await readOrderHeader(tx, cfg, orderId));
  const watcherItems = watcherRows.length === 0 ? [] : await withoutMadeHere(tx, items);
  const zoneId =
    watcherRows.length === 0 || watchers.kind === "followed_in"
      ? null
      : ((await orderWatchZones(tx, cfg, [header])).get(orderId) ?? null);
  const watcherLineIds = new Set(watcherItems.map((item) => item.workingOrderLineId));

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

  const printCfg: PrintConfig = { locationId: cfg.locationId };
  const at = new Date().toISOString();

  for (const target of items) {
    const attachedPrinters = printersByStation.get(target.stationId);
    const watcherPrinters = watcherLineIds.has(target.workingOrderLineId)
      ? watcherRows.filter((printer) => {
          const sees = (stationId: string, zone: string | null) =>
            watcherSees(printer.follows, { stationId, zoneId: zone });
          switch (watchers.kind) {
            case "follows":
              return sees(target.stationId, zoneId);
            case "followed_in":
              return watchers.zoneIds.some((zone) => sees(target.stationId, zone));
            case "followed_until":
              return sees(target.stationId, zoneId) && !sees(watchers.toStationId, zoneId);
          }
        })
      : [];
    const targets = [...(attachedPrinters ?? []), ...watcherPrinters];
    if (targets.length === 0) continue;
    const entry = itemsByLine.get(target.workingOrderLineId)!;
    const item = atFiredQuantity(entry.item, target);
    for (const group of groupByLayout(targets)) {
      const bytes = formatCorrectionSlip(
        {
          ...change,
          stationName: stationNames.get(target.stationId)!.name,
          tableLabel: header.tableLabel,
          orderNumber: header.orderNumber,
          at,
          item: target.group === undefined ? item : { ...item, group: target.group },
        },
        group[0]!,
      );
      for (const printer of group) {
        await enqueuePrintJob(tx, printCfg, printer.printerId, bytes);
      }
    }
  }
}

/** An order's fired kitchen work and its table, order number and pre-move zone. */
export interface SentWork {
  tableLabel: string | null;
  orderNumber: string;
  ticketItemIds: ReadonlySet<string>;
  zoneId: string | null;
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
  if (fired.length === 0)
    return { tableLabel: null, orderNumber: "", ticketItemIds: new Set(), zoneId: null };
  const header = await readOrderHeader(tx, cfg, orderId);
  const zoneId =
    (await readWatcherPrinters(tx, cfg)).length === 0
      ? null
      : ((await orderWatchZones(tx, cfg, [header])).get(orderId) ?? null);
  return {
    ...header,
    ticketItemIds: new Set(fired.map((row) => row.id)),
    zoneId,
  };
}

/**
 * Tell the kitchen of sent work that moved to another table. When the table a correction slip names
 * for `toOrderId` now differs from the one `before` read, each of `before`'s fired items now on
 * `toOrderId` gets a `moved` notice, at the quantity its ticket asks for, and a MOVED slip where its
 * station or a watcher has an active printer. `splitFrom` maps a ticket item a split made to the one it copied.
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
  madeHere: boolean;
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
      madeHere: ticketItems.madeHere,
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
    .filter((item) => !item.madeHere && before.ticketItemIds.has(splitFrom.get(item.id) ?? item.id))
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
    {
      kind: "followed_in",
      zoneIds: [
        before.zoneId,
        ...((await readWatcherPrinters(tx, cfg)).length === 0
          ? []
          : [(await orderWatchZones(tx, cfg, [header])).get(toOrderId) ?? null]),
      ],
    },
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
  const zones =
    (await readWatcherPrinters(tx, cfg)).length === 0
      ? new Map<string, string | null>()
      : await orderWatchZones(
          tx,
          cfg,
          [...sent.values()].map(({ bill }) => bill),
        );
  for (const { bill, fired } of sent.values()) {
    work.set(bill.id, {
      tableLabel: labels.get(bill.id)!,
      orderNumber: String(bill.orderNumber),
      ticketItemIds: fired,
      zoneId: zones.get(bill.id) ?? null,
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
}

/**
 * What a Reprint of each of `orderIds` prints: every fired item across every round, and the held
 * items of each still-held group whose HOLD ticket was queued, marked HOLD.
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
    .where(
      and(
        inArray(ticketItems.workingOrderId, [...orderIds]),
        isNotNull(ticketItems.firedAt),
        eq(ticketItems.madeHere, false),
      ),
    );
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
      const parts = [{ items: firedItems }, { items: heldItems, mark: "HOLD" }] as const;
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
      for (const route of routeKitchenTickets(involved, mappings)) {
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
 * stamped with the reprint time, not the original fire time. Fired and HOLD sections for one
 * printer go as one job, linked to every station either carries, whatever stations each covers;
 * for a station printer, separate jobs could clear an earlier failure for dishes the later section
 * does not carry ({@link readPrintProblems}). It changes no line, ticket item or group event. An
 * order with nothing to print is a no-op.
 */
export async function reprintOrderTickets(
  tx: Transaction,
  cfg: TillConfig,
  orderId: string,
): Promise<void> {
  const [fired, held] = (await readReprintParts(tx, [orderId])).get(orderId)!;
  const firedStations = new Set(fired.items.map((item) => item.stationId));
  const heldStations = new Set(held.items.map((item) => item.stationId));
  const stationIds = [...new Set([...firedStations, ...heldStations])];
  if (stationIds.length === 0) return;
  const known: KnownStations = {
    mappings: await printerMappings(tx, stationIds),
    stations: await readStations(tx, stationIds),
  };
  const papers = joinedPapers(firedStations, heldStations, known);
  const jobs = await planKitchenTickets(tx, cfg, orderId, fired.items, {
    reprint: true,
    watchers: "all",
    papers,
    known,
  });
  const holdJobs = await planKitchenTickets(tx, cfg, orderId, held.items, {
    reprint: true,
    mark: held.mark,
    watchers: "all",
    known,
    papers: new Map(
      [...papers].map(([printerId, paper]) => [printerId, { ...paper, shows: false }]),
    ),
  });
  for (const hold of holdJobs) {
    const same = jobs.find(
      (job) => job.printerId === hold.printerId && job.watcherId === hold.watcherId,
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

/**
 * Each station printer a reprint gives both fired and held work, as one paper: the rest of the order
 * prints once, on its fired part, and lists dishes at stations on neither part. It prints when a
 * station of the fired part shows it, or a station of the held part does and no held station there
 * has fired work (decisions 3 and 5).
 */
function joinedPapers(
  firedStations: ReadonlySet<string>,
  heldStations: ReadonlySet<string>,
  { mappings, stations }: KnownStations,
): Map<string, PaperRest> {
  const papers = new Map<string, PaperRest>();
  if (firedStations.size === 0 || heldStations.size === 0) return papers;
  const shows = (id: string) => stations.get(id)!.showsRestOfOrder;
  const byPrinter = new Map<string, { fired: string[]; held: string[] }>();
  for (const { printerId, stationId } of mappings) {
    const paper = byPrinter.get(printerId) ?? { fired: [], held: [] };
    if (firedStations.has(stationId)) paper.fired.push(stationId);
    if (heldStations.has(stationId)) paper.held.push(stationId);
    byPrinter.set(printerId, paper);
  }
  for (const [printerId, { fired, held }] of byPrinter) {
    if (fired.length === 0 || held.length === 0) continue;
    papers.set(printerId, {
      stationIds: [...new Set([...fired, ...held])],
      shows: fired.some(shows) || (held.some(shows) && !held.some((id) => firedStations.has(id))),
    });
  }
  return papers;
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
 * bill and station, on the same printer, queued after it has printed, itself or through a resend
 * ({@link printedOrResent}): only a reprint carries every dish still fired on the bill, and the
 * held dishes of each still-held group whose HOLD ticket was queued, so a later round's ticket
 * printing clears nothing, and another printer's paper says nothing of this one's. It is no problem
 * either once a Reprint of the bill would link nothing on that printer to that station, were the
 * printer switched on ({@link readReprintTargets}), as when its dishes there are voided or the
 * printer is detached from the station.
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
        or(troubled, and(eq(kitchenPrintJobs.reprint, true), printedOrResent(printJobs))),
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
 * `orderId`'s link rows that no reprint for the same station, on the same printer, queued after
 * them and printed itself or through a resend ({@link printedOrResent}), has covered: the ones still
 * able to name a missing dish. Oldest first.
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
      printed: sql<number>`${printedOrResent(printJobs)}`,
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
    if (row.reprint && row.printed) lastReprinted.set(printerKey(row), row.queued);
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
  return (await stationOrdersWithPrintProblem(tx, [stationId], orderIds, now)).get(stationId)!;
}

/** For each of `stationIds`, which of `orderIds` have a printing problem there. */
export async function stationOrdersWithPrintProblem(
  tx: Transaction,
  stationIds: readonly string[],
  orderIds: readonly string[],
  now: Date,
): Promise<Map<string, Set<string>>> {
  const found = new Map(stationIds.map((id) => [id, new Set<string>()]));
  if (stationIds.length === 0 || orderIds.length === 0) return found;
  const problems = await readPrintProblems(
    tx,
    and(
      inArray(kitchenPrintJobs.stationId, [...stationIds]),
      inArray(kitchenPrintJobs.workingOrderId, [...orderIds]),
    )!,
    now,
  );
  for (const problem of problems) found.get(problem.stationId)!.add(problem.workingOrderId);
  return found;
}
