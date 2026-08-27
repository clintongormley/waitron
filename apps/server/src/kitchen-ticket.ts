/**
 * Formats a fired kitchen ticket into ESC/POS bytes (design §3c) — the pure byte-producing half of
 * KDS-4. It owns no state and touches no database: it takes an already-resolved ticket and returns
 * the `print_jobs.payload` the printing outbox moves verbatim. The fire path (Task 4) builds the
 * `KitchenTicket` from the freshly-fired `ticket_items` and hands these bytes to `enqueuePrintJob`;
 * the HTTP layer (Task 5) is elsewhere again. Keeping this a pure function is what lets the whole
 * layout be pinned in a unit test with no PGlite and no container.
 *
 * `scope` is a DISCRIMINATED UNION (controller ruling R-B, which supersedes the spec §3c `courses`
 * sketch):
 *   - `station` — one physical station's copy: the station's own name heads the ticket and the items
 *     are a flat list (they were already routed to this station at fire time).
 *   - `order` — the expediter's "pass" copy: a single ticket that groups every fired item BY station,
 *     each station's lines under its own sub-header, so the pass reads the whole order at a glance.
 *
 * NO emphasis/bold (ruling R-G). The ESC/POS builder — `@waitron/printing`'s `esc()` — exposes only
 * `init`/`text`/`line`/`feed`/`cut`/`kick` (verified against packages/printing/src/escpos.ts:37-91);
 * there is no bold verb. The plan's "bold the table/order" is therefore DEFERRED until the builder
 * gains emphasis, and adding a bold command to packages/printing is out of this task's scope. The
 * layout below uses only the existing verbs.
 */
import { esc } from "@waitron/printing";

/** The pass header for an `order`-scope ticket — the printed VALUE the expediter reads ("pass"). */
const ORDER_HEADER = "PASE";

/**
 * Blank lines fed before the cut, so the tear-off clears the print head and the operator has
 * something to grip. Matches the test-print payload's `feed(3)` in print-api.ts.
 */
const FEED_BEFORE_CUT = 3;

/** One fired line: a quantity and the product name, snapshotted at fire time by the caller. */
export interface KitchenTicketItem {
  qty: number;
  name: string;
}

/** One station's slice of an `order`-scope ticket: the station's name and the items fired to it. */
export interface KitchenTicketStation {
  stationName: string;
  items: KitchenTicketItem[];
}

/**
 * A ready-to-render kitchen ticket. `firedAt` is the wall-clock fire time; it prints as local HH:MM.
 * The two variants are distinguished by `scope` (R-B).
 */
export type KitchenTicket =
  | {
      scope: "station";
      stationName: string;
      tableLabel: string;
      orderNumber: string;
      firedAt: Date;
      items: KitchenTicketItem[];
    }
  | {
      scope: "order";
      tableLabel: string;
      orderNumber: string;
      firedAt: Date;
      stations: KitchenTicketStation[];
    };

/** `qty x name`, e.g. `2 x Steak`. An ASCII "x" so any single-byte printer code page renders it. */
function itemLine(item: KitchenTicketItem): string {
  return `${item.qty} x ${item.name}`;
}

/** Local `HH:MM`, zero-padded — the fire time as the kitchen reads it off the wall clock. */
function hhmm(at: Date): string {
  const h = String(at.getHours()).padStart(2, "0");
  const m = String(at.getMinutes()).padStart(2, "0");
  return `${h}:${m}`;
}

/**
 * Render `ticket` to an ESC/POS payload. Pure and total: an empty `items`/`stations` array yields a
 * header-only ticket rather than throwing (the caller filters out stations with nothing fired).
 */
export function formatKitchenTicket(ticket: KitchenTicket): Uint8Array {
  const b = esc().init();

  // Header line differs by scope; the table / order / time block is shared by both.
  b.line(ticket.scope === "station" ? ticket.stationName : ORDER_HEADER);
  b.line(ticket.tableLabel).line(ticket.orderNumber).line(hhmm(ticket.firedAt));

  if (ticket.scope === "station") {
    for (const item of ticket.items) b.line(itemLine(item));
  } else {
    for (const station of ticket.stations) {
      b.line(station.stationName);
      for (const item of station.items) b.line(itemLine(item));
    }
  }

  return b.feed(FEED_BEFORE_CUT).cut().bytes();
}
