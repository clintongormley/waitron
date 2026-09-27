// Kitchen print jobs for fired items, and HOLD tickets and HOLD corrections for held work, each
// enqueued on its caller's transaction so it rolls back with it.
//
// A printer never blocks a fire (CLAUDE.md §5): `enqueuePrintJob` is an outbox insert that opens no
// socket. Its one throw, `printer.not_found` for an inactive printer, cannot happen here: the mapping
// read keeps active printers only, and no other write transaction can run between that read and the
// enqueue, because one write transaction runs on the venue file at a time (`withTransaction`,
// `packages/db/src/tenancy.ts`). Receipt: `assertExtraListForWrite` in `packages/catalogue/src/extras.ts`.
import { and, eq, inArray, isNotNull, ne, or, sql } from "drizzle-orm";
import type { SQL } from "drizzle-orm";
import {
  kitchenPrintJobs,
  kitchenStations,
  orderGroups,
  printJobs,
  printers,
  stationPrinters,
  ticketItems,
  ticketState,
  visits,
  workingOrderLines,
  workingOrders,
} from "@waitron/db";
import type { Transaction } from "@waitron/db";
import { AppError, perDishOptionQuantity, thousandthsToDecimal } from "@waitron/shared";
import { EACH_UNIT, kitchenPresentationName, optionSnapshotLabels } from "@waitron/catalogue";
import { columnsFor, enqueuePrintJob } from "@waitron/printing";
import type { CharacterSet, PaperWidth, PrintConfig } from "@waitron/printing";
import { arrangeTicketItems, formatCorrectionSlip, formatKitchenTicket } from "./kitchen-ticket.js";
import { VENUE_SERVICE } from "./modules.js";
import { printJobInTrouble } from "./print-job-trouble.js";
import { visitFamily } from "./visits.js";
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
 * Whether a line was sold in Each, the one unit known to count pieces. A product with no stored unit
 * sells in Each and its line freezes Each's abbreviations; every stored unit is either a measure
 * (the seeded g, kg, mg, ml and l) or one whose kind nothing records. A line older than the unit
 * snapshot carries none.
 */
function soldInEach(unitName: Record<string, string> | null): boolean {
  if (unitName === null) return true;
  const each: Record<string, string> = EACH_UNIT.abbreviation;
  const locales = Object.keys(unitName);
  return (
    locales.length === Object.keys(each).length &&
    locales.every((locale) => unitName[locale] === each[locale])
  );
}

/**
 * The station→printer mappings for `stationIds`, ACTIVE printers only. The fire and correction paths
 * both resolve printers here, so the header's never-block argument covers both.
 */
async function activePrinterMappings(
  tx: Transaction,
  stationIds: string[],
): Promise<
  {
    stationId: string;
    printerId: string;
    ticketScope: "station" | "order";
    paperWidth: PaperWidth;
    characterSet: CharacterSet;
    characterTable: number;
  }[]
