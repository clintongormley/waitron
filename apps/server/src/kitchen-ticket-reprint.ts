import { type Transaction, workingOrderLines, ticketItems } from "@waitron/db";
import { eq, and, isNotNull, isNull } from "drizzle-orm";
import { inIds } from "./in-ids.js";
import { enqueueKitchenJobs } from "./kitchen-ticket-enqueue.js";
import { type FiredItem, readStations } from "./kitchen-ticket-items.js";
import { readOnHoldTickets, onHeldPaper, readWaitingOnHoldPaper } from "./kitchen-ticket-paper.js";
import {
  mappingsByStation,
  routeKitchenTickets,
  type KnownStations,
  planKitchenTickets,
  type PaperRest,
} from "./kitchen-ticket-plan.js";
import { printerMappings } from "./kitchen-ticket-printers.js";
import { joinKitchenTickets } from "./kitchen-ticket.js";
import type { TradingContext } from "./trading-context.js";

interface ReprintPart {
  items: FiredItem[];
  mark?: "HOLD";
}
/**
 * What a Reprint of each of `orderIds` prints: every fired item across every round, and the held
 * items on recorded HOLD paper, including those waiting for the pass, marked HOLD.
 */
async function readReprintParts(
  tx: Transaction,
  orderIds: readonly string[],
): Promise<Map<string, readonly [fired: ReprintPart, held: ReprintPart]>> {
  const fired = await tx
    .select({
      workingOrderId: workingOrderLines.workingOrderId,
      workingOrderLineId: ticketItems.workingOrderLineId,
      stationId: ticketItems.stationId,
      quantity: ticketItems.quantity,
      sentAt: ticketItems.firedAt,
    })
    .from(ticketItems)
    .innerJoin(workingOrderLines, eq(workingOrderLines.id, ticketItems.workingOrderLineId))
    .where(
      and(
        inIds(workingOrderLines.workingOrderId, orderIds),
        isNotNull(ticketItems.firedAt),
        eq(ticketItems.madeHere, false),
      ),
    );
  const onHold = await readOnHoldTickets(tx, orderIds);
  const onPaper = await onHeldPaper(tx, onHold);
  const held = [...onHold.filter(onPaper), ...(await readWaitingOnHoldPaper(tx, orderIds))].map(
    ({ holdPrintedAt, ...item }) => ({
      ...item,
      sentAt: holdPrintedAt,
    }),
  );
  const counterHold = await tx
    .select({
      workingOrderId: workingOrderLines.workingOrderId,
      workingOrderLineId: ticketItems.workingOrderLineId,
      stationId: ticketItems.stationId,
      quantity: ticketItems.quantity,
      sentAt: ticketItems.queuedAt,
    })
    .from(ticketItems)
    .innerJoin(workingOrderLines, eq(workingOrderLines.id, ticketItems.workingOrderLineId))
    .where(
      and(
        inIds(workingOrderLines.workingOrderId, orderIds),
        isNull(workingOrderLines.groupId),
        isNull(ticketItems.firedAt),
        isNotNull(ticketItems.requestedAt),
        eq(ticketItems.holdPaperQueued, true),
      ),
    );
  const byOrder = (
    rows: readonly (Omit<FiredItem, "sentAt"> & {
      workingOrderId: string;
      sentAt: string | null;
    })[],
  ) => {
    const items = new Map<string, FiredItem[]>(orderIds.map((id) => [id, []]));
    for (const { workingOrderId, workingOrderLineId, stationId, quantity, sentAt } of rows) {
      items.get(workingOrderId)!.push({ workingOrderLineId, stationId, quantity, sentAt: sentAt! });
    }
    return items;
  };
  const firedByOrder = byOrder(fired);
  const heldByOrder = byOrder([...held, ...counterHold]);
  return new Map(
    orderIds.map((id) => {
      const firedItems = firedByOrder.get(id)!;
      const heldItems = heldByOrder.get(id)!;
      const parts = [{ items: firedItems }, { items: heldItems, mark: "HOLD" }] as const;
      return [id, parts];
    }),
  );
}
/**
 * Each of `orderIds`' `printer|station` pairs a Reprint of it would link a ticket to were every
 * printer switched on ({@link readReprintParts}, {@link routeKitchenTickets}).
 */
