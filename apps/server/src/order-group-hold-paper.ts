import {
  type Transaction,
  workingOrderLines,
  ticketItems,
  workingOrders,
  kitchenStations,
  orderGroups,
  nowIso,
  orderGroupHoldStations,
} from "@waitron/db";
import { eq, and, isNull, asc, inArray, isNotNull } from "drizzle-orm";
import { dishKitchenItems, onDishesOrTheirExtras } from "./dish-kitchen.js";
import {
  type FiredItem,
  enqueueKitchenTickets,
  inIds,
  type HoldCorrection,
  enqueueHoldCorrections,
  printerMappings,
  firedQuantity,
} from "./kitchen-print.js";
import { heldPaperReach } from "./station-move.js";
import type { TradingContext } from "./trading-context.js";

/**
 * Print a HOLD ticket for each of these held groups at the stations that print held work in
 * advance: its held kitchen items there, bill by bill in the order the bills were opened, as a fire
 * prints them. A group records when its ticket was queued for a printer, and the stations the jobs
 * carried; with none, it fires with an ordinary ticket.
 */
export async function printHoldTickets(
  tx: Transaction,
  cfg: TradingContext,
  groupIds: readonly string[],
): Promise<void> {
  for (const groupId of groupIds) {
    const items = await tx
      .select({
        workingOrderId: workingOrderLines.workingOrderId,
        workingOrderLineId: ticketItems.workingOrderLineId,
        stationId: ticketItems.stationId,
        quantity: ticketItems.quantity,
      })
      .from(ticketItems)
      .innerJoin(workingOrderLines, eq(workingOrderLines.id, ticketItems.workingOrderLineId))
      .innerJoin(workingOrders, eq(workingOrders.id, workingOrderLines.workingOrderId))
      .innerJoin(kitchenStations, eq(kitchenStations.id, ticketItems.stationId))
      .where(
        and(
          eq(workingOrderLines.groupId, groupId),
          isNull(ticketItems.firedAt),
          eq(kitchenStations.printHeldWork, true),
        ),
      )
      .orderBy(asc(workingOrders.orderNumber), asc(workingOrderLines.lineNo));
    const byBill = new Map<string, FiredItem[]>();
    for (const { workingOrderId, ...item } of items) {
      byBill.set(workingOrderId, [...(byBill.get(workingOrderId) ?? []), item]);
    }
    const carried = new Set<string>();
    for (const [orderId, bill] of byBill) {
      for (const stationId of await enqueueKitchenTickets(tx, cfg, orderId, bill, {
        mark: "HOLD",
      }))
        carried.add(stationId);
    }
    if (carried.size > 0) {
      await recordHeldPaper(tx, groupId, carried);
      await tx
        .update(orderGroups)
        .set({ holdPrintedAt: nowIso() })
        .where(eq(orderGroups.id, groupId));
    }
  }
}
/** Records that these stations have the group's HOLD paper. */
export async function recordHeldPaper(
  tx: Transaction,
  groupId: string,
  stationIds: ReadonlySet<string>,
): Promise<void> {
  await tx
    .insert(orderGroupHoldStations)
    .values([...stationIds].map((stationId) => ({ groupId, stationId })))
    .onConflictDoNothing({
      target: [orderGroupHoldStations.groupId, orderGroupHoldStations.stationId],
    });
}
/** The stations recorded as having each group's HOLD paper; a group with none is absent. */
export async function heldPaperStations(
  tx: Transaction,
  groupIds: readonly string[],
): Promise<Map<string, ReadonlySet<string>>> {
  if (groupIds.length === 0) return new Map();
  const rows = await tx
    .select({
      groupId: orderGroupHoldStations.groupId,
      stationId: orderGroupHoldStations.stationId,
    })
    .from(orderGroupHoldStations)
    .where(inIds(orderGroupHoldStations.groupId, groupIds));
  const byGroup = new Map<string, Set<string>>();
  for (const row of rows) {
    const stations = byGroup.get(row.groupId) ?? new Set<string>();
    stations.add(row.stationId);
    byGroup.set(row.groupId, stations);
  }
  return byGroup;
}
/**
 * Paper numbers of held groups with `holdPrintedAt` set; a held copy takes that time from its source
 * but has its own number.
 */
