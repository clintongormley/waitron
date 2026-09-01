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
import { enqueuePrintJob } from "@waitron/printing";
import type { PrintConfig } from "@waitron/printing";
import { formatCorrectionSlip, formatKitchenTicket } from "./kitchen-ticket.js";
import type { KitchenTicketItem, KitchenTicketStation } from "./kitchen-ticket.js";
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
 * Resolve the printed name for a fired line. `descriptions` is the line's SNAPSHOTTED locale→string map
 * (`working_order_lines.descriptions`), which the `check_locales` trigger holds to EXACTLY the venue's
 * configured invoice locales. The till's own `locale` is normally one of them, so `descriptions[locale]`
 * hits directly. The fallback covers a till whose UI locale is NOT among the venue's invoice locales:
 * the printed ticket keeps a venue language (SOME configured description — every key is a venue invoice
 * locale per `check_locales`, so any is a venue language; NOT guaranteed to be the venue's PRIMARY
 * locale, since `descriptions` key order is not held to `invoice_locales` order) rather than a blank
 * line, per the printed-receipt-keeps-venue-language rule.
 */
function ticketName(descriptions: Record<string, string>, locale: string): string {
  const localised = descriptions[locale];
  if (localised !== undefined) return localised;
  // Fallback: some venue-language description (every key is a venue invoice locale per `check_locales`;
  // `Object.values(...)[0]` is the first STORED key, not provably `invoice_locales[0]` — any is acceptable
  // on this rare mis-config path). `descriptions` is NOT NULL and `check_locales` requires ≥1 configured
  // locale, so `Object.values(...)[0]` is always a string here — the `!` asserts that (compile-time only,
  // so no runtime branch is left uncovered).
  return Object.values(descriptions)[0]!;
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
  tenantId: string,
  stationIds: string[],
): Promise<{ stationId: string; printerId: string; ticketScope: "station" | "order" }[]> {
  return tx
    .select({
      stationId: stationPrinters.stationId,
      printerId: stationPrinters.printerId,
      ticketScope: printers.ticketScope,
    })
    .from(stationPrinters)
    .innerJoin(
      printers,
      and(
        eq(stationPrinters.printerId, printers.id),
        eq(stationPrinters.tenantId, printers.tenantId),
      ),
    )
    .where(
      and(
        eq(stationPrinters.tenantId, tenantId),
        inArray(stationPrinters.stationId, stationIds),
        eq(printers.active, true),
      ),
    )
    .for("share", { of: printers });
}

/**
 * Each line's printed `KitchenTicketItem` — quantity, localised name, and its `+ <name>`/` xN` modifier
 * sub-lines — keyed by LINE ID, each carrying the line's `line_no` for a stable within-station order.
 * Factored from the fire path so the correction path formats a recalled/voided line's item BYTE-FOR-BYTE
 * like the original ticket the cook is correcting: same `descriptions`→name pick ({@link ticketName}),
 * same per-option-quantity modifier labels, same locale (`cfg.locale`). Reads the fired parents' qty +
 * snapshotted `descriptions` and their child modifier lines in ONE grouped read each (never N+1),
 * tenant-scoped beside RLS. `lineIds` are the PARENT dish lines; a child modifier is never itself a key
 * here (it is fetched as sub-text of its parent).
 */
