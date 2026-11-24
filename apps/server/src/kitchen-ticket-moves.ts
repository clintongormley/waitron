import {
  type Transaction,
  workingOrderLines,
  ticketItems,
  workingOrders,
  readVenueClock,
  orderGroups,
  tableNames,
  parties,
  partyTables,
  diningTables,
} from "@waitron/db";
import { enqueuePrintJob } from "@waitron/printing";
import { partyTablesName } from "@waitron/shared";
import { kitchenNotices } from "@waitron/venue-service";
import { eq, inArray, and, sql } from "drizzle-orm";
import { readKitchenLanguage } from "./kitchen-language.js";
import { toNoticeItem, type CorrectionItem } from "./kitchen-ticket-corrections.js";
import {
  buildTicketItems,
  readStations,
  changeItem,
  byGroupThenLine,
} from "./kitchen-ticket-items.js";
import { type SentWork, onHeldPaper } from "./kitchen-ticket-paper.js";
import { type MappingsByStation, mappingsByStation } from "./kitchen-ticket-plan.js";
import { printerMappings, groupByLayout } from "./kitchen-ticket-printers.js";
import { type TicketState, firedQuantity, isStarted } from "./kitchen-ticket-state.js";
import {
  movedPlaceText,
  type MovedSlip,
  arrangeTicketItems,
  formatMovedSlip,
} from "./kitchen-ticket.js";
import { VENUE_SERVICE } from "./modules.js";
import { readOrderKitchenNotes } from "./order-kitchen-note.js";
import { readPlacedOrders, type OrderPlaces, type PlacedOrder } from "./order-places.js";
import type { TradingContext } from "./trading-context.js";

/**
 * Tell the kitchen of sent work that moved; nothing when `before` is null. When the kitchen is to
 * be told ({@link kitchenToBeTold}), each of `before`'s items on paper now on `toOrderId` gets a
 * `moved` notice, at the quantity its ticket asks for, and each station with an active printer that
 * prints MOVED slips ({@link readMovedSlipPrinting}) gets one listing those items.
 */
export async function enqueueMovedSlips(
  tx: Transaction,
  cfg: TradingContext,
  before: SentWork | null,
  toOrderId: string,
): Promise<void> {
  await enqueueMovedSlipsOnto(tx, cfg, toOrderId, [before]);
}
/**
 * {@link enqueueMovedSlips} for several `sources` now on one order, one slip per source per
 * station, reading the order and what the slips print with once.
 */
export async function enqueueMovedSlipsOnto(
  tx: Transaction,
  cfg: TradingContext,
  toOrderId: string,
  sources: readonly (SentWork | null)[],
): Promise<void> {
  const sent = sources.filter((before) => before !== null);
  if (sent.length === 0) return;
  const after = (await readPlacedOrders(tx, [toOrderId])).get(toOrderId)!;
  const told = sent.filter((before) => kitchenToBeTold(before, after.places));
  if (told.length === 0) return;
  const onOrder = (await readTicketItemsOn(tx, [toOrderId])).get(toOrderId) ?? [];
  await notifyMoved(
    tx,
    cfg,
    told.map((before) => ({ before, to: toOrderId, after, onOrder })),
  );
}
/**
 * Whether the kitchen is told of `before`'s work now on an order at `after`: the order lost a place
 * ({@link lostAPlace}), or the work is on an order with another number.
 */
function kitchenToBeTold(before: SentWork, after: OrderPlaces): boolean {
  return lostAPlace(before.places, after) || after.orderNumber !== before.places.orderNumber;
}
/**
 * Whether the order left one of `before`'s tables, or a place name its kitchen paper carries (the
 * counter among them) is no longer one of its places.
 */
function lostAPlace(before: OrderPlaces, after: OrderPlaces): boolean {
  const tables = new Set(after.tables.map((table) => table.id));
  const names = new Set(after.names);
  return (
    before.tables.some((table) => !tables.has(table.id)) ||
    (before.counter && !after.counter) ||
    before.names.some((name) => !names.has(name))
  );
}
/**
 * The slip's From and To. When the two read the same but the tables differ (one table of a named
 * group to another), each side adds its own tables in brackets.
 */
