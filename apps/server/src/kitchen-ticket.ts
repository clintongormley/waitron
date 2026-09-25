/**
 * Formats kitchen tickets and correction slips into ESC/POS bytes. Pure: no state, no database.
 *
 * A `station` ticket is one station's copy, a flat list under the station's name. An `order` ticket
 * is the pass copy: every fired item grouped under its station's name.
 *
 * `esc()` has no bold, so ASCII markers stand in for emphasis.
 */
import { esc, prepareText, wrapText, type CharacterSet } from "@waitron/printing";

/** The printed header of an `order`-scope ticket. */
const ORDER_HEADER = "PASE";

/** One fired line. `modifiers` print as indented `+ <name>` sub-lines beneath the dish, so a dish and
 *  its modifiers read as one kitchen item. */
export interface KitchenTicketItem {
  qty: number | string;
  unit?: string;
  name: string;
  /** The free-text kitchen note, printed as an indented `* <note>` sub-line beneath the dish. */
  note?: string;
  modifiers?: string[];
}

export interface KitchenTicketStation {
  stationName: string;
  items: KitchenTicketItem[];
}

/** `firedAt` prints as local HH:MM. */
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
  return `${item.qty}${item.unit ? ` ${item.unit}` : ""} x ${item.name}`;
}

/**
 * The note is operator-typed, so it can carry line breaks and other control bytes that would split it
 * across lines or reach the printer as commands. Each run of them becomes one space. Only the note is
 * sanitised; dish and modifier names are catalogue text.
 */
function sanitizeNote(note: string): string {
  // eslint-disable-next-line no-control-regex -- deliberately matching C0 controls + DEL to strip them
  return note.replace(/[\x00-\x1f\x7f]+/g, " ").trim();
}

/** Emit one item's `qty x name` line, then each modifier as `+ <name>` and the note as `* <note>`. */
function emitItem(b: ReturnType<typeof esc>, item: KitchenTicketItem, layout: KitchenLayout): void {
  // Each line wraps to the paper; a continuation starts under the text after its marker.
  const text = (s: string, indent: number): void => {
    for (const line of wrapText(prepareText(s, layout.charset), layout.columns, indent))
      b.line(line);
  };
  const prefix = `${item.qty}${item.unit ? ` ${item.unit}` : ""} x `;
  text(itemLine(item), prepareText(prefix, layout.charset).length);
  for (const modifier of item.modifiers ?? []) text(`  + ${modifier}`, 4);
  if (item.note !== undefined && item.note !== "") {
    // A note of nothing but control bytes sanitises to "" and is skipped.
    const note = sanitizeNote(item.note);
    if (note !== "") text(`  * ${note}`, 4);
  }
}

/** The printer settings a kitchen ticket is laid out for. Kitchen paper carries no QR, so no resolution. */
export interface KitchenLayout {
  columns: number;
  charset: CharacterSet;
  characterTable: number;
}

function hhmm(at: Date): string {
  const h = String(at.getHours()).padStart(2, "0");
  const m = String(at.getMinutes()).padStart(2, "0");
  return `${h}:${m}`;
}

/** An empty `items`/`stations` array yields a header-only ticket rather than throwing. */
export function formatKitchenTicket(ticket: KitchenTicket, layout: KitchenLayout): Uint8Array {
  const b = esc(layout.charset, layout.characterTable).init();
  const text = (s: string): void => {
    for (const line of wrapText(prepareText(s, layout.charset), layout.columns)) b.line(line);
  };

  text(ticket.scope === "station" ? ticket.stationName : ORDER_HEADER);
  text(ticket.tableLabel);
  text(ticket.orderNumber);
  b.line(hhmm(ticket.firedAt));

  if (ticket.scope === "station") {
    for (const item of ticket.items) emitItem(b, item, layout);
  } else {
    for (const station of ticket.stations) {
      text(station.stationName);
      for (const item of station.items) emitItem(b, item, layout);
    }
  }

  return b.feedAndCut().bytes();
}

/**
 * A slip for one already-fired line, telling the cook what changed without reprinting the order:
 * `VOID` (cancelled after firing) or `RECALLED` (pulled back to held).
 */
export interface CorrectionSlip {
  kind: "VOID" | "RECALLED";
  stationName: string;
  tableLabel: string | null;
  orderNumber: string;
  at: string;
  item: KitchenTicketItem;
}

/** Reuses {@link emitItem}, so the item prints exactly as on the original ticket. */
export function formatCorrectionSlip(slip: CorrectionSlip, layout: KitchenLayout): Uint8Array {
  const b = esc(layout.charset, layout.characterTable).init();
  const text = (s: string): void => {
    for (const line of wrapText(prepareText(s, layout.charset), layout.columns)) b.line(line);
  };

  b.line(`*** ${slip.kind} ***`);
  text(slip.stationName);
  if (slip.tableLabel !== null) text(slip.tableLabel);
  text(slip.orderNumber);
  b.line(hhmm(new Date(slip.at)));
  emitItem(b, slip.item, layout);

  return b.feedAndCut().bytes();
}