async function buildTicketItems(
  tx: Transaction,
  cfg: TillConfig,
  lineIds: string[],
): Promise<Map<string, { lineNo: number; item: KitchenTicketItem }>> {
  // The fired lines' display fields — quantity + the snapshotted description map — for the qty×name lines.
  const lineRows = await tx
    .select({
      id: workingOrderLines.id,
      lineNo: workingOrderLines.lineNo,
      quantity: workingOrderLines.quantity,
      descriptions: workingOrderLines.descriptions,
      // Per-line customisation (order-line customisation, spec §2/§3): the note/doneness printed as a
      // prominent doneness line + a note sub-line (`emitItem`). Read here so BOTH the fire path and the
      // recall/void correction slip carry them — a correction slip shows the same detail the cook has.
      note: workingOrderLines.note,
      doneness: workingOrderLines.doneness,
    })
    .from(workingOrderLines)
    .where(
      and(eq(workingOrderLines.tenantId, cfg.tenantId), inArray(workingOrderLines.id, lineIds)),
    );
  const lineById = new Map(lineRows.map((row) => [row.id, row]));

  // The CHILD modifier lines of the fired parents (ordering modifiers) — one grouped read, keyed by
  // `parent_line_id` over the fired parents' ids, printed as indented `+ <name>` sub-text beneath each
  // dish. Ordered by `line_no` so the options print in selection order; tenant-scoped beside RLS.
  const childRows = await tx
    .select({
      parentLineId: workingOrderLines.parentLineId,
      lineNo: workingOrderLines.lineNo,
      quantity: workingOrderLines.quantity,
      descriptions: workingOrderLines.descriptions,
    })
    .from(workingOrderLines)
    .where(
      and(
        eq(workingOrderLines.tenantId, cfg.tenantId),
        inArray(workingOrderLines.parentLineId, lineIds),
      ),
    )
    .orderBy(workingOrderLines.lineNo);
  // parent line id → its option strings in line_no order. Per-option quantity is recovered from the filed
  // COMBINED child quantity (see perDishOptionQuantity); a per-dish count > 1 appends an ASCII " xN"
  // suffix, matching kitchen-ticket.ts's `qty x name` convention. Every child's parent is in `lineById`.
  const modifiersByParent = new Map<string, string[]>();
  for (const child of childRows) {
    const parent = lineById.get(child.parentLineId!)!;
    const perDish = perDishOptionQuantity(child.quantity, parent.quantity);
    const name = ticketName(child.descriptions, cfg.locale);
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
        qty: Number(row.quantity),
        name: ticketName(row.descriptions, cfg.locale),
        // Nullable columns → `?? undefined` so a plain line carries neither key and prints exactly as
        // before; `emitItem` prints doneness prominently and the note as a sub-line.
        doneness: row.doneness ?? undefined,
        note: row.note ?? undefined,
        modifiers: modifiersByParent.get(row.id) ?? [],
      },
    });
  }
  return byLine;
}

/** The involved stations' names (a ticket/slip header), keyed by station id, tenant-scoped beside RLS. */
async function readStationNames(
  tx: Transaction,
  tenantId: string,
  stationIds: string[],
): Promise<Map<string, string>> {
  const rows = await tx
    .select({ id: kitchenStations.id, name: kitchenStations.name })
    .from(kitchenStations)
    .where(and(eq(kitchenStations.tenantId, tenantId), inArray(kitchenStations.id, stationIds)));
  return new Map(rows.map((row) => [row.id, row.name]));
}