function movedTexts(
  before: OrderPlaces,
  after: OrderPlaces,
  locale: string,
): { fromText: string; toText: string } {
  const fromText = movedPlaceText(before, locale);
  const toText = movedPlaceText(after, locale);
  const afterIds = new Set(after.tables.map((table) => table.id));
  const sameTables =
    afterIds.size === before.tables.length && before.tables.every((t) => afterIds.has(t.id));
  if (fromText !== toText || sameTables) return { fromText, toText };
  const tables = (places: OrderPlaces) =>
    ` (${partyTablesName(places.tables.map((table) => table.name))})`;
  return { fromText: fromText + tables(before), toText: toText + tables(after) };
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
      orderId: workingOrderLines.workingOrderId,
      id: ticketItems.id,
      workingOrderLineId: ticketItems.workingOrderLineId,
      stationId: ticketItems.stationId,
      state: ticketItems.state,
      quantity: firedQuantity,
      madeHere: ticketItems.madeHere,
    })
    .from(ticketItems)
    .innerJoin(workingOrderLines, eq(workingOrderLines.id, ticketItems.workingOrderLineId))
    .where(inArray(workingOrderLines.workingOrderId, [...orderIds]))
    .orderBy(workingOrderLines.lineNo, ticketItems.id);
  const byOrder = new Map<string, ItemOnOrder[]>();
  for (const { orderId, ...item } of rows) {
    const items = byOrder.get(orderId) ?? [];
    items.push(item);
    byOrder.set(orderId, items);
  }
  return byOrder;
}
/** Sent work now on the order `to`, at `after`, whose ticket items `onOrder` are. */
interface MovedWork {
  before: SentWork;
  to: string;
  after: PlacedOrder;
  onOrder: readonly ItemOnOrder[];
}
/**
 * The `moved` notices and MOVED slips for each of `moves`, which the kitchen is to be told of, in
 * turn. A bill now of no party takes the name of the party it left.
 */
async function notifyMoved(
  tx: Transaction,
  cfg: TradingContext,
  moves: readonly MovedWork[],
): Promise<void> {
  const told = moves.flatMap((move) => {
    const items = movedItems(move);
    return items.length === 0 ? [] : [{ ...move, items }];
  });
  if (told.length === 0) return;
  const onPaper = await onHeldPaper(
    tx,
    told.flatMap((move) => move.items.filter((item) => item.held)),
  );
  const printable = (items: readonly MovedItem[]) =>
    items.filter((item) => !item.held || onPaper(item));
  const toPrint = told.flatMap((move) => printable(move.items));
  const printing = toPrint.length === 0 ? null : await readMovedSlipPrinting(tx, cfg, toPrint);
  const kitchenNotes = await readOrderKitchenNotes(
    tx,
    printing === null ? [] : [...new Set(told.map((move) => move.to))],
  );
  const takenAway = new Set(
    printing === null
      ? []
      : (
          await tx
            .select({ id: workingOrders.id })
            .from(workingOrders)
            .where(
              and(
                inArray(workingOrders.id, [...new Set(told.map((move) => move.to))]),
                eq(workingOrders.dining, "takeaway"),
              ),
            )
        ).map(({ id }) => id),
  );
  for (const { before, to, after, items } of told) {
    const texts = movedTexts(before.places, after.places, printing?.language ?? cfg.locale);
    // The station screen words the counter itself, in the screen's own language.
    await VENUE_SERVICE.recordKitchenNotices(tx, to, items.map(toNoticeItem), "moved", {
      movedTo: after.places.counter ? null : texts.toText,
      fromNumber: before.places.orderNumber,
    });
    const slipItems = printable(items);
    if (printing === null || slipItems.length === 0) continue;
    const partyName = after.partyId === null ? before.places.partyName : after.sittingWith;
    const toNumber = after.places.orderNumber;
    await printMovedSlips(tx, printing, slipItems, {
      kitchenNote:
        kitchenNotes.get(to)!.note === null
          ? undefined
          : { text: kitchenNotes.get(to)!.note!, locale: printing.language },
      fromNumber: String(before.places.orderNumber),
      ...(toNumber === before.places.orderNumber ? {} : { toNumber: String(toNumber) }),
      ...(partyName === null ? {} : { partyName }),
      ...texts,
      takeAway: takenAway.has(to),
    });
  }
}
/** The items of `move.before` on paper that are now on its order, excluding those made here. */
function movedItems({ before, onOrder }: MovedWork): MovedItem[] {
  return onOrder.flatMap((item) => {
    if (item.madeHere || !before.ticketItemIds.has(item.id)) return [];
    return {
      workingOrderLineId: item.workingOrderLineId,
      stationId: item.stationId!,
      quantity: item.quantity,
      wasStarted: isStarted(item.state),
      held: before.heldItemIds.has(item.id),
    };
  });
}
/** A dish a MOVED slip lists; `held` when it is on a HOLD ticket rather than fired. */
type MovedItem = CorrectionItem & { held: boolean };
/** What MOVED slips print with: their stations' printers and stations, their lines. */
interface MovedSlipPrinting {
  language: string;
  byStation: MappingsByStation;
  itemsByLine: Awaited<ReturnType<typeof buildTicketItems>>;
  stationNames: Awaited<ReturnType<typeof readStations>>;
}
/**
 * {@link MovedSlipPrinting} for every slip of `items`, read once, keeping only the stations whose
 * own choice prints MOVED slips. Null when no station prints.
 */
