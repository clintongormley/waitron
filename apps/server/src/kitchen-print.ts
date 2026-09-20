import { optionSnapshotLabels } from "./option-snapshot-labels.js";
// KDS-4 print-on-fire (design §3c) — the DB-facing half that turns a freshly-fired set of ticket items
// into kitchen print jobs. It lives OUTSIDE working-order.ts so that (already large) module gains only a
// call, not the whole routing/formatting body. Called from inside `fireLines`/`fireCourse` on the
// caller's transaction, AFTER the fire has written its `ticket_items` — so every fire path prints
// (design §3b) and the enqueue rides the SAME tx (it rolls back with the fire; no second round trip).
//
// NEVER-BLOCK (CLAUDE.md §5): enqueue is a pure outbox INSERT (`enqueuePrintJob`) — it opens no socket
// and waits on no hardware — so a slow, broken, or absent printer can never delay a fire. The ONE way
// `enqueuePrintJob` could abort the enclosing fire tx is its `printer.not_found` throw for a
// missing/inactive printer, and TWO guards together make that unreachable so the enqueue can stay INSIDE
// the fire tx (atomic with the fire) without a swallow:
//   1. The mapping query below pre-filters to `printers.active = true`, so a printer already deactivated
//      when the read runs is filtered out — not enqueued, so its id never reaches `enqueuePrintJob`.
//   2. That same read takes a `FOR SHARE` row lock on the mapped `printers` rows, so a printer active AT
//      the read cannot be deactivated until this fire tx commits: a concurrent `deactivatePrinter` UPDATE
//      needs a conflicting row lock and BLOCKS until commit. Without this lock the fire runs at READ
//      COMMITTED and `enqueuePrintJob`'s OWN `active = true` re-check reads a FRESH snapshot, so a
//      deactivation committing between the two reads would flip `active` to false and throw
//      `printer.not_found`, aborting the fire (a §5 never-block violation). Proven by the two-connection
//      real-Postgres test in `kitchen-print.concurrency.test.ts`.
// So for any single-actor / serial input `enqueuePrintJob` never throws (pre-filter alone), and the
// FOR SHARE lock extends that to the concurrent-deactivation race — the admin config change waits
// briefly; the sale never fails. The lock is symmetric, so in the reverse ordering — an admin
// `updatePrinter`/`deactivatePrinter` UPDATE already holding the row when the fire's FOR SHARE runs —
// the FIRE waits instead, bounded by that single-statement admin tx (`gated`, commits immediately). That
// is a bounded wait that COMPLETES the sale, never an abort: §5 forbids a sale FAILING, not a sub-ms
// lock wait on printer config.
//
// This file THROWS no domain code of its own (the only throw on the path, `enqueuePrintJob`'s
// `printer.not_found`, is made unreachable by those two guards), so it needs no `import "./errors.js"`.
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
import { perDishOptionQuantity } from "@waitron/shared";
import { kitchenPresentationName } from "@waitron/catalogue";
import { columnsFor, enqueuePrintJob } from "@waitron/printing";
import type { CharacterSet, PaperWidth, PrintConfig } from "@waitron/printing";
import { formatCorrectionSlip, formatKitchenTicket } from "./kitchen-ticket.js";
import type { KitchenLayout, KitchenTicketItem, KitchenTicketStation } from "./kitchen-ticket.js";
import type { TillConfig } from "./till-config.js";

/**
 * One line that fired in THIS round — the line it came from and the station it routed to. The caller
 * (`fireLines`/`fireCourse`) CAPTURES this from its own write's `RETURNING`, never by re-querying
 * `ticket_items` — an order fires round by round, so a re-query would re-select earlier rounds' items
 * and reprint them (controller ruling R-D). `fireLines` filters its insert's returned rows to the ones
 * whose `fired_at` came back non-null (held items are not printed until their course is released);
 * `fireCourse`'s UPDATE already matches only the newly-fired rows via its `fired_at IS NULL` predicate,
 * so its `RETURNING` is exactly this round's set.
 */
export interface FiredItem {
  workingOrderLineId: string;
  stationId: string;
}

/**
 * Pick one language out of a snapshotted locale→string map for the printed ticket. Its only caller is
 * the line's UNIT LABEL (`working_order_lines.unit_name`); the line's own name is resolved from the
 * frozen kitchen and staff names instead (`kitchenPresentationName`), which carry no per-language
 * text.
 * The till's own `locale` is normally one of the map's keys, so `text[locale]` hits directly. The
 * fallback covers a till whose UI locale is NOT among the venue's languages: the ticket keeps SOME
 * stored language rather than printing a blank, per the printed-receipt-keeps-venue-language rule.
 */
