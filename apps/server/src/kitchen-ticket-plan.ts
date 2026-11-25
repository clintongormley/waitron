import { type Transaction, readVenueClock } from "@waitron/db";
import { compareStationNames, stringToThousandths, thousandthsToDecimal } from "@waitron/shared";
import { freezeKitchenAllergyItems } from "./kitchen-allergy.js";
import { readKitchenLanguage } from "./kitchen-language.js";
import {
  readStations,
  type FiredItem,
  buildTicketItems,
  readOrderHeader,
  atFiredQuantity,
  byGroupThenLine,
  ticketName,
} from "./kitchen-ticket-items.js";
import { type PrinterMapping, groupByLayout, printerMappings } from "./kitchen-ticket-printers.js";
import {
  type KitchenTicketItem,
  type KitchenTicketStation,
  arrangeTicketItems,
  formatKitchenTicket,
  type OtherStationItem,
} from "./kitchen-ticket.js";
import { VENUE_SERVICE } from "./modules.js";
import { readOrderKitchenNotes } from "./order-kitchen-note.js";
import { readWholePortionLines } from "./order-portions.js";
import { readRestOfOrder, type RestOfOrderItem } from "./rest-of-order.js";
import type { TradingContext } from "./trading-context.js";
import { passStationsByGroup } from "./working-order-pass-groups.js";

/**
 * A kitchen ticket's printers, all of one layout and each listed by exactly `stationIds` among the
 * send's stations, so they share its bytes.
 */