async function readMovedSlipPrinting(
  tx: Transaction,
  cfg: TradingContext,
  items: readonly MovedItem[],
): Promise<MovedSlipPrinting | null> {
  const stationIds = [...new Set(items.map((item) => item.stationId))];
  const withPrinters = mappingsByStation(await printerMappings(tx, stationIds));
  if (withPrinters.size === 0) return null;
  const stationNames = await readStations(tx, stationIds);
  const byStation: MappingsByStation = new Map(
    [...withPrinters].filter(([id]) => stationNames.get(id)!.printMovedSlips),
  );
  if (byStation.size === 0) return null;
  const language = await readKitchenLanguage(tx);
  const itemsByLine = await buildTicketItems(
    tx,
    cfg,
    [...new Set(items.map((item) => item.workingOrderLineId))],
    language,
  );
  return { byStation, itemsByLine, stationNames, language };
}
/**
 * One MOVED slip per station of `items`, to its printers, listing its fired items and its held
 * ones under HOLD, group by group.
 */
async function printMovedSlips(
  tx: Transaction,
  { byStation, itemsByLine, stationNames, language }: MovedSlipPrinting,
  items: readonly MovedItem[],
  slip: Pick<
    MovedSlip,
    "fromNumber" | "toNumber" | "partyName" | "fromText" | "toText" | "kitchenNote" | "takeAway"
  >,
): Promise<void> {
  const stationIds = [...new Set(items.map((item) => item.stationId))];
  const at = new Date().toISOString();
  const { timeZone } = await readVenueClock(tx);

  for (const stationId of stationIds) {
    const targets = byStation.get(stationId);
    if (targets === undefined) continue;
    const listed = items
      .filter((item) => item.stationId === stationId)
      .map((target) => {
        const entry = itemsByLine.get(target.workingOrderLineId)!;
        const item = changeItem(entry.item, target);
        return {
          held: target.held && entry.group !== null,
          lineNo: entry.lineNo,
          position: entry.position,
          item: entry.group === null ? item : { ...item, group: entry.group },
        };
      })
      .sort(byGroupThenLine);
    const { ticketGrouping } = stationNames.get(stationId)!;
    const held: MovedSlip["held"] = [];
    for (const { item } of listed.filter((entry) => entry.held)) {
      const last = held.at(-1);
      if (
        last !== undefined &&
        last.items[0]?.groupId === item.groupId &&
        last.group === item.group
      )
        last.items.push(item);
      else held.push({ group: item.group!, items: [item] });
    }
    for (const group of held) group.items = arrangeTicketItems(group.items, ticketGrouping);
    const mainItems = arrangeTicketItems(
      listed.filter((entry) => !entry.held).map((entry) => entry.item),
      ticketGrouping,
    );
    for (const group of groupByLayout(targets)) {
      const bytes = formatMovedSlip(
        {
          ...slip,
          stationName: stationNames.get(stationId)!.name,
          at,
          items: mainItems,
          held,
          locale: language,
        },
        group[0]!,
        timeZone,
      );
      for (const printer of group) {
        await enqueuePrintJob(tx, printer.printerId, bytes, "document");
      }
    }
  }
}
/**
 * {@link enqueueMovedSlips} for each bill `before` read, onto the bill itself, reading every
 * bill's places and ticket items, and what the slips print with, once.
 */