function ticketName(text: Record<string, string>, locale: string): string {
  const localised = text[locale];
  if (localised !== undefined) return localised;
  // Fallback: the first STORED key, which is not provably the venue's primary language — any is
  // acceptable on this rare mis-config path. What makes `Object.values(...)[0]` a string is that the
  // map is never EMPTY — non-null alone would not give that, since `Object.values({})[0]` is
  // undefined. `unit_name` freezes a unit's `abbreviation` (`packages/catalogue/src/pricing.ts`), and
  // both unit write paths — `createUnit` and `updateUnit` in `packages/catalogue/src/units.ts` — put
  // that abbreviation through `validateContentTranslations`, which refuses a map carrying no
  // non-blank text in the default content language. A line with NO unit is branched out at the call
  // site by `row.unitName == null`, so the `!` leaves no uncovered runtime branch.
  return Object.values(text)[0]!;
}

/**
 * The active station→printer mappings for `stationIds`, joined to `printers` for each printer's ticket
 * scope, FILTERED to ACTIVE printers, under a `FOR SHARE OF printers` row lock. Factored out of the fire
 * path so the recall/void correction path ({@link enqueueCorrectionSlips}) resolves printers through the
 * SAME locked lookup — the two never-block guards in this file's header (the `active = true` pre-filter
 * and the FOR SHARE lock that keeps a concurrent `deactivatePrinter` from flipping `active` before commit)
 * apply identically to a correction slip. `of: printers` scopes the lock to `printers` only (not the
 * mapping rows); FOR SHARE (not FOR KEY SHARE) is required because a `SET active = false` UPDATE touches
 * no key column, so only FOR SHARE conflicts with it.
 */
async function lockActivePrinters(
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
    .where(and(inArray(stationPrinters.stationId, stationIds), eq(printers.active, true)))
    .for("share", { of: printers });
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
 * Each line's printed `KitchenTicketItem` — quantity, the cook's name for the line, and its
 * `+ <name>`/` xN` modifier sub-lines — keyed by LINE ID, each carrying the line's `line_no` for a
 * stable within-station order. Factored from the fire path so the correction path formats a
 * recalled/voided line's item BYTE-FOR-BYTE like the original ticket the cook is correcting: same
 * name resolution (`kitchenPresentationName`), same per-option-quantity modifier labels, same
 * locale (`cfg.locale`). Reads the fired parents' qty + their frozen names and their child modifier
 * lines in ONE grouped read each (never N+1).
 * `lineIds` are the PARENT dish lines; a child modifier is never itself a key here (it is fetched
 * as sub-text of its parent).
 */
async function buildTicketItems(
  tx: Transaction,
  cfg: TillConfig,
  lineIds: string[],
): Promise<Map<string, { lineNo: number; item: KitchenTicketItem }>> {
  // The fired lines' display fields — quantity + the frozen kitchen/staff names — for the qty×name
  // lines. The customer-facing `descriptions` is deliberately NOT read: the cook's name falls back to
  // the STAFF name, never to the receipt text — that is `kitchenPresentationName`'s rule, and the
  // station queue reads the same one, so a cook sees one name on paper and on screen.
  const lineRows = await tx
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
      // Per-line customisation (order-line customisation, spec §2/§3): the note printed as a sub-line
      // (`emitItem`). Read here so BOTH the fire path and the recall/void correction slip carry it —
      // a correction slip shows the same detail the cook has.
      note: workingOrderLines.note,
    })
    .from(workingOrderLines)
    .where(inArray(workingOrderLines.id, lineIds));
  const lineById = new Map(lineRows.map((row) => [row.id, row]));

  // The CHILD extra lines of the fired parents — one grouped read, keyed by `parent_line_id` over
  // the fired parents' ids, printed as indented `+ <name>` sub-text beneath each dish. Ordered by
  // `line_no` so the picks print in the order they were offered.
  const childRows = await tx
    .select({
      parentLineId: workingOrderLines.parentLineId,
      lineNo: workingOrderLines.lineNo,
      quantity: workingOrderLines.quantity,
      name: workingOrderLines.name,
    })
    .from(workingOrderLines)
    .where(inArray(workingOrderLines.parentLineId, lineIds))
    .orderBy(workingOrderLines.lineNo);
  // parent line id → its extras strings in line_no order. The per-dish pick count is recovered from the
  // stored COMBINED child quantity (see perDishOptionQuantity); a count > 1 appends an ASCII " xN"
  // suffix, matching kitchen-ticket.ts's `qty x name` convention. Every child's parent is in `lineById`.
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
        // A nullable column → `?? undefined` so a plain line carries no key and prints exactly as
        // before; `emitItem` prints the note as a sub-line.
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