export async function printedHeldGroups(
  tx: Transaction,
  groupIds: readonly string[],
): Promise<Map<string, number>> {
  if (groupIds.length === 0) return new Map();
  const rows = await tx
    .select({ id: orderGroups.id, displayNumber: orderGroups.displayNumber })
    .from(orderGroups)
    .where(
      and(
        inArray(orderGroups.id, [...new Set(groupIds)]),
        eq(orderGroups.state, "held"),
        isNotNull(orderGroups.holdPrintedAt),
      ),
    );
  return new Map(rows.map((row) => [row.id, row.displayNumber]));
}
/** An unfired kitchen item as {@link holdPaperFor} judges it. */
export interface HoldPaperItem {
  stationId: string | null;
  requestedAt: string | null;
  firedAt: string | null;
}

export interface HoldPaper {
  (groupId: string, item: HoldPaperItem): number | undefined;
  /** Whether the group has HOLD paper that any item could be corrected on. */
  has(groupId: string): boolean;
}
/**
 * The HOLD paper number an unfired item is corrected under, or undefined for none (plan D56). A
 * held group whose HOLD ticket printed corrects every unfired item; a fired group corrects only a
 * Requested item at a station recorded as having the group's HOLD paper. A legacy-recalled item
 * (neither stamp) in a fired group is corrected nowhere.
 */
export async function holdPaperFor(
  tx: Transaction,
  groupIds: readonly string[],
): Promise<HoldPaper> {
  if (groupIds.length === 0) return Object.assign(() => undefined, { has: () => false });
  const ids = [...new Set(groupIds)];
  const rows = await tx
    .select({
      id: orderGroups.id,
      state: orderGroups.state,
      displayNumber: orderGroups.displayNumber,
      holdPrintedAt: orderGroups.holdPrintedAt,
    })
    .from(orderGroups)
    .where(inArray(orderGroups.id, ids));
  const groups = new Map(rows.map((row) => [row.id, row]));
  const paper = await heldPaperStations(
    tx,
    rows.filter((row) => row.state === "fired").map((row) => row.id),
  );
  const judge = (groupId: string, item: HoldPaperItem) => {
    const group = groups.get(groupId);
    if (group === undefined || item.firedAt !== null) return undefined;
    if (group.state === "held")
      return group.holdPrintedAt === null ? undefined : group.displayNumber;
    if (group.state !== "fired" || item.requestedAt === null || item.stationId === null)
      return undefined;
    return paper.get(groupId)?.has(item.stationId) === true ? group.displayNumber : undefined;
  };
  return Object.assign(judge, {
    has: (groupId: string) => {
      const group = groups.get(groupId);
      if (group?.state === "held") return group.holdPrintedAt !== null;
      return group?.state === "fired" && (paper.get(groupId)?.size ?? 0) > 0;
    },
  });
}
/** Changed unfired work on HOLD paper ({@link holdPaperFor}), identified by its permanent group number. */
export interface HeldChange {
  workingOrderId: string;
  workingOrderLineId: string;
  stationId: string;
  quantity: number;
  /** The group whose HOLD ticket is corrected. */
  groupId?: string;
  group?: number;
  numberPartyLabel?: string;
}
/** Record and print a HOLD correction for each change, bill by bill. */
export async function correctHoldTickets(
  tx: Transaction,
  cfg: TradingContext,
  changes: readonly HeldChange[],
  correction: HoldCorrection,
): Promise<void> {
  const byBill = new Map<string, HeldChange[]>();
  for (const change of changes) {
    byBill.set(change.workingOrderId, [...(byBill.get(change.workingOrderId) ?? []), change]);
  }
  for (const [orderId, bill] of byBill) {
    await enqueueHoldCorrections(
      tx,
      cfg,
      orderId,
      bill.map(({ workingOrderLineId, stationId, quantity, groupId, group, numberPartyLabel }) => ({
        workingOrderLineId,
        stationId,
        quantity,
        wasStarted: false,
        holdGroupId: groupId,
        group,
        ...(numberPartyLabel === undefined ? {} : { numberPartyLabel }),
      })),
      correction,
    );
  }
}
/**
 * Records the stations that get the group's HOLD paper for this arriving unfired work on HOLD paper under
 * {@link heldPaperReach} and have a printer to print it. Runs before the `+N` is printed, which
 * reaches only recorded stations.
 */