> {
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
    .where(and(inArray(stationPrinters.stationId, stationIds), eq(printers.active, true)));
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
 * party's group it is in (null in none). The fire and correction paths share it, so a correction
 * slip prints a line exactly as the original ticket did. `lineIds` are parent dish lines; a child
 * modifier line prints as sub-text of its parent.
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
    const perDish = perDishOptionQuantity(child.quantity, parent.quantity);
    // An extras sub-line prints the staff name the child line froze — the picked product's own.
    const name = child.name;
    const label = perDish > 1 ? `${name} x${perDish}` : name;
    const names = modifiersByParent.get(child.parentLineId!) ?? [];
    names.push(label);
    modifiersByParent.set(child.parentLineId!, names);
  }

  const byLine = new Map<
    string,
    { lineNo: number; group: number | null; item: KitchenTicketItem }
  >();
  for (const row of lineRows) {
    byLine.set(row.id, {
      lineNo: row.lineNo,
      group: row.group,
      item: {
        qty: row.quantity,
        unit: row.unitName == null ? undefined : ticketName(row.unitName, cfg.locale),
        name: kitchenPresentationName(row),
        note: row.note ?? undefined,
        ...(soldInEach(row.unitName) ? {} : { measured: true }),
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

/**
 * The order number and dining-table label, else the order's own label: a check split off a tab has no
 * table and carries the tab's table label as its own (`splitOffCheck`). Null for an unlabelled
 * walk-up. The outer `working_orders` columns are written as literal qualified names: drizzle renders
 * a `.from()` base table's column inside `sql` as a bare `"id"`, which inside this subquery would bind
 * to `dining_tables.id`.
 */
async function readOrderHeader(
  tx: Transaction,
  cfg: TillConfig,
  orderId: string,
): Promise<{ orderNumber: string; tableLabel: string | null }> {
  const rows = await tx
    .select({
      orderNumber: workingOrders.orderNumber,
      tableLabel: sql<string | null>`coalesce((
        select dt.label from dining_tables dt
        where dt.location_id = ${cfg.locationId}
          and (dt.tab_id = working_orders.id or working_orders.delivery_table_id = dt.id)
        order by (dt.tab_id = working_orders.id) desc nulls last, dt.id
        limit 1), working_orders.label)`,
    })
    .from(workingOrders)
    .where(eq(workingOrders.id, orderId));
  const order = rows[0]!;
  return { orderNumber: String(order.orderNumber), tableLabel: order.tableLabel };
}

/**
 * Enqueue the kitchen tickets for a set of just-fired lines. For each INVOLVED station (one with ≥1 fired line), each attached `station`-scope printer gets a
 * ticket of that station's own items; every attached `order`-scope (group) printer gets ONE consolidated
 * ticket of the WHOLE event — deduped by printer id, so a group printer attached to N involved stations
 * prints a single ticket carrying all their items, not N. Each job is linked to the bill and to every
 * station its ticket carries (`kitchen_print_jobs`), except a `HOLD` ticket's: only fired work can be
 * reprinted, so a failed HOLD ticket linked there would be a printing problem nothing clears.
 * `firedItems` are then the held items printed in advance. Answers whether any job was enqueued.
 */
export async function enqueueKitchenTickets(
  tx: Transaction,
  cfg: TillConfig,
  orderId: string,
  firedItems: FiredItem[],
  { reprint = false, mark }: { reprint?: boolean; mark?: "HOLD" | "FIRE" } = {},
): Promise<boolean> {
  if (firedItems.length === 0) return false;

  const stationIds = [...new Set(firedItems.map((f) => f.stationId))];

  const mappingRows = await activePrinterMappings(tx, stationIds);

  if (mappingRows.length === 0) return false;
  const link = mark !== "HOLD";

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

  interface AttachedPrinter extends KitchenPrinterLayout {
    printerId: string;
    ticketScope: "station" | "order";
  }
  const printersByStation = new Map<string, AttachedPrinter[]>();
  for (const mapping of mappingRows) {
    const bucket = printersByStation.get(mapping.stationId) ?? [];
    bucket.push({
      printerId: mapping.printerId,
      ticketScope: mapping.ticketScope,
      paperWidth: mapping.paperWidth,
      characterSet: mapping.characterSet,
      characterTable: mapping.characterTable,
    });
    printersByStation.set(mapping.stationId, bucket);
  }

  const printCfg: PrintConfig = { locationId: cfg.locationId };
  const firedAt = new Date();
  const tableLabel = order.tableLabel ?? "";
  const orderNumber = order.orderNumber;

  const groupPrinters = new Map<string, AttachedPrinter>();
  for (const station of stations) {
    const attached = printersByStation.get(station.id) ?? [];
    for (const printer of attached) {
      if (printer.ticketScope === "order") groupPrinters.set(printer.printerId, printer);
    }
    const stationScope = attached.filter((printer) => printer.ticketScope === "station");
    for (const group of groupByLayout(stationScope)) {
      const stationTicket = formatKitchenTicket(
        {
          reprint,
          mark,
          scope: "station",
          stationName: station.name,
          tableLabel,
          orderNumber,
          firedAt,
          items: station.items,
        },
        layoutOf(group[0]!),
      );
      for (const printer of group) {
        const { jobId } = await enqueuePrintJob(tx, printCfg, printer.printerId, stationTicket);
        if (link) await linkKitchenJob(tx, jobId, orderId, [station.id], reprint);
      }
    }
  }

  for (const group of groupByLayout([...groupPrinters.values()])) {
    const consolidated = formatKitchenTicket(
      {
        reprint,
        mark,
        scope: "order",
        tableLabel,
        orderNumber,
        firedAt,
        stations: stations.map((station): KitchenTicketStation => ({
          stationName: station.name,
          items: station.items,
        })),
      },
      layoutOf(group[0]!),
    );
    for (const printer of group) {
      const { jobId } = await enqueuePrintJob(tx, printCfg, printer.printerId, consolidated);
      if (!link) continue;
      await linkKitchenJob(
        tx,
        jobId,
        orderId,
        stations.map((station) => station.id),
        reprint,
      );
    }
  }
  return true;
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

/** One correction to work a station was sent: the quantity it corrects, and whether the cook had
 *  started it. */
export interface CorrectionItem {
  workingOrderLineId: string;
  stationId: string;
  /** As thousandths: what the station was asked for on a recall or a whole void, and the part
   *  removed on a partial void. */
  quantity: number;
  wasStarted: boolean;
  /** On a HOLD correction, the position of the group whose HOLD ticket it corrects. */
  group?: number;
}

/** What a correction slip says happened; the slip's header and its sign follow from it. */
type CorrectionChange =
  | { kind: "VOID" | "RECALLED" }
  | { kind: "MOVED"; movedFrom: { tableLabel: string | null; orderNumber: string } }
  | HoldCorrection;

/** A change to held work a HOLD ticket printed: its quantity `added` or `removed`, or cancelled. */
export type HoldCorrection =
  { kind: "HOLD CHANGED"; direction: "added" | "removed" } | { kind: "HOLD CANCELLED" };

/**
 * Record a kitchen notice per item for a RECALL ({@link recallLines}) or VOID ({@link voidTabLine})
 * of a line that had already fired, then enqueue a correction slip per item where its station has
 * an active printer; callers pass only fired lines. The notice is recorded whether or not a printer
 * exists, so a station screen sees every correction. Each slip goes to every active printer on the
 * line's station, whatever its scope, and prints the item as the original ticket did, at the item's
 * quantity. The header's never-block argument applies unchanged.
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
 * Record a kitchen notice per item for a change to held work its HOLD ticket printed — `changed`
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
  knownHeader?: { orderNumber: string; tableLabel: string | null },
): Promise<void> {
  const stationIds = [...new Set(items.map((i) => i.stationId))];
  const mappingRows = await activePrinterMappings(tx, stationIds);
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

/** Read before a path moves an order's lines, or the order itself, to another table. */
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
 */
export async function enqueueMovedSlips(
  tx: Transaction,
  cfg: TillConfig,
  before: SentWork,
  toOrderId: string,
  splitFrom: ReadonlyMap<string, string> = new Map(),
): Promise<void> {
  if (before.ticketItemIds.size === 0) return;
  const header = await readOrderHeader(tx, cfg, toOrderId);
  if (header.tableLabel === before.tableLabel) return;

  const fired = await tx
    .select({
      id: ticketItems.id,
      workingOrderLineId: ticketItems.workingOrderLineId,
      stationId: ticketItems.stationId,
      state: ticketItems.state,
      quantity: firedQuantity,
    })
    .from(ticketItems)
    .innerJoin(workingOrderLines, eq(workingOrderLines.id, ticketItems.workingOrderLineId))
    .where(eq(ticketItems.workingOrderId, toOrderId))
    .orderBy(workingOrderLines.lineNo);
  const moved: CorrectionItem[] = fired
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
 * Reprint an order's kitchen tickets: every fired item across every round (held items excluded), unlike
 * the fire path, which prints only its own round. Each ticket is marked REPRINT and stamped with the
 * reprint time, not the original fire time. It changes no line, ticket item or group event. An order
 * with nothing fired is a no-op.
 */
export async function reprintOrderTickets(
  tx: Transaction,
  cfg: TillConfig,
  orderId: string,
): Promise<void> {
  const fired = await tx
    .select({
      workingOrderLineId: ticketItems.workingOrderLineId,
      stationId: ticketItems.stationId,
      quantity: ticketItems.quantity,
    })
    .from(ticketItems)
    .where(and(eq(ticketItems.workingOrderId, orderId), isNotNull(ticketItems.firedAt)));
  await enqueueKitchenTickets(tx, cfg, orderId, fired, { reprint: true });
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
 * dish fired before it, so a later round's ticket printing clears nothing, and another printer's
 * paper says nothing of this one's. "After" is the link row's `rowid`, not `created_at`, which two
 * jobs can share to the millisecond: SQLite gives a new row one more than the table's largest
 * `rowid`, and a link row goes only when its job or its bill is deleted, or when
 * {@link moveKitchenPrintLinks} writes it again. Oldest first.
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
  const problems = new Map<string, PrintProblem>();
  for (const row of rows) {
    if (!row.troubled) continue;
    const reprinted = lastReprinted.get(printerKey(row));
    if (reprinted !== undefined && reprinted > row.queued) continue;
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
 * Carry `fromOrderId`'s kitchen tickets onto `intoOrderId` when its dishes move there whole. A
 * ticket a printed reprint already covered stays behind with its reprint, since nothing is left
 * missing. The rest are written again, oldest first, so they come after every reprint `intoOrderId`
 * made before this move, which never carried these dishes; and none of them counts as a reprint, as
 * none carried `intoOrderId`'s own dishes.
 */
export async function moveKitchenPrintLinks(
  tx: Transaction,
  fromOrderId: string,
  intoOrderId: string,
): Promise<void> {
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
    .where(eq(kitchenPrintJobs.workingOrderId, fromOrderId))
    .orderBy(sql`${kitchenPrintJobs}.rowid`);

  const printerKey = (row: { stationId: string; printerId: string }) =>
    `${row.stationId}|${row.printerId}`;
  const lastReprinted = new Map<string, number>();
  for (const row of rows) {
    if (row.reprint && row.status === "done") lastReprinted.set(printerKey(row), row.queued);
  }
  const moving = rows.filter((row) => row.queued > (lastReprinted.get(printerKey(row)) ?? 0));
  if (moving.length === 0) return;

  await tx.delete(kitchenPrintJobs).where(
    inArray(
      kitchenPrintJobs.id,
      moving.map((row) => row.id),
    ),
  );
  await tx.insert(kitchenPrintJobs).values(
    moving.map((row) => ({
      id: row.id,
      printJobId: row.printJobId,
      workingOrderId: intoOrderId,
      stationId: row.stationId,
      reprint: false,
      createdAt: row.createdAt,
    })),
  );
}

/**
 * The printing problems on a seated party's bills, the bills of every party merged into it
 * included. A visit that does not exist is `visit.not_open`, as on the other visit reads.
 */
export async function listPrintProblems(
  tx: Transaction,
  visitId: string,
  now: Date = new Date(),
): Promise<PrintProblem[]> {
  const [visit] = await tx.select({ id: visits.id }).from(visits).where(eq(visits.id, visitId));
  if (visit === undefined) throw new AppError("visit.not_open", { visitId });
  const family = await visitFamily(tx, visitId);
  return readPrintProblems(tx, inArray(workingOrders.visitId, family), now);
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