export async function enqueueMovedSlipsFor(
  tx: Transaction,
  cfg: TradingContext,
  before: ReadonlyMap<string, SentWork>,
): Promise<void> {
  await notifyOwnBillsWhere(tx, cfg, before, (work, after) =>
    kitchenToBeTold(work, after) ? work : null,
  );
}
/**
 * The names on each sent dish's latest paper, by ticket item, of the tables `before`'s places hold
 * now. That paper is its ticket, or its last MOVED notice, which names its ticket item and station.
 * Print jobs are not read: a station with no printer has none. A paper names the tables the dish's sending party held when it printed
 * ({@link readTablesHeldOverTime}), a table that joined in the same millisecond counting as held and
 * one that left in it counting as gone, because a floor pass can write its slip in the same
 * millisecond as the leave and that slip sends the dish on from that table. A reprint counts for
 * nothing, so a dish reprinted after a join can be told when it need not be. An order with no party
 * or no table keeps its places' names.
 */
export async function readNamesOnPaper(
  tx: Transaction,
  before: ReadonlyMap<string, SentWork>,
  leavingTableId: string,
): Promise<Map<string, ReadonlySet<string>>> {
  if (before.size === 0) return new Map();
  const billIds = [...before.keys()];
  const items = await tx
    .select({
      id: ticketItems.id,
      billId: workingOrderLines.workingOrderId,
      stationId: ticketItems.stationId,
      firedAt: ticketItems.firedAt,
      holdPrintedAt: orderGroups.holdPrintedAt,
      sentParty: orderGroups.numberPartyId,
      billParty: workingOrders.partyId,
      name: workingOrderLines.name,
      kitchenName: workingOrderLines.kitchenName,
      variantName: workingOrderLines.variantName,
      variantKitchenName: workingOrderLines.variantKitchenName,
    })
    .from(ticketItems)
    .innerJoin(workingOrderLines, eq(workingOrderLines.id, ticketItems.workingOrderLineId))
    .innerJoin(workingOrders, eq(workingOrders.id, workingOrderLines.workingOrderId))
    .leftJoin(orderGroups, eq(orderGroups.id, workingOrderLines.groupId))
    .where(inArray(workingOrderLines.workingOrderId, billIds));
  const noticeKey = (ticketItemId: string, stationId: string) =>
    JSON.stringify([ticketItemId, stationId]);
  const lastNotice = new Map<string, number>();
  const notices = await tx
    .select({
      ticketItemId: kitchenNotices.ticketItemId,
      stationId: kitchenNotices.stationId,
      createdAt: kitchenNotices.createdAt,
    })
    .from(kitchenNotices)
    .where(and(eq(kitchenNotices.kind, "moved"), inArray(kitchenNotices.workingOrderId, billIds)));
  for (const { ticketItemId, stationId, createdAt } of notices) {
    if (ticketItemId === null) continue;
    const key = noticeKey(ticketItemId, stationId);
    lastNotice.set(key, Math.max(lastNotice.get(key) ?? 0, Date.parse(createdAt)));
  }
  const tableIds = [
    ...new Set([...before.values()].flatMap((work) => work.places.tables.map((table) => table.id))),
  ];
  const heldAt = await readTablesHeldOverTime(
    tx,
    items.flatMap((item) => item.sentParty ?? item.billParty ?? []),
    tableIds,
    leavingTableId,
  );
  const shown = await tableNames(tx, tableIds);

  const onPaper = new Map<string, ReadonlySet<string>>();
  for (const item of items) {
    const work = before.get(item.billId)!;
    if (!work.ticketItemIds.has(item.id)) continue;
    const sentParty = item.sentParty ?? item.billParty;
    if (sentParty === null || work.places.tables.length === 0) {
      onPaper.set(item.id, new Set(work.places.names));
      continue;
    }
    const printedAt = Math.max(
      Date.parse((item.firedAt ?? item.holdPrintedAt)!),
      lastNotice.get(noticeKey(item.id, item.stationId)) ?? 0,
    );
    const onItsPaper = heldAt(sentParty, printedAt);
    onPaper.set(
      item.id,
      new Set(
        work.places.tables.flatMap((table) =>
          onItsPaper.has(table.id) ? shown.get(table.id)!.shown : [],
        ),
      ),
    );
  }
  return onPaper;
}
/**
 * A reader of which of `tableIds` a party held at a time, in epoch milliseconds, or, after it closed,
 * the next party along its merges. A closed party's rows are gone and only the label of every table
 * it ever held is kept, with no times, so what a paper of its printed cannot be read back. Up to its
 * closing it answers no table when `leavingTableId` is on the list, so the dish is told, because a
 * needless slip costs a line of paper and a missed one can send a plate to the wrong guests; and
 * otherwise all of `tableIds`, so it is not.
 */
