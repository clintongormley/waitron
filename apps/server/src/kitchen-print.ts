// Kitchen print jobs for fired items, enqueued on the fire's own transaction so they roll back with it.
//
// A printer never blocks a fire (CLAUDE.md §5): `enqueuePrintJob` is an outbox insert that opens no
// socket. Its one throw, `printer.not_found` for an inactive printer, cannot happen here: the mapping
// read keeps active printers only, and no other write transaction can run between that read and the
// enqueue, because one write transaction runs on the venue file at a time (`withTransaction`,
// `packages/db/src/tenancy.ts`). Receipt: `assertExtraListForWrite` in `packages/catalogue/src/extras.ts`.
import { and, eq, inArray, isNotNull, sql } from "drizzle-orm";
import {
  kitchenStations,
  printers,
  stationPrinters,
  ticketItems,
  workingOrderLines,
  workingOrders,
} from "@waitron/db";
import type { Transaction } from "@waitron/db";
import { perDishOptionQuantity, thousandthsToDecimal } from "@waitron/shared";
import { kitchenPresentationName, optionSnapshotLabels } from "@waitron/catalogue";
import { columnsFor, enqueuePrintJob } from "@waitron/printing";
import type { CharacterSet, PaperWidth, PrintConfig } from "@waitron/printing";
import { formatCorrectionSlip, formatKitchenTicket } from "./kitchen-ticket.js";
import { VENUE_SERVICE } from "./modules.js";
import type { KitchenLayout, KitchenTicketItem, KitchenTicketStation } from "./kitchen-ticket.js";
import type { TillConfig } from "./till-config.js";

/**
 * One line that fired in THIS round. The caller captures it from its own write's `RETURNING`, never by
 * re-querying `ticket_items`, which would re-select earlier rounds' items and reprint them.
 */
