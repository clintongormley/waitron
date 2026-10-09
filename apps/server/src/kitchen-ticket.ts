/**
 * Formats kitchen tickets and correction slips into ESC/POS bytes. Pure: no state, no database.
 *
 * A station ticket lists its own printable items and may end with the rest of the order. A ticket
 * for several stations sharing a printer does the same with a section per station. A watcher
 * ticket groups the items it follows under their station names.
 *
 * `esc()` has no bold, so ASCII markers stand in for emphasis.
 */
import { esc, prepareText, wrapText, type EscSetting } from "@waitron/printing";
import { stringToThousandths, thousandthsToDecimal } from "@waitron/shared";

/** One fired line. Modifiers and cross-references print beneath the item. */
export interface KitchenTicketItem {
  qty: number | string;
  unit?: string;
  name: string;
  /** The free-text kitchen note, printed as an indented `* <note>` sub-line beneath the dish. */
  note?: string;
  modifiers?: string[];
  /** Already-worded links to lines at other stations, printed after modifiers and before the note. */
  crossRefs?: string[];
  /** The position of the party's group the item fired in; absent for an item in no group. */
  group?: number;
  /** Printed as sold, never merged or split. */
  printedAsSold?: boolean;
}

export interface KitchenTicketStation {
  stationName: string;
  items: KitchenTicketItem[];
}

/** One item of the order at another station, as a station's own ticket lists it. */
export interface OtherStationItem {
  qty: number | string;
  unit?: string;
  name: string;
  stationName: string;
  held: boolean;
}

/**
 * `firedAt` prints as local HH:MM. A `reprint` opens with `*** REPRINT ***`; a `mark` opens with
 * `*** HOLD ***` (held work printed in advance) or `*** FIRE ***` (that work released).
 */
export type KitchenTicket = {
  reprint?: boolean;
  mark?: "HOLD" | "FIRE";
  from?: { stationName: string; locale: string };
} & (
  | {
      scope: "station";
      stationName: string;
      tableLabel: string;
      orderNumber: string;
      firedAt: Date;
      items: KitchenTicketItem[];
      alsoOnOrder?: { locale: string; items: OtherStationItem[] };
    }
  | {
      scope: "stations";
      stations: KitchenTicketStation[];
      tableLabel: string;
      orderNumber: string;
      firedAt: Date;
      alsoOnOrder?: { locale: string; items: OtherStationItem[] };
    }
  | {
      scope: "watcher";
      watcherName: string;
      tableLabel: string;
      orderNumber: string;
      firedAt: Date;
      stations: KitchenTicketStation[];
    }
);

/** `combined` prints identical entries as one `N x`, `separate` prints one entry per unit. */
export type KitchenTicketGrouping = "combined" | "separate";

/** Entries with equal keys print identically, quantity aside: the note is compared as it prints. */
function entryKey(item: KitchenTicketItem): string {
  return JSON.stringify([
    item.name,
    item.unit ?? "",
    item.note === undefined ? "" : sanitizeNote(item.note),
    item.group ?? null,
    item.modifiers ?? [],
    item.crossRefs ?? [],
  ]);
}

/**
 * One ticket list laid out by grouping. `combined` merges entries that would print identically into
 * the first of them, adding the quantities. `separate` prints a whole-number quantity N as N entries
 * of 1. A `printedAsSold` entry, or a quantity that is not a whole number, is never merged and never
 * split: two 350 g portions are two pieces to cook, not one of 700 g nor 700 of 1 g.
 */
export function arrangeTicketItems(
  items: readonly KitchenTicketItem[],
  grouping: KitchenTicketGrouping,
): KitchenTicketItem[] {
  const count = (item: KitchenTicketItem) => stringToThousandths(String(item.qty));
  const countable = (item: KitchenTicketItem, thousandths: number) =>
    item.printedAsSold !== true && thousandths % 1000 === 0;
  if (grouping === "separate") {
    return items.flatMap((item) => {
      const thousandths = count(item);
      if (!countable(item, thousandths)) return [item];
      return Array.from({ length: thousandths / 1000 }, () => ({
        ...item,
        qty: thousandthsToDecimal(1000),
      }));
    });
  }
  const arranged: { item: KitchenTicketItem; thousandths: number }[] = [];
  const byKey = new Map<string, { item: KitchenTicketItem; thousandths: number }>();
  for (const item of items) {
    const thousandths = count(item);
    const key = countable(item, thousandths) ? entryKey(item) : undefined;
    const same = key === undefined ? undefined : byKey.get(key);
    if (same !== undefined) {
      same.thousandths += thousandths;
      continue;
    }
    const entry = { item, thousandths };
    arranged.push(entry);
    if (key !== undefined) byKey.set(key, entry);
  }
  return arranged.map(({ item, thousandths }) => ({
    ...item,
    qty: thousandthsToDecimal(thousandths),
  }));
}

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

/**
 * Emit one item's `qty x name` line, `sign` before the quantity, then each modifier as `+ <name>` and
 * the note as `* <note>`.
 */