export async function readReprintTargets(
  tx: Transaction,
  orderIds: readonly string[],
): Promise<Map<string, Set<string>>> {
  const partsByOrder = await readReprintParts(tx, orderIds);
  const stationIds = new Set<string>();
  for (const parts of partsByOrder.values()) {
    for (const part of parts) for (const item of part.items) stationIds.add(item.stationId);
  }
  // A switched-off printer's failed ticket still names unprinted dishes: once it is back on, a
  // Reprint prints them there.
  const mappings = mappingsByStation(
    stationIds.size === 0
      ? []
      : await printerMappings(tx, [...stationIds], { switchedOffToo: true }),
  );
  const targets = new Map<string, Set<string>>();
  for (const [orderId, parts] of partsByOrder) {
    const pairs = new Set<string>();
    for (const part of parts) {
      const involved = [...new Set(part.items.map((item) => item.stationId))];
      for (const route of routeKitchenTickets(involved, mappings)) {
        for (const printer of route.printers) {
          for (const stationId of route.stationIds) pairs.add(`${printer.printerId}|${stationId}`);
        }
      }
    }
    targets.set(orderId, pairs);
  }
  return targets;
}
/**
 * Reprint an order's kitchen tickets ({@link readReprintParts}). Each ticket's heading carries the
 * reprint time, read once for the whole reprint, and its time line keeps the earliest time its
 * dishes were sent ({@link FiredItem.sentAt}). Fired and HOLD sections for one
 * printer go as one job, cut once, linked to every station either carries, whatever stations each
 * covers; for a station printer, separate jobs could clear an earlier failure for dishes the later
 * section does not carry ({@link readPrintProblems}). It changes no line, ticket item or group event. An
 * order with nothing to print is a no-op.
 */
export async function reprintOrderTickets(
  tx: Transaction,
  cfg: TradingContext,
  orderId: string,
): Promise<void> {
  const [fired, held] = (await readReprintParts(tx, [orderId])).get(orderId)!;
  const firedStations = new Set(fired.items.map((item) => item.stationId));
  const heldStations = new Set(held.items.map((item) => item.stationId));
  const stationIds = [...new Set([...firedStations, ...heldStations])];
  if (stationIds.length === 0) return;
  const known: KnownStations = {
    mappings: await printerMappings(tx, stationIds),
    stations: await readStations(tx, stationIds),
  };
  const papers = joinedPapers(firedStations, heldStations, known);
  const reprintedAt = new Date();
  const jobs = await planKitchenTickets(tx, cfg, orderId, fired.items, {
    reprint: true,
    reprintedAt,
    papers,
    known,
  });
  const holdJobs = await planKitchenTickets(tx, cfg, orderId, held.items, {
    reprint: true,
    reprintedAt,
    mark: held.mark,
    known,
    papers: new Map(
      [...papers].map(([printerId, paper]) => [printerId, { ...paper, shows: false }]),
    ),
  });
  for (const hold of holdJobs) {
    const same = jobs.find((job) => job.printerId === hold.printerId);
    if (same === undefined) {
      jobs.push(hold);
      continue;
    }
    same.bytes = joinKitchenTickets(same.bytes, hold.bytes);
    same.stationIds = [...new Set([...same.stationIds, ...hold.stationIds])];
    same.lineIds = [...new Set([...same.lineIds, ...hold.lineIds])];
  }
  await enqueueKitchenJobs(tx, orderId, jobs, true);
}
/**
 * Each station printer a reprint gives both fired and held work, as one paper: the rest of the order
 * prints once, on its fired part, and lists dishes at stations on neither part. It prints when a
 * station of the fired part shows it, or a station of the held part does and no held station there
 * has fired work.
 */
function joinedPapers(
  firedStations: ReadonlySet<string>,
  heldStations: ReadonlySet<string>,
  { mappings, stations }: KnownStations,
): Map<string, PaperRest> {
  const papers = new Map<string, PaperRest>();
  if (firedStations.size === 0 || heldStations.size === 0) return papers;
  const shows = (id: string) => stations.get(id)!.showsRestOfOrder;
  const byPrinter = new Map<string, { fired: string[]; held: string[] }>();
  for (const { printerId, stationId } of mappings) {
    const paper = byPrinter.get(printerId) ?? { fired: [], held: [] };
    if (firedStations.has(stationId)) paper.fired.push(stationId);
    if (heldStations.has(stationId)) paper.held.push(stationId);
    byPrinter.set(printerId, paper);
  }
  for (const [printerId, { fired, held }] of byPrinter) {
    if (fired.length === 0 || held.length === 0) continue;
    papers.set(printerId, {
      stationIds: [...new Set([...fired, ...held])],
      shows: fired.some(shows) || (held.some(shows) && !held.some((id) => firedStations.has(id))),
    });
  }
  return papers;
}