interface KitchenRoute {
  stationIds: string[];
  printers: PrinterMapping[];
}
/** One kitchen print job: its printer, the stations and lines its paper carries, and its bytes. */
export type KitchenJob = Omit<KitchenRoute, "printers"> & {
  printerId: string;
  lineIds: string[];
  bytes: Uint8Array;
};
/** Each station's printer mappings, in the order of the list they came from. */
export type MappingsByStation = ReadonlyMap<string, readonly PrinterMapping[]>;
export function mappingsByStation(mappings: readonly PrinterMapping[]): MappingsByStation {
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
export function routeKitchenTickets(
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
export interface PaperRest {
  stationIds: readonly string[];
  shows: boolean;
}
/** Live station printer assignments and stations already read for a superset of a plan's stations. */
export interface KnownStations {
  mappings: readonly PrinterMapping[];
  stations: Awaited<ReturnType<typeof readStations>>;
}
export type FirePaper = { heldPaper: ReadonlySet<string> } | { heldLines: ReadonlySet<string> };
export async function planKitchenTickets(
  tx: Transaction,
  cfg: TradingContext,
  orderId: string,
  firedItems: FiredItem[],
  {
    reprint,
    reprintedAt,
    mark,
    fire,
    from,
    papers,
    known,
  }: {
    reprint: boolean;
    reprintedAt?: Date;
    mark?: "HOLD";
    fire?: FirePaper;
    from?: string;
    papers?: ReadonlyMap<string, PaperRest>;
    known?: KnownStations;
  },
): Promise<KitchenJob[]> {
  if (firedItems.length === 0) return [];

  const stationIds = [...new Set(firedItems.map((f) => f.stationId))];

  const mappingRows =
    known === undefined
      ? await printerMappings(tx, stationIds)
      : known.mappings.filter((mapping) => stationIds.includes(mapping.stationId));
  if (mappingRows.length === 0) return [];

  if (!reprint && mark === "HOLD") {
    const receiving = new Set(mappingRows.map((mapping) => mapping.stationId));
    await freezeKitchenAllergyItems(
      tx,
      orderId,
      firedItems.filter((item) => receiving.has(item.stationId)),
    );
  }

  const lineIds = [...new Set(firedItems.map((f) => f.workingOrderLineId))];

  const language = await readKitchenLanguage(tx);
  const { timeZone } = await readVenueClock(tx);
  const itemsByLine = await buildTicketItems(tx, cfg, lineIds, language);
  const passStations =
    mark === "HOLD"
      ? new Map<string, readonly string[]>()
      : await passStationsByGroup(tx, [
          ...new Set([...itemsByLine.values()].flatMap(({ item }) => item.groupId ?? [])),
        ]);
  const stationNames =
    known === undefined
      ? await readStations(tx, stationIds)
      : new Map(stationIds.map((id) => [id, known.stations.get(id)!]));
  const order = await readOrderHeader(tx, orderId);
  const partyName = order.partyName;
  const kitchenNote = (await readOrderKitchenNotes(tx, [orderId])).get(orderId)!.note;

  const itemsByStation = new Map<
    string,
    {
      lineNo: number;
      position: number | null;
      item: KitchenTicketItem;
      fire: boolean;
    }[]
  >();
  for (const fired of firedItems) {
    const entry = itemsByLine.get(fired.workingOrderLineId)!;
    const fresh = atFiredQuantity(entry.item, fired);
    const goesWith =
      fresh.groupId === undefined || entry.passControlled || entry.madeHere
        ? undefined
        : passStations.get(fresh.groupId);
    const item = goesWith === undefined ? fresh : { ...fresh, goesWith };
    const bucket = itemsByStation.get(fired.stationId) ?? [];
    bucket.push({
      lineNo: entry.lineNo,
      position: entry.position,
      item: entry.group === null ? item : { ...item, group: entry.group },
      fire:
        fire !== undefined &&
        ("heldPaper" in fire
          ? fire.heldPaper.has(fired.stationId)
          : fire.heldLines.has(fired.workingOrderLineId)),
    });
    itemsByStation.set(fired.stationId, bucket);
  }

  const stations = [...stationNames.entries()]
    .map(([id, station]) => {
      const lines = itemsByStation.get(id)!.sort(byGroupThenLine);
      const sections: KitchenTicketStation[] = [];
      for (const marked of [false, true]) {
        const items = lines.filter((line) => line.fire === marked).map((line) => line.item);
        if (items.length > 0)
          sections.push({
            stationName: station.name,
            items: arrangeTicketItems(items, station.ticketGrouping),
            ...(marked ? { mark: "FIRE" } : {}),
          });
      }
      return { id, name: station.name, showsRestOfOrder: station.showsRestOfOrder, sections };
    })
    .sort((a, b) => compareStationNames(a.name, b.name));
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
  const restLineIds = [...new Set(rest.map((item) => item.workingOrderLineId))];
  const eachByIdentity = !anyRest
    ? new Set<string>()
    : await VENUE_SERVICE.readLinesSoldInEach(tx, restLineIds);
  const restItems = foldWholePortions(
    rest.map((item) => ({
      stationId: item.stationId,
      workingOrderLineId: item.workingOrderLineId,
      other: {
        qty: item.quantity,
        unit:
          item.unitName === null || eachByIdentity.has(item.workingOrderLineId)
            ? undefined
            : ticketName(item.unitName, cfg.locale),
        name: item.name,
        stationName: item.stationName,
        held: item.held,
      },
    })),
    await readWholePortionLines(tx, restLineIds),
  );
  const head = {
    locale: language,
    kitchenNote: kitchenNote === null ? undefined : { text: kitchenNote, locale: language },
    reprintedAt,
    from: from === undefined ? undefined : { stationName: from, locale: language },
    party: partyName === null ? undefined : { name: partyName, locale: language },
    tableLabel: order.tableLabel ?? "",
    orderNumber: order.orderNumber,
    firedAt: new Date(),
    takeAway: order.takeAway,
  };
  for (const route of routes) {
    const sections = route.stationIds.flatMap((id) => stationById.get(id)!.sections);
    const only = sections.length === 1 ? sections[0]! : undefined;
    const onRoute = firedItems.filter((fired) => route.stationIds.includes(fired.stationId));
    // A reprint prints the earliest of its dishes' send times, compared as times, not as text.
    const firedAt = reprint
      ? new Date(
          onRoute.reduce(
            (earliest, fired) => Math.min(earliest, Date.parse(fired.sentAt!)),
            Infinity,
          ),
        )
      : head.firedAt;
    const render = (leavesOut: readonly string[] | null) =>
      formatKitchenTicket(
        {
          ...head,
          firedAt,
          mark: mark ?? only?.mark,
          ...(only === undefined
            ? { scope: "stations", stations: sections }
            : { scope: "station", stationName: only.stationName, items: only.items }),
          ...(leavesOut !== null
            ? {
                alsoOnOrder: {
                  locale: language,
                  items: restItems
                    .filter((item) => !leavesOut.includes(item.stationId))
                    .map((item) => item.other),
                },
              }
            : {}),
        },
        route.printers[0]!,
        timeZone,
      );
    const bytesByRest = new Map<string, Uint8Array>();
    const lineIds = [...new Set(onRoute.map((fired) => fired.workingOrderLineId))];
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
  return jobs;
}
/**
 * The rest of the order with identical whole portions (`whole`, from {@link readWholePortionLines})
 * printed once, wherever they sit in the list, in the first one's place with their quantities
 * summed. An item that prints a unit stays on its own row, as on a station's own ticket.
 */
function foldWholePortions(
  items: readonly (Pick<RestOfOrderItem, "stationId" | "workingOrderLineId"> & {
    other: OtherStationItem;
  })[],
  whole: ReadonlySet<string>,
): typeof items {
  const out: { item: (typeof items)[number]; thousandths: number }[] = [];
  const byKey = new Map<string, (typeof out)[number]>();
  for (const item of items) {
    const thousandths = stringToThousandths(String(item.other.qty));
    const key =
      whole.has(item.workingOrderLineId) &&
      item.other.unit === undefined &&
      thousandths % 1000 === 0
        ? JSON.stringify([item.stationId, item.other.name, item.other.held])
        : undefined;
    const same = key === undefined ? undefined : byKey.get(key);
    if (same !== undefined) {
      same.thousandths += thousandths;
      continue;
    }
    const entry = { item, thousandths };
    out.push(entry);
    if (key !== undefined) byKey.set(key, entry);
  }
  return out.map(({ item, thousandths }) => ({
    ...item,
    other: { ...item.other, qty: thousandthsToDecimal(thousandths) },
  }));
}