/**
 * The involved stations' names (a ticket/slip header), keyed by station id.
 */
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
 * The order header: the human order number + the dining-table label. The label comes from the
 * fan-out-proof scalar subquery `listExpoQueue` uses (both `tab_id` and `delivery_table_id` directions,
 * location scoped); a walk-up with no table resolves null. The outer `working_orders` columns
 * are referenced by their LITERAL qualified names, NOT via `${workingOrders.id}`: drizzle renders a
 * base-`.from()` table's column inside a `sql` template as a BARE `"id"`, which inside this subquery would
 * bind to `dining_tables.id` (→ `dt.tab_id = dt.id`, never matching) rather than correlating to the outer
 * order. `cfg.locationId` stays a bound `$n` param. `orderNumber` is stringified for the printed header.
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
 * Enqueue the kitchen tickets for a set of just-fired lines (design §3c), all within the passed `tx`.
 * For each INVOLVED station (one with ≥1 fired line), each attached `station`-scope printer gets a
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
  // Nothing fired (e.g. re-firing an already-fired course matched zero rows) → nothing to print.
  if (firedItems.length === 0) return;

  const stationIds = [...new Set(firedItems.map((f) => f.stationId))];

  // The station→printer mappings for the involved stations, ACTIVE-filtered and FOR-SHARE-locked (the
  // two never-block guards — see {@link lockActivePrinters} and this file's header). Read FIRST so a fire
  // whose stations map to NO printer can return before the detail reads below — the common case for a
  // venue not using kitchen printing (see the early return).
  const mappingRows = await lockActivePrinters(tx, stationIds);

  // No printer maps to any involved station → nothing to enqueue. Returning HERE, before the three
  // detail reads below, skips those reads on every no-kitchen-printer fire and takes no row lock (an empty
  // match locks nothing). Behaviour is otherwise unchanged: those reads exist only to BUILD tickets, and
  // with no mapping there is no ticket to build — the old order ran them and then discarded the result.
  if (mappingRows.length === 0) return;

  const lineIds = [...new Set(firedItems.map((f) => f.workingOrderLineId))];

  // The fired lines' printed items (qty + localised name + `+ <name>` modifier sub-lines), the involved
  // stations' names, and the order header — the three shared reads, factored out so the recall/void
  // correction path formats an item byte-for-byte the same way (see the helpers above). `ruling R-D`: a
  // `RETURNING` on the fire only sees `ticket_items`, so these follow-up reads rebuild the display fields.
  const itemsByLine = await buildTicketItems(tx, cfg, lineIds);
  const stationNames = await readStationNames(tx, stationIds);
  const order = await readOrderHeader(tx, cfg, orderId);

  // This round's items grouped by station, each carrying its `line_no` for a stable within-station order
  // (the same `line_no` ordering `listStationQueue` renders). Every fired line has an `itemsByLine` entry
  // (the read above covers exactly `lineIds`) and every fired station has a `stationNames` entry, so both
  // `.get`s are total here.
  const itemsByStation = new Map<string, { lineNo: number; item: KitchenTicketItem }[]>();
  for (const fired of firedItems) {
    const entry = itemsByLine.get(fired.workingOrderLineId)!;
    const bucket = itemsByStation.get(fired.stationId) ?? [];
    bucket.push(entry);
    itemsByStation.set(fired.stationId, bucket);
  }

  // The involved stations with their names, in a deterministic name order — station names are unique per
  // location, so the name alone totally orders them — each carrying its fired items in `line_no` order.
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

  // Station-scope printers print their OWN station's items now, one ticket per distinct layout;
  // order-scope (group) printers are collected and deduped by id, then print ONE consolidated
  // whole-event ticket per distinct layout, below.
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

