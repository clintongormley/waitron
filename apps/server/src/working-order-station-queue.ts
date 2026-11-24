import {
  type Transaction,
  workingOrderLines,
  ticketItems,
  kitchenStations,
  products,
  parties,
  orderGroups,
  billPartyTables,
  diningTables,
  workingOrders,
  kitchenCourses,
} from "@waitron/db";
import { effectiveProductColumns, parentProducts, parentJoin } from "@waitron/menu";
import {
  type ProductAllergens,
  type KitchenAllergyBlock,
  type OptionSnapshot,
  type DietProfile,
  type TimingBand,
  type Dining,
  type StationThresholds,
  type BumpMode,
  thousandthsToDecimal,
  perDishOptionQuantity,
  divideDecimal,
  QUANTITY_SCALE,
  kitchenPresentationName,
  expandDietaryDeclarations,
  type DietaryLabel,
  classifyBand,
} from "@waitron/shared";
import { inArray, eq, type SQL, and, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/sqlite-core";
import { readFormerNumbers } from "./former-numbers.js";
import { type KitchenPhase, kitchenPhase } from "./kitchen-phase.js";
import { kitchenWork, firedQuantity, stationOrdersWithPrintProblem } from "./kitchen-print.js";
import { VENUE_SERVICE } from "./modules.js";
import { readGroupNumberLabels } from "./order-groups.js";
import { readOrderKitchenNotes } from "./order-kitchen-note.js";
import { type RestOfOrderItem, readRestOfOrder } from "./rest-of-order.js";
import { type StationQueueMove, readStationQueueMoves } from "./station-queue-moves.js";
import type { WorkingOrderStatus } from "./working-order-context.js";
import { passStationsByGroup } from "./working-order-pass-groups.js";
import type { TicketState } from "./kitchen-print.js";

/** One unserved, fired line of an open tab, as `listTablesWithState`'s JSON aggregate emits it. */
interface UnservedLine {
  queuedAt: string;
  warmAfterMinutes: number;
  overdueAfterMinutes: number;
  forgottenAfterMinutes: number;
}
/**
 * The `tab_unserved_lines` aggregate, parsed.
 *
 * It arrives as JSON TEXT because `json_group_array` returns a string and a raw read reaches no
 * column mapping. An empty tab carries the literal `'[]'` the query coalesces to.
 */
export function parseUnservedLines(value: string): UnservedLine[] {
  return JSON.parse(value) as UnservedLine[];
}
/**
 * Whole minutes from a stored ISO stamp to `nowMs`, floored. Callers read the clock ONCE per query,
 * so every row of one board is aged against one instant.
 */
export function minutesSince(stamp: string, nowMs: number): number {
  return Math.floor((nowMs - Date.parse(stamp)) / 60_000);
}
/** The LIVE course row an item's snapshotted `course_id` names. Not filtered by `active`, so a course
 *  deleted after the item was fired still names its header. */
export interface StationQueueCourse {
  id: string;
  name: string;
  displayOrder: number;
}
/** A child without its own ticket item, shown beneath its dish. */
export interface QueueModifier {
  /** The KITCHEN name, the same one the printed kitchen ticket carries. */
  name: string;
  /** How many of a counted extra each dish has, as `QueueCrossRef.perDish` counts it. */
  perDish?: number;
  /** A measured extra's amount on each dish, in its unit. */
  amount?: string;
  /** The measured extra's unit abbreviation by language, sent with `amount`. */
  unitName?: Record<string, string>;
  /** The extra's OWN allergens, shown beside the dish's own, never folded into them. */
  addAllergens?: ProductAllergens | null;

  suitableFor?: string[] | null;
}
/** A line on another station's ticket that this item goes with. */
export interface QueueCrossRef {
  kind: "with" | "for";
  name: string;
  perDish?: number;
  amount?: string;
  unitName?: Record<string, string>;
  stationName: string | null;
  addAllergens?: ProductAllergens | null;
  suitableFor?: string[] | null;
}
/** The seated party a queue card's bill belongs to, at the revision a pass command must send. */
export interface QueueParty {
  id: string;
  revision: number;
}
/** The group a queue item's dish was submitted in; absent for a bill of no party, or a line moved
 *  in from another party's bill or from a bill with no party. */
export interface QueueGroup {
  id: string;
  position: number;
  displayNumber: number;
  numberPartyId: string;
  numberPartyLabel?: string;
  state: "held" | "fired";
  /** On a station's queue only: the names of the stations of the group's dishes for the pass, until
   * each is served; each name once, in the stations list's order. */
  goesWith?: readonly string[];
}

export interface StationQueueItem {
  allergy: KitchenAllergyBlock | null;
  lastMove?: StationQueueMove;
  id: string;
  workingOrderLineId: string;
  state: TicketState;
  optionSnapshots?: OptionSnapshot[];
  /** The KITCHEN name, the same one the printed kitchen ticket carries. */
  name: string;
  /** What is left to serve: the amount sent less the amount served. */
  quantity: string;
  unitName: Record<string, string> | null;
  unitPrecision: number | null;
  /** Counted in Each, whose unit the kitchen screen leaves out. */
  soldInEach: boolean;
  modifiers: QueueModifier[];
  crossRefs?: QueueCrossRef[];
  /** The dish's OWN allergens, no modifier contribution. `pending` when they are unreviewed. */
  asServed: { allergens: ProductAllergens; pending: boolean };
  asServedDiet?: DietProfile;
  course: StationQueueCourse | null;
  group?: QueueGroup;
  /** The period this dish was sent after; absent when it was not. */
  afterPeriod?: string;
  /** Set when that send asked nobody, so the station does not show it as agreed. */
  afterPeriodUnasked?: true;
  phase: KitchenPhase;
  /** `null` while the item is held. */
  requestedAt: string | null;
  /** `null` while the item is held or Requested (waiting for the pass). */
  firedAt: string | null;
  readyAt: string | null;
  /** Whether the item waited for the pass when it was requested. */
  passControlled: boolean;
  /** Snapshotted at fire, so a later draft edit never changes what the kitchen already sees. */
  note: string | null;
  queuedAt: string;
  /** The age band at fetch time; the client re-ticks it locally afterwards. */
  band: TimingBand;
}
/** One item of the order at another station, shown in this station's card. */
export interface ElsewhereItem {
  id: string;
  name: string;
  quantity: string;
  unitName: Record<string, string> | null;
  unitPrecision: number | null;
  soldInEach: boolean;
  stationName: string;
  state: TicketState;
  held: boolean;
}
/** One order's lines at a station. `queuedAt` is its OLDEST line's. */
export interface StationQueueGroup {
  kitchenNote: string | null;
  orderId: string;
  orderNumber: number;
  label: string | null;
  /** The short names, else labels, of the tables the bill is at: its party's, as
   *  {@link billPartyTables} chooses them, or a counter order's delivery table, or the name kept
   *  once that delivery table was let go; absent when none. */
  tableShortNames?: string[];
  dining: Dining;
  queuedAt: string;
  /** The station queue offers Collect on a `settled` order alone; a placed counter order is handed
   * over from the counter's waiting list. */
  status: WorkingOrderStatus;
  /** Absent for a bill of no party. */
  party?: QueueParty;
  /** Present only when one of this bill's tickets for the station was not printed after
   *  `JOBS_WAITING_MS`, or was given up on (`listPrintProblems`). */
  printProblem?: true;
  /** {@link readFormerNumbers}; absent when there are none. */
  formerNumbers?: number[];
  items: StationQueueItem[];
  /** Present only when this station shows the rest of the order: the order's items at other stations, possibly none. */
  elsewhere?: ElsewhereItem[];
  thresholds: StationThresholds;
  bumpMode: BumpMode;
}
/**
 * Queue lines' child modifiers and cross references, then each line's own allergens and diet.
 */
export async function readQueueSubItems(
  tx: Transaction,
  lineIds: string[],
): Promise<{
  modifiersByParent: Map<string, QueueModifier[]>;
  crossRefsByLine: Map<string, QueueCrossRef[]>;
  asServedByParent: Map<
    string,
    {
      asServed: { allergens: ProductAllergens; pending: boolean };
      asServedDiet: DietProfile;
    }
  >;
}> {
  const modifiersByParent = new Map<string, QueueModifier[]>();
  const crossRefsByLine = new Map<string, QueueCrossRef[]>();
  const asServedByParent = new Map<
    string,
    {
      asServed: { allergens: ProductAllergens; pending: boolean };
      asServedDiet: DietProfile;
    }
  >();
  if (lineIds.length === 0) return { modifiersByParent, crossRefsByLine, asServedByParent };

  const parentQuantities = new Map(
    (
      await tx
        .select({ id: workingOrderLines.id, quantity: workingOrderLines.quantity })
        .from(workingOrderLines)
        .where(inArray(workingOrderLines.id, lineIds))
    ).map((line) => [line.id, line.quantity]),
  );

  const childTicket = alias(ticketItems, "queue_child_ticket");
  const childStation = alias(kitchenStations, "queue_child_station");

  // LEFT join, so a child whose product row has gone still renders its frozen text.
  const childRows = await tx
    .select({
      id: workingOrderLines.id,
      parentLineId: workingOrderLines.parentLineId,
      unitName: workingOrderLines.unitName,
      name: workingOrderLines.name,
      kitchenName: workingOrderLines.kitchenName,
      variantName: workingOrderLines.variantName,
      variantKitchenName: workingOrderLines.variantKitchenName,
      quantity: workingOrderLines.quantity,
      stationName: childStation.name,
      ticketId: childTicket.id,
      addAllergens: effectiveProductColumns.allergens,
      dietaryDeclarations: effectiveProductColumns.dietaryDeclarations,
    })
    .from(workingOrderLines)
    .leftJoin(products, eq(products.id, workingOrderLines.productId))
    .leftJoin(parentProducts, parentJoin)
    .leftJoin(childTicket, eq(childTicket.workingOrderLineId, workingOrderLines.id))
    .leftJoin(childStation, eq(childStation.id, childTicket.stationId))
    .where(inArray(workingOrderLines.parentLineId, lineIds))
    .orderBy(workingOrderLines.lineNo);
  const counted = await VENUE_SERVICE.readLinesSoldInEach(
    tx,
    childRows.flatMap((child) => (child.unitName == null ? [] : [child.id])),
  );
  for (const child of childRows) {
    const quantity = thousandthsToDecimal(child.quantity);
    const dishes = thousandthsToDecimal(parentQuantities.get(child.parentLineId!)!);
    const amountPerDish =
      child.unitName == null || counted.has(child.id)
        ? { perDish: perDishOptionQuantity(quantity, dishes) }
        : { amount: divideDecimal(quantity, dishes, QUANTITY_SCALE), unitName: child.unitName };
    if (child.ticketId !== null) {
      const refs = crossRefsByLine.get(child.parentLineId!) ?? [];
      refs.push({
        kind: "with",
        name: kitchenPresentationName(child),
        ...amountPerDish,
        stationName: child.stationName,
        addAllergens: (child.addAllergens as ProductAllergens | null) ?? null,
        suitableFor: expandDietaryDeclarations(child.dietaryDeclarations as DietaryLabel[]),
      });
      crossRefsByLine.set(child.parentLineId!, refs);
      continue;
    }
    const mods = modifiersByParent.get(child.parentLineId!) ?? [];
    mods.push({
      name: kitchenPresentationName(child),
      ...amountPerDish,
      addAllergens: (child.addAllergens as ProductAllergens | null) ?? null,
      suitableFor: expandDietaryDeclarations(child.dietaryDeclarations as DietaryLabel[]),
    });
    modifiersByParent.set(child.parentLineId!, mods);
  }

  const parents = await tx
    .select({
      lineId: workingOrderLines.id,
      allergens: effectiveProductColumns.allergens,
      dietaryDeclarations: effectiveProductColumns.dietaryDeclarations,
    })
    .from(workingOrderLines)
    .leftJoin(products, eq(products.id, workingOrderLines.productId))
    .leftJoin(parentProducts, parentJoin)
    .where(inArray(workingOrderLines.id, lineIds));
  for (const p of parents) {
    const allergens = (p.allergens ?? {}) as ProductAllergens;
    const expanded = expandDietaryDeclarations(p.dietaryDeclarations as DietaryLabel[]);
    const asServedDiet: DietProfile = {
      vegan: expanded.includes("vegan") ? "yes" : "unknown",
      vegetarian: expanded.includes("vegetarian") ? "yes" : "unknown",
      contains: [],
      ...(expanded.includes("halal") ? { halal: "yes" as const } : {}),
      ...(expanded.includes("kosher") ? { kosher: "yes" as const } : {}),
    };
    asServedByParent.set(p.lineId, {
      asServed: { allergens, pending: p.allergens == null },
      asServedDiet,
    });
  }
  const dish = alias(workingOrderLines, "queue_dish_line");
  const dishTicket = alias(ticketItems, "queue_dish_ticket");
  const dishStation = alias(kitchenStations, "queue_dish_station");
  const extraRows = await tx
    .select({
      lineId: workingOrderLines.id,
      name: dish.name,
      kitchenName: dish.kitchenName,
      variantName: dish.variantName,
      variantKitchenName: dish.variantKitchenName,
      stationName: dishStation.name,
    })
    .from(workingOrderLines)
    .innerJoin(dish, eq(dish.id, workingOrderLines.parentLineId))
    .leftJoin(dishTicket, eq(dishTicket.workingOrderLineId, dish.id))
    .leftJoin(dishStation, eq(dishStation.id, dishTicket.stationId))
    .where(inArray(workingOrderLines.id, lineIds));
  for (const extra of extraRows) {
    crossRefsByLine.set(extra.lineId, [
      {
        kind: "for",
        name: kitchenPresentationName(extra),
        stationName: extra.stationName,
      },
    ]);
  }
  return { modifiersByParent, crossRefsByLine, asServedByParent };
}
export const queueGroupColumns = {
  partyId: parties.id,
  partyRevision: parties.revision,
  groupId: orderGroups.id,
  groupPosition: orderGroups.position,
  groupDisplayNumber: orderGroups.displayNumber,
  groupNumberPartyId: orderGroups.numberPartyId,
  groupPartyId: orderGroups.partyId,
  groupState: orderGroups.state,
};
function queueParty(row: {
  partyId: string | null;
  partyRevision: number | null;
}): QueueParty | undefined {
  return row.partyId === null ? undefined : { id: row.partyId, revision: row.partyRevision! };
}
export function queueGroup(
  row: {
    groupId: string | null;
    groupPosition: number | null;
    groupDisplayNumber: number | null;
    groupNumberPartyId: string | null;
    groupState: string | null;
  },
  numberLabels: ReadonlyMap<string, string>,
): QueueGroup | undefined {
  return row.groupId === null
    ? undefined
    : {
        id: row.groupId,
        position: row.groupPosition!,
        displayNumber: row.groupDisplayNumber!,
        numberPartyId: row.groupNumberPartyId!,
        ...(numberLabels.has(row.groupId)
          ? { numberPartyLabel: numberLabels.get(row.groupId)! }
          : {}),
        state: row.groupState as QueueGroup["state"],
      };
}
/** `{ [key]: value }`, or nothing when there is no value: a queue leaves an absent party or group out. */
export function optional<K extends string, V>(key: K, value: V | undefined): { [P in K]?: V } {
  return (value === undefined ? {} : { [key]: value }) as { [P in K]?: V };
}
/**
 * The venue's ticket items at one station that are still the kitchen's work ({@link kitchenWork}),
 * grouped by order, oldest first.
 * When the station shows the rest of the order, each card also carries its unserved items at other stations.
 */
export async function listStationQueue(
  tx: Transaction,
  stationId: string,
): Promise<StationQueueGroup[]> {
  return (await listStationQueues(tx, [stationId])).get(stationId)!;
}
/** {@link StationQueueGroup.tableShortNames} for each bill that is at a table, or whose delivery
 *  table was let go, keyed by bill. */
export async function readBillTableShortNames(
  tx: Transaction,
  bills: readonly {
    orderId: string;
    partyId: string | null;
    deliveryTableId: string | null;
    deliveryTableLabel: string | null;
  }[],
): Promise<Map<string, string[]>> {
  const byParty = await billPartyTables(tx, [
    ...new Set(bills.flatMap((bill) => bill.partyId ?? [])),
  ]);
  const tableIdsOf = new Map<string, string[]>();
  const names = new Map<string, string[]>();
  for (const bill of bills) {
    if (bill.partyId !== null) {
      const ids = byParty.get(bill.partyId)!.map((table) => table.id);
      if (ids.length > 0) tableIdsOf.set(bill.orderId, ids);
    } else if (bill.deliveryTableId !== null) {
      tableIdsOf.set(bill.orderId, [bill.deliveryTableId]);
    } else if (bill.deliveryTableLabel !== null) {
      // Its delivery table was let go (`releaseDeliveries`), keeping the table's name.
      names.set(bill.orderId, [bill.deliveryTableLabel]);
    }
  }
  const tableIds = [...new Set([...tableIdsOf.values()].flat())];
  const shortNames = new Map(
    tableIds.length === 0
      ? []
      : (
          await tx
            .select({
              id: diningTables.id,
              label: diningTables.label,
              shortName: diningTables.shortName,
            })
            .from(diningTables)
            .where(inArray(diningTables.id, tableIds))
        ).map((table) => [table.id, table.shortName ?? table.label]),
  );
  for (const [orderId, ids] of tableIdsOf)
    names.set(
      orderId,
      ids.map((id) => shortNames.get(id)!),
    );
  return names;
}
/** The ticket items {@link listStationQueues} lists, at `stationIds`. */
function onStationQueues(stationIds: readonly string[]): SQL | undefined {
  return and(
    // Read tickets by bill; a station's index range includes its collected history. Never narrower
    // than kitchenWork()'s bill tests.
    inArray(
      workingOrderLines.workingOrderId,
      sql`(select ${workingOrders.id} from ${workingOrders} where ${workingOrders.collectedAt} is null and ${workingOrders.status} <> ${"abandoned"})`,
    ),
    inArray(sql`+${ticketItems.stationId}`, [...stationIds]),
    kitchenWork(),
  );
}
/** Whether {@link listStationQueue} lists anything at `stationId`, without reading it. */
export async function stationHasWork(tx: Transaction, stationId: string): Promise<boolean> {
  const [item] = await tx
    .select({ id: ticketItems.id })
    .from(ticketItems)
    .innerJoin(workingOrderLines, eq(ticketItems.workingOrderLineId, workingOrderLines.id))
    .innerJoin(workingOrders, eq(workingOrderLines.workingOrderId, workingOrders.id))
    .innerJoin(kitchenStations, eq(ticketItems.stationId, kitchenStations.id))
    .where(onStationQueues([stationId]))
    .limit(1);
  return item !== undefined;
}
/** A station's own view of `group`: the pass board reads {@link queueGroup} without the cue. */
function stationQueueGroup(
  group: QueueGroup | undefined,
  passStations: ReadonlyMap<string, readonly string[]>,
): QueueGroup | undefined {
  if (group === undefined) return undefined;
  const goesWith = passStations.get(group.id);
  return goesWith === undefined ? group : { ...group, goesWith };
}
/** Each of `stationIds`' {@link listStationQueue}, read together. */
export async function listStationQueues(
  tx: Transaction,
  stationIds: readonly string[],
): Promise<Map<string, StationQueueGroup[]>> {
  const queues = new Map(stationIds.map((id) => [id, [] as StationQueueGroup[]]));
  if (stationIds.length === 0) return queues;
  const rows = await tx
    .select({
      stationId: ticketItems.stationId,
      itemId: ticketItems.id,
      workingOrderLineId: ticketItems.workingOrderLineId,
      state: ticketItems.state,
      queuedAt: ticketItems.queuedAt,
      // Customer-facing text is deliberately not read: a cook reads the kitchen name.
      name: workingOrderLines.name,
      kitchenName: workingOrderLines.kitchenName,
      variantName: workingOrderLines.variantName,
      variantKitchenName: workingOrderLines.variantKitchenName,
      optionSnapshots: workingOrderLines.optionSnapshots,
      quantity: sql<number>`${firedQuantity} - ${workingOrderLines.servedQuantity}`,
      unitName: workingOrderLines.unitName,
      unitPrecision: workingOrderLines.unitPrecision,
      lineNo: workingOrderLines.lineNo,
      courseId: ticketItems.courseId,
      courseName: kitchenCourses.name,
      courseDisplayOrder: kitchenCourses.displayOrder,
      firedAt: ticketItems.firedAt,
      requestedAt: ticketItems.requestedAt,
      readyAt: ticketItems.readyAt,
      passControlled: ticketItems.passControlled,
      // The fire-time snapshot, not the live line.
      note: ticketItems.note,
      orderId: workingOrders.id,
      orderNumber: workingOrders.orderNumber,
      label: workingOrders.label,
      status: workingOrders.status,
      dining: workingOrders.dining,
      deliveryTableId: workingOrders.deliveryTableId,
      deliveryTableLabel: workingOrders.deliveryTableLabel,
      ...queueGroupColumns,
      warmAfterMinutes: kitchenStations.warmAfterMinutes,
      overdueAfterMinutes: kitchenStations.overdueAfterMinutes,
      forgottenAfterMinutes: kitchenStations.forgottenAfterMinutes,
      showsRestOfOrder: kitchenStations.showsRestOfOrder,
      bumpMode: kitchenStations.bumpMode,
    })
    .from(ticketItems)
    .innerJoin(workingOrderLines, eq(ticketItems.workingOrderLineId, workingOrderLines.id))
    .innerJoin(workingOrders, eq(workingOrderLines.workingOrderId, workingOrders.id))
    .innerJoin(kitchenStations, eq(ticketItems.stationId, kitchenStations.id))
    // Not filtered by `active`: a course deleted after the item was fired still names its header.
    .leftJoin(kitchenCourses, eq(ticketItems.courseId, kitchenCourses.id))
    .leftJoin(parties, eq(parties.id, workingOrders.partyId))
    .leftJoin(orderGroups, eq(orderGroups.id, workingOrderLines.groupId))
    .where(onStationQueues(stationIds))
    .orderBy(ticketItems.queuedAt, workingOrders.orderNumber, workingOrderLines.lineNo);

  const allergies = await VENUE_SERVICE.readTicketAllergies(
    tx,
    rows.map((row) => row.itemId),
  );
  const numberLabels = await readGroupNumberLabels(
    tx,
    rows.flatMap((row) => (row.groupPartyId === null ? [] : [row.groupPartyId])),
  );
  const passStations = await passStationsByGroup(tx, [
    ...new Set(rows.flatMap((row) => (row.groupId === null ? [] : [row.groupId]))),
  ]);
  const lastMoves = await readStationQueueMoves(
    tx,
    rows.map((row) => row.workingOrderLineId),
  );
  const { modifiersByParent, crossRefsByLine, asServedByParent } = await readQueueSubItems(
    tx,
    rows.map((row) => row.workingOrderLineId),
  );
  const soldInEach = await VENUE_SERVICE.readLinesSoldInEach(
    tx,
    rows.map((row) => row.workingOrderLineId),
  );
  const lateMarks = await VENUE_SERVICE.readLateSendMarks(
    tx,
    rows.map((row) => row.workingOrderLineId),
  );

  const orderIds = [...new Set(rows.map((row) => row.orderId))];
  const kitchenNotes = await readOrderKitchenNotes(tx, orderIds);
  const restOrderIds = [
    ...new Set(rows.filter((row) => row.showsRestOfOrder).map((row) => row.orderId)),
  ];
  const rest: Map<string, RestOfOrderItem[]> = await readRestOfOrder(tx, restOrderIds);
  const restSoldInEach =
    restOrderIds.length > 0
      ? await VENUE_SERVICE.readLinesSoldInEach(
          tx,
          [...rest.values()].flatMap((items) => items.map((item) => item.workingOrderLineId)),
        )
      : new Set<string>();

  const nowMs = Date.now();
  const printProblems = await stationOrdersWithPrintProblem(
    tx,
    stationIds,
    orderIds,
    new Date(nowMs),
  );
  const former = await readFormerNumbers(tx, orderIds);
  const tableShortNames = await readBillTableShortNames(tx, rows);
  // Each Map keeps insertion order, so groups come out oldest-first.
  const groupsAt = new Map(stationIds.map((id) => [id, new Map<string, StationQueueGroup>()]));
  for (const row of rows) {
    const { stationId, showsRestOfOrder } = row;
    const groups = groupsAt.get(stationId)!;
    const thresholds: StationThresholds = {
      warmAfterMinutes: row.warmAfterMinutes,
      overdueAfterMinutes: row.overdueAfterMinutes,
      forgottenAfterMinutes: row.forgottenAfterMinutes,
    };
    let group = groups.get(row.orderId);
    if (group === undefined) {
      group = {
        orderId: row.orderId,
        kitchenNote: kitchenNotes.get(row.orderId)!.note,
        orderNumber: row.orderNumber,
        label: row.label,
        ...optional("tableShortNames", tableShortNames.get(row.orderId)),
        dining: row.dining,
        queuedAt: row.queuedAt,
        status: row.status,
        ...optional("party", queueParty(row)),
        ...optional(
          "printProblem",
          printProblems.get(stationId)!.has(row.orderId) ? true : undefined,
        ),
        ...optional("formerNumbers", former.get(row.orderId)),
        items: [],
        ...optional(
          "elsewhere",
          showsRestOfOrder
            ? (rest.get(row.orderId) ?? [])
                .filter((item) => item.stationId !== stationId)
                .map((item) => ({
                  id: item.ticketItemId,
                  name: item.name,
                  quantity: item.quantity,
                  unitName: item.unitName,
                  unitPrecision: item.unitPrecision,
                  soldInEach: restSoldInEach.has(item.workingOrderLineId),
                  stationName: item.stationName,
                  state: item.state,
                  held: item.held,
                }))
            : undefined,
        ),
        thresholds,
        bumpMode: row.bumpMode,
      };
      groups.set(row.orderId, group);
    }
    const move = lastMoves.get(row.workingOrderLineId);
    const lastMove =
      move?.toStationId === stationId
        ? {
            fromStationName: move.fromStationName,
            personName: move.personName,
            deviceName: move.deviceName,
            movedAt: move.movedAt,
          }
        : undefined;
    group.items.push({
      id: row.itemId,
      allergy: allergies.get(row.itemId)?.originalBlock ?? null,
      workingOrderLineId: row.workingOrderLineId,
      ...optional("lastMove", lastMove),
      ...optional("afterPeriod", lateMarks.get(row.workingOrderLineId)?.periodName),
      ...(lateMarks.get(row.workingOrderLineId)?.agreed === false
        ? { afterPeriodUnasked: true as const }
        : {}),
      state: row.state,
      name: kitchenPresentationName(row),
      optionSnapshots: row.optionSnapshots,
      quantity: thousandthsToDecimal(row.quantity),
      unitName: row.unitName,
      unitPrecision: row.unitPrecision,
      soldInEach: soldInEach.has(row.workingOrderLineId),
      modifiers: modifiersByParent.get(row.workingOrderLineId) ?? [],
      ...optional("crossRefs", crossRefsByLine.get(row.workingOrderLineId)),
      asServed: asServedByParent.get(row.workingOrderLineId)?.asServed ?? {
        allergens: {},
        pending: true,
      },
      asServedDiet: asServedByParent.get(row.workingOrderLineId)?.asServedDiet ?? {
        vegan: "unknown",
        vegetarian: "unknown",
        contains: [],
      },
      // A non-null `course_id` always matches a `kitchen_courses` row: the foreign key guarantees it.
      course:
        row.courseId === null
          ? null
          : { id: row.courseId, name: row.courseName!, displayOrder: row.courseDisplayOrder! },
      ...optional("group", stationQueueGroup(queueGroup(row, numberLabels), passStations)),
      phase: kitchenPhase(row),
      requestedAt: row.requestedAt,
      firedAt: row.firedAt,
      readyAt: row.readyAt,
      passControlled: row.passControlled,
      note: row.note,
      queuedAt: row.queuedAt,
      // Rounded to the whole minute first: what the bands were tuned against.
      band: classifyBand(nowMs - minutesSince(row.queuedAt, nowMs) * 60_000, nowMs, thresholds),
    });
  }
  for (const [stationId, groups] of groupsAt) queues.set(stationId, [...groups.values()]);
  return queues;
}