/**
 * The order header: the human order number + the dining-table label. The label comes from the
 * fan-out-proof scalar subquery `listExpoQueue` uses (both `tab_id` and `delivery_table_id` directions,
 * tenant + location scoped); a walk-up with no table resolves null. The outer `working_orders` columns
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
        where dt.tenant_id = working_orders.tenant_id
          and dt.location_id = ${cfg.locationId}
          and (dt.tab_id = working_orders.id or working_orders.delivery_table_id = dt.id)
        order by (dt.tab_id = working_orders.id) desc nulls last, dt.id
        limit 1)`,
    })
    .from(workingOrders)
    .where(and(eq(workingOrders.tenantId, cfg.tenantId), eq(workingOrders.id, orderId)));
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
  const mappingRows = await lockActivePrinters(tx, cfg.tenantId, stationIds);

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
  const stationNames = await readStationNames(tx, cfg.tenantId, stationIds);
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

  const printersByStation = new Map<
    string,
    { printerId: string; ticketScope: "station" | "order" }[]
  >();
  for (const mapping of mappingRows) {
    const bucket = printersByStation.get(mapping.stationId) ?? [];
    bucket.push({ printerId: mapping.printerId, ticketScope: mapping.ticketScope });
    printersByStation.set(mapping.stationId, bucket);
  }

  const printCfg: PrintConfig = { tenantId: cfg.tenantId, locationId: cfg.locationId };
  const firedAt = new Date();
  const tableLabel = order.tableLabel ?? "";
  const orderNumber = order.orderNumber;

  // Station-scope printers print their OWN station's items now; order-scope (group) printers are
  // collected and deduped, then print ONE consolidated whole-event ticket each, below.
  const groupPrinterIds = new Set<string>();
  for (const station of stations) {
    // Build this station's ticket bytes ONCE per station, then enqueue the SAME bytes to each
    // attached station-scope printer — a station with N station-scope printers formats byte-identical
    // bytes once, not N times. `formatKitchenTicket` is a pure byte producer, so building it for a
    // station that turns out to have only group-scope printers computes an unused (discarded) value
    // and enqueues nothing — no behaviour change. Mirrors the consolidated group ticket below, which
    // is likewise built once then looped over its printers.
    const stationTicket = formatKitchenTicket({
      scope: "station",
      stationName: station.name,
      tableLabel,
      orderNumber,
      firedAt,
      items: station.items,
    });
    for (const attached of printersByStation.get(station.id) ?? []) {
      if (attached.ticketScope === "station") {
        await enqueuePrintJob(tx, printCfg, attached.printerId, stationTicket);
      } else {
        groupPrinterIds.add(attached.printerId);
      }
    }
  }

  // ONE consolidated ticket of the WHOLE event per DISTINCT group printer: every involved station's items
  // under its own sub-header, so the pass reads the whole fire at a glance.
  if (groupPrinterIds.size > 0) {
    const consolidated = formatKitchenTicket({
      scope: "order",
      tableLabel,
      orderNumber,
      firedAt,
      stations: stations.map((station): KitchenTicketStation => ({
        stationName: station.name,
        items: station.items,
      })),
    });
    for (const printerId of groupPrinterIds) {
      await enqueuePrintJob(tx, printCfg, printerId, consolidated);
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
 * NEVER-BLOCK (§5) and the two printer guards apply exactly as on the fire path: `lockActivePrinters`
 * ACTIVE-filters and FOR-SHARE-locks, so `enqueuePrintJob`'s `printer.not_found` stays unreachable and the
 * enqueue rides the caller's recall/void tx (rolls back with it). An empty `items` — the common case, a
 * recall/void of a held line — enqueues nothing. Tenant-scoped beside the caller's RLS.
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
  const mappingRows = await lockActivePrinters(tx, cfg.tenantId, stationIds);
  // No active printer maps to any involved station → nothing to enqueue (skips the detail reads below).
  if (mappingRows.length === 0) return;

  const lineIds = [...new Set(items.map((i) => i.workingOrderLineId))];
  const itemsByLine = await buildTicketItems(tx, cfg, lineIds);
  const stationNames = await readStationNames(tx, cfg.tenantId, stationIds);
  const header = await readOrderHeader(tx, cfg, orderId);

  // Every ACTIVE printer attached to a station, keyed by station id (station- and order-scope alike — a
  // correction slip has no consolidated variant, so scope does not branch here).
  const printersByStation = new Map<string, string[]>();
  for (const mapping of mappingRows) {
    const bucket = printersByStation.get(mapping.stationId) ?? [];
    bucket.push(mapping.printerId);
    printersByStation.set(mapping.stationId, bucket);
  }

  const printCfg: PrintConfig = { tenantId: cfg.tenantId, locationId: cfg.locationId };
  const at = new Date().toISOString();

  for (const target of items) {
    const attachedPrinters = printersByStation.get(target.stationId);
    // A line whose station has no active printer produced no paper — nothing to correct there.
    if (attachedPrinters === undefined) continue;
    const entry = itemsByLine.get(target.workingOrderLineId)!;
    // One slip's bytes built ONCE per item, then enqueued to each attached printer of its station.
    const bytes = formatCorrectionSlip({
      kind,
      stationName: stationNames.get(target.stationId)!,
      tableLabel: header.tableLabel,
      orderNumber: header.orderNumber,
      at,
      item: entry.item,
    });
    for (const printerId of attachedPrinters) {
      await enqueuePrintJob(tx, printCfg, printerId, bytes);
    }
  }
}

/**
 * Reprint the current kitchen tickets for a whole order (design §3d) — the operator's "a jam ate the
 * paper, print it again" lever, surfaced on the station display + expo. Gathers EVERY currently-fired
 * ticket item of the order (`fired_at IS NOT NULL`, tenant-scoped) and re-enqueues them through the same
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
 * An order with no fired items (an unknown/never-fired order, or one whose items are all held) yields an
 * empty set and is a pure NO-OP: `enqueueKitchenTickets` short-circuits on the empty input and enqueues
 * nothing, so reprint needs — and throws — no error code of its own. It inherits the fire path's
 * never-block posture for free: enqueue is an outbox INSERT that opens no socket, and the `FOR SHARE`
 * lock in `enqueueKitchenTickets` keeps `enqueuePrintJob`'s `printer.not_found` unreachable exactly as it
 * does on the fire path (see the header). Tenant-scoped (belt-and-braces beside the caller's RLS).
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
    .where(
      and(
        eq(ticketItems.tenantId, cfg.tenantId),
        eq(ticketItems.workingOrderId, orderId),
        isNotNull(ticketItems.firedAt),
      ),
    );
  await enqueueKitchenTickets(tx, cfg, orderId, fired);
}