function emitItem(
  b: ReturnType<typeof esc>,
  item: KitchenTicketItem,
  columns: number,
  sign: "+" | "-" | "" = "",
): void {
  // Each line wraps to the paper; a continuation starts under the text after its marker.
  const text = (s: string, indent: number): void => {
    for (const line of wrapText(prepareText(s), columns, indent)) b.line(line);
  };
  const prefix = `${sign}${item.qty}${item.unit ? ` ${item.unit}` : ""} x `;
  text(`${sign}${itemLine(item)}`, prepareText(prefix).length);
  for (const modifier of item.modifiers ?? []) text(`  + ${modifier}`, 4);
  for (const ref of item.crossRefs ?? []) text(`  > ${ref}`, 4);
  if (item.note !== undefined && item.note !== "") {
    // A note of nothing but control bytes sanitises to "" and is skipped.
    const note = sanitizeNote(item.note);
    if (note !== "") text(`  * ${note}`, 4);
  }
}

function hhmm(at: Date): string {
  const h = String(at.getHours()).padStart(2, "0");
  const m = String(at.getMinutes()).padStart(2, "0");
  return `${h}:${m}`;
}

/**
 * An empty `items`/`stations` array yields a header-only ticket rather than throwing. A ticket whose
 * items all share one group names it once under the header; one spanning groups heads each group's
 * run of items instead, so callers put group-less items first and the rest in group order.
 */
export function formatKitchenTicket(ticket: KitchenTicket, layout: EscSetting): Uint8Array {
  const b = esc(layout).init();
  const { columns } = b.grid;
  const text = (s: string): void => {
    for (const line of wrapText(prepareText(s), columns)) b.line(line);
  };
  const lists =
    ticket.scope === "station" ? [ticket.items] : ticket.stations.map((station) => station.items);
  const groups = new Set(lists.flat().map((item) => item.group));
  const [onlyGroup] = groups.size === 1 ? groups : [undefined];
  const emitList = (items: readonly KitchenTicketItem[]): void => {
    let current: number | undefined = onlyGroup;
    for (const item of items) {
      if (item.group !== undefined && item.group !== current) b.line(`GROUP ${item.group}`);
      current = item.group;
      emitItem(b, item, columns);
    }
  };

  if (ticket.reprint === true) b.line("*** REPRINT ***");
  if (ticket.mark !== undefined) b.line(`*** ${ticket.mark} ***`);
  text(
    ticket.scope === "station"
      ? ticket.stationName
      : ticket.scope === "stations"
        ? ticket.stations.map((station) => station.stationName).join(" · ")
        : ticket.watcherName,
  );
  text(ticket.tableLabel);
  text(ticket.orderNumber);
  b.line(hhmm(ticket.firedAt));
  if (ticket.from !== undefined)
    text(`${kitchenWords(ticket.from.locale).from} ${ticket.from.stationName}`);
  if (onlyGroup !== undefined) b.line(`GROUP ${onlyGroup}`);

  if (ticket.scope === "station") emitList(ticket.items);
  else {
    for (const station of ticket.stations) {
      text(station.stationName);
      emitList(station.items);
    }
  }
  const alsoOnOrder = ticket.scope === "watcher" ? undefined : ticket.alsoOnOrder;
  if (alsoOnOrder !== undefined && alsoOnOrder.items.length > 0) {
    const { heading, held } = alsoOnOrderWords(alsoOnOrder.locale);
    text(`-- ${heading} --`);
    for (const item of alsoOnOrder.items) {
      const prefix = `${item.qty}${item.unit ? ` ${item.unit}` : ""} x `;
      const line = `${prefix}${item.name} — ${item.stationName}${item.held ? ` ${held}` : ""}`;
      for (const part of wrapText(prepareText(line), columns, prepareText(prefix).length)) {
        b.line(part);
      }
    }
  }

  return b.feedAndCut().bytes();
}

const TICKET_START = esc().init().bytes();
const TICKET_END = esc().feedAndCut().bytes();

function startsWith(bytes: Uint8Array, prefix: Uint8Array, at = 0): boolean {
  return bytes.length - at >= prefix.length && prefix.every((byte, i) => bytes[at + i] === byte);
}

/**
 * Two {@link formatKitchenTicket} payloads as one paper: `first` without its feed and cut, then
 * `second` without its `ESC @`, so the printer cuts once, after `second`.
 */
export function joinKitchenTickets(first: Uint8Array, second: Uint8Array): Uint8Array {
  const kept = first.length - TICKET_END.length;
  if (!startsWith(first, TICKET_END, Math.max(kept, 0)) || !startsWith(second, TICKET_START)) {
    throw new RangeError("joinKitchenTickets takes two whole kitchen tickets");
  }
  const joined = new Uint8Array(kept + second.length - TICKET_START.length);
  joined.set(first.subarray(0, kept));
  joined.set(second.subarray(TICKET_START.length), kept);
  return joined;
}