export interface FiredItem {
  workingOrderLineId: string;
  stationId: string;
  /**
   * The ticket item's fired quantity, as thousandths, printed in place of the line's current
   * quantity. Absent or null prints the line's: a ticket item fired before `ticket_items.quantity`
   * existed carries none.
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
  // `updateUnit` (`packages/catalogue/src/units.ts`) put it through `validateContentTranslations`.
  return Object.values(text)[0]!;
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
 * Each line's printed item, keyed by line id and carrying its `line_no`. The fire and correction paths
 * share it, so a correction slip prints a line exactly as the original ticket did. `lineIds` are
 * parent dish lines; a child modifier line prints as sub-text of its parent.
 */
async function buildTicketItems(
  tx: Transaction,
  cfg: TillConfig,
  lineIds: string[],
): Promise<Map<string, { lineNo: number; item: KitchenTicketItem }>> {
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
    })
    .from(workingOrderLines)
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

  const byLine = new Map<string, { lineNo: number; item: KitchenTicketItem }>();
  for (const row of lineRows) {
    byLine.set(row.id, {
      lineNo: row.lineNo,
      item: {
        qty: row.quantity,
        unit: row.unitName == null ? undefined : ticketName(row.unitName, cfg.locale),
        name: kitchenPresentationName(row),
        note: row.note ?? undefined,
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
 * The order number and dining-table label (null for a walk-up). The outer `working_orders` columns are
 * written as literal qualified names: drizzle renders a `.from()` base table's column inside `sql` as a
 * bare `"id"`, which inside this subquery would bind to `dining_tables.id`.
 */
async function readOrderHeader(
  tx: Transaction,
  cfg: TillConfig,
  orderId: string,
): Promise<{ orderNumber: string; tableLabel: string | null }> {
  const rows = await tx
    .select({
      orderNumber: workingOrders.orderNumber,
      tableLabel: sql<string | null>`(
        select dt.label from dining_tables dt
        where dt.location_id = ${cfg.locationId}
          and (dt.tab_id = working_orders.id or working_orders.delivery_table_id = dt.id)
        order by (dt.tab_id = working_orders.id) desc nulls last, dt.id
        limit 1)`,
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
 * prints a single ticket carrying all their items, not N.
 */
export async function enqueueKitchenTickets(
  tx: Transaction,
  cfg: TillConfig,
  orderId: string,
  firedItems: FiredItem[],
): Promise<void> {
  if (firedItems.length === 0) return;

  const stationIds = [...new Set(firedItems.map((f) => f.stationId))];

  const mappingRows = await activePrinterMappings(tx, stationIds);

  if (mappingRows.length === 0) return;

  const lineIds = [...new Set(firedItems.map((f) => f.workingOrderLineId))];

  const itemsByLine = await buildTicketItems(tx, cfg, lineIds);
  const stationNames = await readStationNames(tx, stationIds);
  const order = await readOrderHeader(tx, cfg, orderId);

  const itemsByStation = new Map<string, { lineNo: number; item: KitchenTicketItem }[]>();
  for (const fired of firedItems) {
    const entry = itemsByLine.get(fired.workingOrderLineId)!;
    const bucket = itemsByStation.get(fired.stationId) ?? [];
    bucket.push({ lineNo: entry.lineNo, item: atFiredQuantity(entry.item, fired) });
    itemsByStation.set(fired.stationId, bucket);
  }

  // Station names are unique per location, so the name alone orders them.
  const stations = [...stationNames.entries()]
    .map(([id, name]) => ({
      id,
      name,
      items: itemsByStation
        .get(id)!
        .sort((a, b) => a.lineNo - b.lineNo)
        .map((entry) => entry.item),
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
        await enqueuePrintJob(tx, printCfg, printer.printerId, stationTicket);
      }
    }
  }

  for (const group of groupByLayout([...groupPrinters.values()])) {
    const consolidated = formatKitchenTicket(
      {
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
      await enqueuePrintJob(tx, printCfg, printer.printerId, consolidated);
    }
  }
}

/** One correction to work a station was sent: the quantity it corrects, and whether the cook had
 *  started it. */
export interface CorrectionItem {
  workingOrderLineId: string;
  stationId: string;
  /** As thousandths: what the station was asked for on a recall or a whole void, and the part
   *  removed on a partial void. */
  quantity: number;
  wasStarted: boolean;
}

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
    items.map((item) => ({
      workingOrderLineId: item.workingOrderLineId,
      stationId: item.stationId,
      quantity: thousandthsToDecimal(item.quantity),
      wasStarted: item.wasStarted,
    })),
    kind === "VOID" ? "void" : "recalled",
  );

  const stationIds = [...new Set(items.map((i) => i.stationId))];
  const mappingRows = await activePrinterMappings(tx, stationIds);
  if (mappingRows.length === 0) return;

  const lineIds = [...new Set(items.map((i) => i.workingOrderLineId))];
  const itemsByLine = await buildTicketItems(tx, cfg, lineIds);
  const stationNames = await readStationNames(tx, stationIds);
  const header = await readOrderHeader(tx, cfg, orderId);

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
    for (const group of groupByLayout(attachedPrinters)) {
      const bytes = formatCorrectionSlip(
        {
          kind,
          stationName: stationNames.get(target.stationId)!,
          tableLabel: header.tableLabel,
          orderNumber: header.orderNumber,
          at,
          item: atFiredQuantity(entry.item, target),
        },
        layoutOf(group[0]!),
      );
      for (const printer of group) {
        await enqueuePrintJob(tx, printCfg, printer.printerId, bytes);
      }
    }
  }
}

/**
 * Reprint an order's kitchen tickets: every fired item across every round (held items excluded), unlike
 * the fire path, which prints only its own round. Each ticket is stamped with the reprint time, not the
 * original fire time. An order with nothing fired is a no-op.
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
  await enqueueKitchenTickets(tx, cfg, orderId, fired);
}