export async function recordJoiningStations(
  tx: Transaction,
  arriving: readonly (HeldChange & { groupId: string })[],
): Promise<void> {
  const reach = await heldPaperReach(
    tx,
    arriving,
    arriving.map((change) => change.workingOrderLineId),
  );
  const fresh = [...reach].flatMap(([groupId, stations]) =>
    [...stations].flatMap(([stationId, recorded]) => (recorded ? [] : [{ groupId, stationId }])),
  );
  if (fresh.length === 0) return;
  const withPrinter = new Set(
    (await printerMappings(tx, [...new Set(fresh.map((f) => f.stationId))])).map(
      (mapping) => mapping.stationId,
    ),
  );
  for (const { groupId, stationId } of fresh)
    if (withPrinter.has(stationId)) await recordHeldPaper(tx, groupId, new Set([stationId]));
}
/** All held kitchen records of each named dish and its split-off extras. */
export async function heldItemsOf(
  tx: Transaction,
  lineIds: readonly string[],
): ReturnType<typeof dishKitchenItems> {
  const items = await dishKitchenItems(tx, lineIds);
  return new Map(
    [...items].map(([lineId, records]) => [
      lineId,
      records.filter((record) => record.firedAt === null),
    ]),
  );
}
/**
 * `+N` for dish lines that just joined each group, at the stations that have its HOLD paper
 * ({@link recordJoiningStations}), for each item {@link holdPaperFor} corrects there. The paper is
 * read once for every join: recording a joining station never changes its answers, since a held
 * group's do not depend on stations and a fired group's take only items at stations already
 * recorded.
 */
export async function correctJoin(
  tx: Transaction,
  cfg: TradingContext,
  joins: readonly { groupId: string; lineIds: readonly string[] }[],
): Promise<void> {
  const holdPaper = await holdPaperFor(
    tx,
    joins.map((join) => join.groupId),
  );
  for (const { groupId, lineIds } of joins) {
    if (!holdPaper.has(groupId)) continue;
    const joined = await tx
      .select({
        workingOrderId: workingOrderLines.workingOrderId,
        workingOrderLineId: ticketItems.workingOrderLineId,
        stationId: ticketItems.stationId,
        quantity: firedQuantity,
        requestedAt: ticketItems.requestedAt,
        firedAt: ticketItems.firedAt,
        madeHere: ticketItems.madeHere,
      })
      .from(ticketItems)
      .innerJoin(workingOrderLines, eq(workingOrderLines.id, ticketItems.workingOrderLineId))
      .where(onDishesOrTheirExtras(tx, lineIds))
      .orderBy(asc(workingOrderLines.lineNo));
    const changes = joined.flatMap((item) => {
      const group = holdPaper(groupId, item);
      return group === undefined ? [] : [{ ...item, groupId, group }];
    });
    if (changes.length === 0) continue;
    // Made-here work is fired at once and gets no slip, so it never puts a station on paper.
    await recordJoiningStations(
      tx,
      changes.filter((change) => change.firedAt === null && !change.madeHere),
    );
    await correctHoldTickets(tx, cfg, changes, { kind: "HOLD CHANGED", direction: "added" });
  }
}