/**
 * A slip for one line the kitchen has on paper, telling the cook what changed without reprinting the
 * order. For fired work: `VOID` (cancelled after firing), `RECALLED` (pulled back to held) or `MOVED`
 * (now belongs to another table, `tableLabel`, where `movedFrom` names the table and order its ticket
 * had). For held work on a HOLD ticket: `HOLD CHANGED` (the item's quantity `added` to or `removed`
 * from its group) or `HOLD CANCELLED` (taken out of the order); these name the item's group.
 * `TO STATION` names the station now responsible for fired work; the slip stays at the old station.
 * `EXTRA CANCELLED`: an extra taken off a dish the kitchen has, fired or `held` on a HOLD ticket,
 * printing the dish as it now stands and then the extra to take off. Its header word and cancel
 * line follow `locale`'s language (Spanish, else English); the `HOLD` prefix and `GROUP n` stay
 * English.
 */
export type CorrectionSlip = {
  stationName: string;
  tableLabel: string | null;
  orderNumber: string;
  at: string;
  item: KitchenTicketItem;
} & (
  | { kind: "VOID" | "RECALLED" }
  | { kind: "MOVED"; movedFrom: { tableLabel: string | null; orderNumber: string } }
  | { kind: "HOLD CHANGED"; direction: "added" | "removed" }
  | { kind: "HOLD CANCELLED" }
  | { kind: "TO STATION"; toStation: string; locale: string }
  | { kind: "EXTRA CANCELLED"; held: boolean; cancelledExtra: string; locale: string }
);

const KITCHEN_WORDS = {
  en: { changed: "CHANGED", cancel: "CANCEL:", movedTo: "MOVED TO", from: "From" },
  es: { changed: "CAMBIADO", cancel: "QUITAR:", movedTo: "PASADO A", from: "Viene de" },
} as const;

export type KitchenCrossRef =
  | { kind: "with"; name: string; stationName: string }
  | { kind: "for"; name: string; stationName: string | null };

/** Station names print as stored; Spanish locales use Spanish connector words. */
export function crossRefText(ref: KitchenCrossRef, locale: string): string {
  const spanish = ticketLanguage(locale) === "es";
  if (ref.kind === "with")
    return `${spanish ? "con" : "with"} ${ref.name} ${spanish ? "de" : "from"} ${ref.stationName}`;
  if (ref.stationName === null)
    return `${spanish ? "para" : "for"} ${ref.name}, ${spanish ? "sin preparación" : "no preparation"}`;
  return `${spanish ? "para" : "for"} ${ref.name} ${spanish ? "en" : "at"} ${ref.stationName}`;
}

const ALSO_ON_ORDER_WORDS = {
  en: { heading: "Also on this order (not for this station)", held: "(on hold)" },
  es: { heading: "También en este pedido (no para esta estación)", held: "(en espera)" },
} as const;

function ticketLanguage(locale: string): "en" | "es" {
  return locale.split("-")[0]!.toLowerCase() === "es" ? "es" : "en";
}

function alsoOnOrderWords(locale: string) {
  return ALSO_ON_ORDER_WORDS[ticketLanguage(locale)];
}

function kitchenWords(locale: string) {
  return KITCHEN_WORDS[ticketLanguage(locale)];
}

function slipHeader(slip: CorrectionSlip): string {
  if (slip.kind === "TO STATION")
    return `${kitchenWords(slip.locale).movedTo} ${slip.toStation.toLocaleUpperCase(slip.locale)}`;
  if (slip.kind !== "EXTRA CANCELLED") return slip.kind;
  const { changed } = kitchenWords(slip.locale);
  return slip.held ? `HOLD ${changed}` : changed;
}

/**
 * Prints the item through {@link emitItem}, as a ticket does; a HOLD CHANGED slip prefixes it with
 * + or -.
 */
export function formatCorrectionSlip(slip: CorrectionSlip, layout: EscSetting): Uint8Array {
  const b = esc(layout).init();
  const { columns } = b.grid;
  const text = (s: string): void => {
    for (const line of wrapText(prepareText(s), columns)) b.line(line);
  };

  text(`*** ${slipHeader(slip)} ***`);
  text(slip.stationName);
  if (slip.kind === "MOVED") {
    const { movedFrom } = slip;
    text(`${movedFrom.tableLabel ?? "-"} -> ${slip.tableLabel ?? "-"}`);
    text(
      movedFrom.orderNumber === slip.orderNumber
        ? slip.orderNumber
        : `${movedFrom.orderNumber} -> ${slip.orderNumber}`,
    );
  } else {
    if (slip.tableLabel !== null) text(slip.tableLabel);
    text(slip.orderNumber);
  }
  b.line(hhmm(new Date(slip.at)));
  if (slip.item.group !== undefined) b.line(`GROUP ${slip.item.group}`);
  const sign = slip.kind !== "HOLD CHANGED" ? "" : slip.direction === "added" ? "+" : "-";
  emitItem(b, slip.item, columns, sign);
  if (slip.kind === "EXTRA CANCELLED") {
    const prefix = `  ${kitchenWords(slip.locale).cancel} `;
    for (const line of wrapText(
      prepareText(`${prefix}${slip.cancelledExtra}`),
      columns,
      prefix.length,
    )) {
      b.line(line);
    }
  }

  return b.feedAndCut().bytes();
}
