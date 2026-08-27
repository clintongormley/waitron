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
// briefly; the sale never fails.
//
// This file THROWS no domain code of its own (the only throw on the path, `enqueuePrintJob`'s
// `printer.not_found`, is made unreachable by those two guards), so it needs no `import "./errors.js"`.
import { and, eq, inArray, sql } from "drizzle-orm";
import {
  kitchenStations,
  printers,
  stationPrinters,
  workingOrderLines,
  workingOrders,
} from "@waitron/db";
import type { Transaction } from "@waitron/db";
import { enqueuePrintJob } from "@waitron/printing";
import type { PrintConfig } from "@waitron/printing";
import { formatKitchenTicket } from "./kitchen-ticket.js";
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
 * the printed ticket keeps the venue language (the first configured description) rather than a blank
 * line, per the printed-receipt-keeps-venue-language rule.
 */
function ticketName(descriptions: Record<string, string>, locale: string): string {
  const localised = descriptions[locale];
  if (localised !== undefined) return localised;
  // Fallback: the first configured venue-language description. `descriptions` is NOT NULL and
  // `check_locales` requires ≥1 configured locale, so `Object.values(...)[0]` is always a string here —
  // the `!` asserts that (compile-time only, so no runtime branch is left uncovered).
  return Object.values(descriptions)[0]!;
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

  const lineIds = [...new Set(firedItems.map((f) => f.workingOrderLineId))];
  const stationIds = [...new Set(firedItems.map((f) => f.stationId))];

  // The fired lines' display fields — quantity + the snapshotted description map — for the qty×name
  // lines. A `RETURNING` on the fire only sees `ticket_items`, so this is the follow-up read ruling R-D
  // calls for; tenant-scoped (belt-and-braces beside RLS), matching the `ticket_items` →
  // `working_order_lines` join `listStationQueue`/`listExpoQueue` use for name + qty.
  const lineRows = await tx
    .select({
      id: workingOrderLines.id,
      lineNo: workingOrderLines.lineNo,
      quantity: workingOrderLines.quantity,
      descriptions: workingOrderLines.descriptions,
    })
    .from(workingOrderLines)
    .where(
      and(eq(workingOrderLines.tenantId, cfg.tenantId), inArray(workingOrderLines.id, lineIds)),
    );
  const lineById = new Map(lineRows.map((row) => [row.id, row]));

  // The involved stations' names (the station ticket's header + the group ticket's sub-headers).
  const stationRows = await tx
    .select({ id: kitchenStations.id, name: kitchenStations.name })
    .from(kitchenStations)
    .where(
      and(eq(kitchenStations.tenantId, cfg.tenantId), inArray(kitchenStations.id, stationIds)),
    );

  // The order header: the human order number + the dining-table label. The label comes from the
  // fan-out-proof scalar subquery `listExpoQueue` uses (both `tab_id` and `delivery_table_id` directions,
  // tenant + location scoped); a walk-up with no table resolves null.
  // The outer `working_orders` columns are referenced here by their LITERAL qualified names, NOT via
  // `${workingOrders.id}`: drizzle renders a base-`.from()` table's column inside a `sql` template as a
  // BARE `"id"`, which inside this subquery would bind to `dining_tables.id` (→ `dt.tab_id = dt.id`,
  // never matching) rather than correlating to the outer order. (`listExpoQueue`'s identical-looking
  // `${workingOrders.id}` works only because there `working_orders` is a JOINED table, which drizzle DOES
  // qualify.) `cfg.locationId` stays a bound `$n` param.
  const orderRows = await tx
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
  const order = orderRows[0]!;

  // The station→printer mappings for the involved stations, joined to `printers` for each printer's
  // ticket scope and FILTERED to ACTIVE printers. Two things keep `enqueuePrintJob` from throwing
  // `printer.not_found` (which would abort the fire tx — see the header):
  //   - the `active = true` filter drops an already-deactivated printer (never enqueued);
  //   - `FOR SHARE OF printers` row-locks the matched `printers` rows, so a concurrent
  //     `deactivatePrinter` UPDATE (which needs a conflicting FOR NO KEY UPDATE lock) BLOCKS until this
  //     fire tx commits — so `active` cannot flip to false between here and `enqueuePrintJob`'s own
  //     re-check under READ COMMITTED. `of: printers` scopes the lock to `printers` only (not the
  //     mapping rows), and FOR SHARE (not FOR KEY SHARE) is required: a `SET active = false` UPDATE
  //     touches no key column, so only FOR SHARE conflicts with it.
  const mappingRows = await tx
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
        eq(stationPrinters.tenantId, cfg.tenantId),
        inArray(stationPrinters.stationId, stationIds),
        eq(printers.active, true),
      ),
    )
    .for("share", { of: printers });

  // This round's items grouped by station, each carrying its `line_no` for a stable within-station order
  // (the same `line_no` ordering `listStationQueue` renders). Every fired line has a `lineById` row (the
  // read above covers exactly `lineIds`) and every fired station has a `stationRows` row, so both `.get`s
  // are total here.
  const itemsByStation = new Map<string, { lineNo: number; item: KitchenTicketItem }[]>();
  for (const fired of firedItems) {
    const line = lineById.get(fired.workingOrderLineId)!;
    const item: KitchenTicketItem = {
      qty: Number(line.quantity),
      name: ticketName(line.descriptions, cfg.locale),
    };
    const bucket = itemsByStation.get(fired.stationId) ?? [];
    bucket.push({ lineNo: line.lineNo, item });
    itemsByStation.set(fired.stationId, bucket);
  }

  // The involved stations with their names, in a deterministic name order — station names are unique per
  // location, so the name alone totally orders them — each carrying its fired items in `line_no` order.
  const stations = stationRows
    .map((station) => ({
      id: station.id,
      name: station.name,
      items: itemsByStation
        .get(station.id)!
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
  const orderNumber = String(order.orderNumber);

  // Station-scope printers print their OWN station's items now; order-scope (group) printers are
  // collected and deduped, then print ONE consolidated whole-event ticket each, below.
  const groupPrinterIds = new Set<string>();
  for (const station of stations) {
    for (const attached of printersByStation.get(station.id) ?? []) {
      if (attached.ticketScope === "station") {
        await enqueuePrintJob(
          tx,
          printCfg,
          attached.printerId,
          formatKitchenTicket({
            scope: "station",
            stationName: station.name,
            tableLabel,
            orderNumber,
            firedAt,
            items: station.items,
          }),
        );
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