/**
 * Enqueue a kitchen CORRECTION slip per item (coursing editing A6) — the paper-kitchen counterpart to a
 * RECALL ({@link recallLines}) or a VOID ({@link voidTabLine}) of a line that had ALREADY FIRED (printed).
 * The caller passes ONLY previously-fired lines: a held line never printed, so it produces no slip and is
 * never in `items` (the callers filter on `fired_at IS NOT NULL` before the recall/void). Each item is
 * formatted with {@link formatCorrectionSlip} — the SAME `emitItem` body the original ticket used, so the
 * cook sees the line rendered identically — and enqueued to EVERY active printer attached to the line's
 * station (both station- and order-scope: a correction is a single item, so there is no consolidated
 * variant to build — the cook at each attached printer gets told what changed).
 *
 * DRY with the fire path: the station→printer lookup ({@link lockActivePrinters}), the item/modifier
 * formatting ({@link buildTicketItems}), the station names ({@link readStationNames}) and the order header
 * ({@link readOrderHeader}) are the SAME factored reads {@link enqueueKitchenTickets} uses — so a slip's
 * qty/name/modifiers, table label and order number match the original ticket exactly.
 *
 * NEVER-BLOCK (§5) and the two printer guards apply exactly as on the fire path:
 * `lockActivePrinters` ACTIVE-filters and FOR-SHARE-locks, so `enqueuePrintJob`'s
 * `printer.not_found` stays unreachable and the enqueue rides the caller's recall/void tx (rolls
 * back with it). An empty `items` — the common case, a recall/void of a held line — enqueues
 * nothing.
 *
 * NOTE for VOID: {@link voidTabLine}'s delete cascades the line + its ticket item away
 * (`ON DELETE CASCADE`), and this function RE-READS the line from `working_order_lines` via
 * `buildTicketItems`; so the void caller must invoke this WHILE the line still exists (before its delete),
 * having captured `{workingOrderLineId, stationId}` from the pre-delete ticket-item read.
 */
export async function enqueueCorrectionSlips(
  tx: Transaction,
  cfg: TillConfig,
  orderId: string,
  items: FiredItem[],
  kind: "VOID" | "RECALLED",
): Promise<void> {
  // No previously-fired line to correct (a recall/void of a held line) → nothing to print.
  if (items.length === 0) return;

  const stationIds = [...new Set(items.map((i) => i.stationId))];
  const mappingRows = await lockActivePrinters(tx, stationIds);
  // No active printer maps to any involved station → nothing to enqueue (skips the detail reads below).
  if (mappingRows.length === 0) return;

  const lineIds = [...new Set(items.map((i) => i.workingOrderLineId))];
  const itemsByLine = await buildTicketItems(tx, cfg, lineIds);
  const stationNames = await readStationNames(tx, stationIds);
  const header = await readOrderHeader(tx, cfg, orderId);

  // Every ACTIVE printer attached to a station, keyed by station id (station- and order-scope alike — a
  // correction slip has no consolidated variant, so scope does not branch here).
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
    // One slip's bytes per item and distinct layout, enqueued to each printer with that layout.
    for (const group of groupByLayout(attachedPrinters)) {
      const bytes = formatCorrectionSlip(
        {
          kind,
          stationName: stationNames.get(target.stationId)!,
          tableLabel: header.tableLabel,
          orderNumber: header.orderNumber,
          at,
          item: entry.item,
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
 * Reprint the current kitchen tickets for a whole order (design §3d) — the operator's "a jam ate the
 * paper, print it again" lever, surfaced on the station display + expo. Gathers EVERY currently-fired
 * ticket item of the order (`fired_at IS NOT NULL`) and re-enqueues them through the same
 * `enqueueKitchenTickets` the fire path uses, so the tickets have the SAME FORMAT and STRUCTURE a fire
 * produces (the per-station tickets and the one consolidated group-printer ticket), but with two
 * deliberate differences from any single fire: they are AGGREGATED across every fired round rather than
 * one round's set (see the next paragraph), and each is STAMPED WITH THE REPRINT TIME, not the original
 * fire time — `enqueueKitchenTickets` stamps `firedAt = new Date()` and this query never reads
 * `ticket_items.fired_at`, so a reprinted header shows when it was reprinted, not when the round fired
 * (a known limitation tracked in the backlog).
 *
 * Re-querying ALL fired items here is CORRECT — the OPPOSITE of the fire path. Print-on-fire captures
 * only the newly-fired set from its write's `RETURNING` (ruling R-D) precisely so it does NOT reprint
 * earlier rounds; reprint WANTS the whole current ticket across every round, so it re-reads the lot.
 * HELD items (`fired_at` NULL) are excluded — they are not in the kitchen yet, so there is nothing to
 * reprint for them.
 *
 * An order with no fired items (an unknown/never-fired order, or one whose items are all held)
 * yields an empty set and is a pure NO-OP: `enqueueKitchenTickets` short-circuits on the empty
 * input and enqueues nothing, so reprint needs — and throws — no error code of its own. It
 * inherits the fire path's never-block posture for free: enqueue is an outbox INSERT that opens
 * no socket, and the `FOR SHARE` lock in `enqueueKitchenTickets` keeps `enqueuePrintJob`'s
 * `printer.not_found` unreachable exactly as it does on the fire path (see the header).
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
    })
    .from(ticketItems)
    .where(and(eq(ticketItems.workingOrderId, orderId), isNotNull(ticketItems.firedAt)));
  await enqueueKitchenTickets(tx, cfg, orderId, fired);
}