async function readTablesHeldOverTime(
  tx: Transaction,
  partyIds: readonly string[],
  tableIds: readonly string[],
  leavingTableId: string,
): Promise<(partyId: string, at: number) => ReadonlySet<string>> {
  const { rows } = await tx.execute<{ id: string }>(sql`
    with recursive chain(id, next) as (
      select id, merged_into_party_id from parties
      where id in (select value from json_each(${JSON.stringify([...new Set(partyIds)])}))
      union
      select p.id, p.merged_into_party_id from parties p join chain c on p.id = c.next
    )
    select id from chain
  `);
  const chainIds = rows.map((row) => row.id);
  const chain = await tx
    .select({
      id: parties.id,
      next: parties.mergedIntoPartyId,
      closedAt: parties.closedAt,
      tableNames: parties.tableNames,
    })
    .from(parties)
    .where(inArray(parties.id, chainIds));
  const partyById = new Map(chain.map((party) => [party.id, party]));
  const seats = await tx
    .select({
      partyId: partyTables.partyId,
      tableId: partyTables.tableId,
      joinedAt: partyTables.joinedAt,
      leftAt: partyTables.leftAt,
    })
    .from(partyTables)
    .where(inArray(partyTables.partyId, chainIds));
  const [leaving] = await tx
    .select({ label: diningTables.label })
    .from(diningTables)
    .where(eq(diningTables.id, leavingTableId));
  return (partyId, at) => {
    const seen = new Set<string>();
    let party = partyById.get(partyId);
    while (party !== undefined && !seen.has(party.id)) {
      seen.add(party.id);
      const { id, closedAt, tableNames } = party;
      if (closedAt === null) {
        return new Set(
          seats
            .filter(
              (seat) =>
                seat.partyId === id &&
                Date.parse(seat.joinedAt) <= at &&
                (seat.leftAt === null || Date.parse(seat.leftAt) > at),
            )
            .map((seat) => seat.tableId),
        );
      }
      if (at < Date.parse(closedAt)) {
        return new Set(tableNames?.includes(leaving!.label) ? [] : tableIds);
      }
      party = party.next === null ? undefined : partyById.get(party.next);
    }
    return new Set();
  };
}
/**
 * {@link enqueueMovedSlipsFor} for the dishes of `before` no name on whose paper
 * ({@link readNamesOnPaper}) is still one of their order's places, so long as the order had a name
 * at all. One slip per order per station, naming only those dishes.
 */
export async function enqueueMovedSlipsForNamesGone(
  tx: Transaction,
  cfg: TradingContext,
  before: ReadonlyMap<string, SentWork>,
  namesOnPaper: ReadonlyMap<string, ReadonlySet<string>>,
): Promise<void> {
  await notifyOwnBillsWhere(tx, cfg, before, (work, after) => {
    if (work.places.names.length === 0) return null;
    const stillThere = (name: string) => after.names.includes(name);
    const gone = [...work.ticketItemIds].filter(
      (id) => ![...namesOnPaper.get(id)!].some(stillThere),
    );
    return gone.length === 0 ? null : { ...work, ticketItemIds: new Set(gone) };
  });
}
/** Tells the kitchen of each bill `before` read, onto the bill itself, of the work `told` picks. */
async function notifyOwnBillsWhere(
  tx: Transaction,
  cfg: TradingContext,
  before: ReadonlyMap<string, SentWork>,
  told: (work: SentWork, after: OrderPlaces) => SentWork | null,
): Promise<void> {
  if (before.size === 0) return;
  const now = await readPlacedOrders(tx, [...before.keys()]);
  const changed = [...before].flatMap(([billId, work]) => {
    const picked = told(work, now.get(billId)!.places);
    return picked === null ? [] : [{ billId, picked }];
  });
  if (changed.length === 0) return;
  const onOrders = await readTicketItemsOn(
    tx,
    changed.map(({ billId }) => billId),
  );
  await notifyMoved(
    tx,
    cfg,
    changed.map(({ billId, picked }) => ({
      before: picked,
      to: billId,
      after: now.get(billId)!,
      onOrder: onOrders.get(billId) ?? [],
    })),
  );
}
