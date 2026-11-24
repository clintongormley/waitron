import "./errors.js";
import {
  type Transaction,
  ticketItems,
  workingOrderLines,
  orderGroups,
  workingOrders,
  nowIso,
} from "@waitron/db";
import type { AllergyCommand } from "@waitron/module";
import { AppError } from "@waitron/shared";
import { type SQL, eq, and, inArray, notInArray, isNull, ne, isNotNull, exists } from "drizzle-orm";
import { captureKitchenActivity } from "./attendance-capture.js";
import { type OrderEditAuthority, requireOrderBillEditor } from "./bill-editing.js";
import { onDishesOrTheirExtras } from "./dish-kitchen.js";
import { freezeKitchenAllergyItems, notifyKitchenAllergyDestination } from "./kitchen-allergy.js";
import { heldItem, initiatedItem } from "./kitchen-phase.js";
import {
  type FiredItem,
  enqueueKitchenTickets,
  liveKitchenDish,
  kitchenWork,
} from "./kitchen-print.js";
import { requestHeldItems } from "./kitchen-release.js";
import { requireLiveCourse } from "./kitchen.js";
import type { Firer } from "./order-group-records.js";
import { partyOfOrder, runServiceCommand, checkAndBumpParty } from "./parties.js";
import {
  assertPartyAllergyAnswered,
  survivingParty,
  normaliseAllergyPatch,
  prepareAllergyRelease,
} from "./party-allergy.js";
import { rerouteHeldAtRelease, type Rerouted } from "./station-move.js";
import type { OriginConfig, TradingContext } from "./trading-context.js";
import { isOpenOrder, type OrderAttendance, captureOrderService } from "./working-order-context.js";
import { bumpRevisionKeepingPayment } from "./working-order-edit-state.js";
import {
  type RoutingOnce,
  routingOnce,
  heldNoRouteLines,
  assertSendable,
  stampSent,
  insertSplitExtras,
} from "./working-order-kitchen-fire.js";
import { assertPartyBillOpen } from "./working-order-open.js";
import type { TicketState } from "./kitchen-print.js";

export async function fireOrderLines(
  tx: Transaction,
  cfg: OriginConfig,
  orderId: string,
  lineIds: readonly string[],
  fire?: { heldPaper: ReadonlySet<string> },
  routing?: RoutingOnce,
): Promise<void> {
  await releaseHeld(
    tx,
    cfg,
    orderId,
    onDishesOrTheirExtras(tx, lineIds),
    { courseIds: [], lineIds },
    fire,
    routing,
  );
}

async function releaseHeld(
  tx: Transaction,
  cfg: OriginConfig,
  orderId: string,
  ticketScope: SQL,
  noRouteScope: { courseIds: readonly (string | null)[]; lineIds: readonly string[] },
  fire?: { heldPaper: ReadonlySet<string> },
  routing = routingOnce(tx, new Date()),
): Promise<boolean> {
  const firedNow = routing.at.toISOString();
  const pending = await tx
    .select({ id: ticketItems.id })
    .from(ticketItems)
    .innerJoin(workingOrderLines, eq(workingOrderLines.id, ticketItems.workingOrderLineId))
    .where(and(eq(workingOrderLines.workingOrderId, orderId), ticketScope, heldItem()))
    .limit(1);
  const pendingNoRoute = await heldNoRouteLines(tx, orderId, noRouteScope, routing);
  if (pending.length > 0 || pendingNoRoute.lines.length > 0) {
    const partyId = await partyOfOrder(tx, orderId);
    // A settled bill keeps the party it was paid under; a merge combines that party's answer into
    // the surviving party's.
    if (partyId !== null) await assertPartyAllergyAnswered(tx, await survivingParty(tx, partyId));
  }
  const rerouted = await rerouteHeldAtRelease(tx, cfg, orderId, ticketScope, routing);
  const { released: firedItems, requested } = await requestHeldItems(
    tx,
    orderId,
    ticketScope,
    firedNow,
  );
  const noRoute = await heldNoRouteLines(tx, orderId, noRouteScope, routing);
  await finishRelease(
    tx,
    cfg,
    orderId,
    firedItems,
    requested,
    noRoute,
    firedNow,
    await isOpenOrder(tx, orderId),
    fire,
    routing,
    rerouted,
  );
  return firedItems.length > 0 || requested.length > 0 || noRoute.lines.length > 0;
}
// Only the items released by this write may print, so a retry cannot print them again.
async function finishRelease(
  tx: Transaction,
  cfg: TradingContext,
  orderId: string,
  fired: FiredItem[],
  requested: FiredItem[],
  noRoute: { zoneId: string | null; lines: { id: string; courseId: string | null }[] },
  at: string,
  refuseArchived: boolean,
  fire?: { heldPaper: ReadonlySet<string> },
  routing = routingOnce(tx, new Date(at)),
  rerouted: Rerouted = new Map(),
): Promise<void> {
  const released = [
    ...fired.map((item) => item.workingOrderLineId),
    ...requested.map((item) => item.workingOrderLineId),
    ...noRoute.lines.map((line) => line.id),
  ];
  if (refuseArchived) await assertSendable(tx, released);
  await stampSent(tx, orderId, released, at);
  const extras = await insertSplitExtras(
    tx,
    cfg,
    orderId,
    noRoute.zoneId,
    noRoute.lines.map((line) => ({
      dishLineId: line.id,
      stationId: null,
      courseId: line.courseId,
      initiated: true,
    })),
    routing,
  );
  const ordinary = [...fired, ...extras.filter((item) => item.firedAt !== null)].filter(
    (item) => !rerouted.has(item.workingOrderLineId),
  );
  await freezeKitchenAllergyItems(tx, orderId, [
    ...fired,
    ...requested,
    ...extras.filter((item) => item.firedAt !== null),
  ]);
  await enqueueKitchenTickets(tx, cfg, orderId, ordinary, { fire });
  const byOldStation = new Map<string, { from: string; items: FiredItem[] }>();
  for (const item of fired) {
    const old = rerouted.get(item.workingOrderLineId);
    if (old === undefined) continue;
    const bucket = byOldStation.get(old.stationId) ?? { from: old.stationName, items: [] };
    bucket.items.push(item);
    byOldStation.set(old.stationId, bucket);
  }
  for (const { from, items } of byOldStation.values())
    await enqueueKitchenTickets(tx, cfg, orderId, items, { from });
  if (fired.length > 0) {
    const destinations = await tx
      .select({ id: ticketItems.id, lineId: workingOrderLines.id, groupState: orderGroups.state })
      .from(ticketItems)
      .innerJoin(workingOrderLines, eq(workingOrderLines.id, ticketItems.workingOrderLineId))
      .leftJoin(orderGroups, eq(orderGroups.id, workingOrderLines.groupId))
      .where(
        inArray(
          ticketItems.workingOrderLineId,
          fired.map((item) => item.workingOrderLineId),
        ),
      );
    await notifyKitchenAllergyDestination(
      tx,
      cfg,
      destinations
        .filter((row) => row.groupState !== "held" || rerouted.has(row.lineId))
        .map((row) => row.id),
    );
  }
  if (released.length > 0) await bumpRevisionKeepingPayment(tx, [orderId]);
}
/**
 * Send selected held lines of an open tab, considering dishes at stations that are not open for
 * re-routing and refreshing queued_at when they fire.
 * The caller's transaction includes kitchen writes and their print jobs.
 */
export async function sendLines(
  tx: Transaction,
  cfg: OriginConfig,
  tabId: string,
  lineNos: number[],
  authority: OrderEditAuthority,
  attendance?: OrderAttendance & { personId: string },
  command?: AllergyCommand,
): Promise<void> {
  if (command !== undefined) {
    const partyId = await partyOfOrder(tx, tabId);
    if (partyId !== null) {
      const allergy =
        command.allergy === undefined ? undefined : normaliseAllergyPatch(command.allergy);
      await runServiceCommand(
        tx,
        { kind: "party", partyId },
        command.submissionId,
        "lines.send",
        {
          tabId,
          lineNos,
          operatorId: authority.operatorId,
          expectedEdit: authority.expectedEdit,
          ...(allergy === undefined ? {} : { allergy }),
        },
        async () => {
          await checkAndBumpParty(tx, partyId, command.expectedPartyRevision, "open");
          await requireOrderBillEditor(tx, tabId, authority);
          await prepareAllergyRelease(
            tx,
            cfg,
            partyId,
            { kind: "lines", orderId: tabId, lineNos },
            allergy,
            authority.operatorId ?? null,
          );
          await sendLines(tx, cfg, tabId, lineNos, authority, attendance);
          return null;
        },
        cfg.madeHereSink,
      );
      return;
    }
  }
  const routing = routingOnce(tx, new Date());
  await assertPartyBillOpen(tx, tabId);
  await requireOrderBillEditor(tx, tabId, authority);
  const namedLines =
    lineNos.length === 0
      ? []
      : await tx
          .select({ id: workingOrderLines.id, parentLineId: workingOrderLines.parentLineId })
          .from(workingOrderLines)
          .where(
            and(
              eq(workingOrderLines.workingOrderId, tabId),
              inArray(workingOrderLines.lineNo, lineNos),
            ),
          );
  if (namedLines.some((line) => line.parentLineId !== null)) {
    throw new AppError("management.request_invalid", { field: "lineNo" });
  }
  const heldGroupLines = await tx
    .select({ id: workingOrderLines.id, lineNo: workingOrderLines.lineNo })
    .from(workingOrderLines)
    .innerJoin(orderGroups, eq(orderGroups.id, workingOrderLines.groupId))
    .where(and(eq(workingOrderLines.workingOrderId, tabId), eq(orderGroups.state, "held")))
    .orderBy(workingOrderLines.lineNo);
  const named = new Set(lineNos);
  const namedHeld = heldGroupLines.find((line) => named.has(line.lineNo));
  if (namedHeld !== undefined) {
    throw new AppError("group.line_held", { tabId, lineNo: namedHeld.lineNo });
  }
  const heldGroupLineIds = heldGroupLines.map((line) => line.id);
  const heldGroupLineIdSet = new Set(heldGroupLineIds);
  // An empty list sends every held line of the tab outside a held group.
  const namedLineIds = namedLines.map((line) => line.id);
  const firedNow = routing.at.toISOString();
  const ticketScope =
    lineNos.length === 0
      ? notInArray(ticketItems.workingOrderLineId, heldGroupLineIds)
      : onDishesOrTheirExtras(tx, namedLineIds);
  await prepareAllergyRelease(
    tx,
    cfg,
    (await partyOfOrder(tx, tabId))!,
    { kind: "lines", orderId: tabId, lineNos },
    undefined,
    null,
  );
  const rerouted = await rerouteHeldAtRelease(tx, cfg, tabId, ticketScope, routing);
  const { released: firedItems, requested } = await requestHeldItems(
    tx,
    tabId,
    ticketScope,
    firedNow,
  );
  // Sending everything held releases every held no-route line outside a held group. Sending named
  // lines releases the named ones, and a course's no-route lines once nothing routed in that course is still held.
  const noRoute = await heldNoRouteLines(
    tx,
    tabId,
    lineNos.length === 0
      ? "all"
      : {
          courseIds: await releasedCourses(
            tx,
            tabId,
            [...firedItems, ...requested].map((item) => item.courseId),
          ),
          lineIds: namedLineIds,
        },
    routing,
  );
  noRoute.lines = noRoute.lines.filter((line) => !heldGroupLineIdSet.has(line.id));
  await finishRelease(
    tx,
    cfg,
    tabId,
    firedItems,
    requested,
    noRoute,
    firedNow,
    true,
    undefined,
    routing,
    rerouted,
  );
  if (firedItems.length > 0 || requested.length > 0 || noRoute.lines.length > 0)
    await captureOrderService(tx, attendance, tabId, "send");
}
/** Of `courseIds` (`null` standing for no course), the ones with no held item left on the order. */
async function releasedCourses(
  tx: Transaction,
  orderId: string,
  courseIds: readonly (string | null)[],
): Promise<(string | null)[]> {
  const candidates = [...new Set(courseIds)];
  if (candidates.length === 0) return [];
  const stillHeld = await tx
    .selectDistinct({ courseId: ticketItems.courseId })
    .from(ticketItems)
    .innerJoin(workingOrderLines, eq(workingOrderLines.id, ticketItems.workingOrderLineId))
    .where(and(eq(workingOrderLines.workingOrderId, orderId), heldItem()));
  const held = new Set(stillHeld.map((row) => row.courseId));
  return candidates.filter((courseId) => !held.has(courseId));
}

export async function bumpBillReady(
  tx: Transaction,
  orderId: string,
  firer?: Firer,
  attendance?: OrderAttendance,
): Promise<void> {
  const changed = await tx
    .update(ticketItems)
    .set(advanceSet("ready"))
    .where(
      and(
        inArray(
          ticketItems.id,
          tx
            .select({ id: ticketItems.id })
            .from(ticketItems)
            .innerJoin(workingOrderLines, eq(ticketItems.workingOrderLineId, workingOrderLines.id))
            .innerJoin(workingOrders, eq(workingOrderLines.workingOrderId, workingOrders.id))
            .where(
              and(
                eq(workingOrderLines.workingOrderId, orderId),
                isNull(workingOrderLines.groupId),
                liveKitchenDish(),
              ),
            ),
        ),
        ne(ticketItems.state, "ready"),
        isNotNull(ticketItems.firedAt),
      ),
    )
    .returning({ lineId: ticketItems.workingOrderLineId });
  await captureKitchenActivity(
    tx,
    attendance,
    firer && "personId" in firer ? firer.personId : undefined,
    changed.length === 0 ? [] : [orderId],
  );
}
/**
 * Move ONE held line of an OPEN tab into another kitchen course, or clear its course to null.
 * A deleted course is not a valid new target. A line the waiter has fired, released or still
 * waiting for the pass, is refused `ticket.already_fired`: once the kitchen or the pass has been
 * told about it, it is changed through Change dish.
 */
export async function setLineCourse(
  tx: Transaction,
  tabId: string,
  lineNo: number,
  courseId: string | null,
  authority: OrderEditAuthority,
  attendance?: OrderAttendance & { personId: string },
): Promise<void> {
  await assertPartyBillOpen(tx, tabId);
  await requireOrderBillEditor(tx, tabId, authority);
  if (courseId !== null) {
    await requireLiveCourse(tx, courseId);
  }
  const [line] = await tx
    .select({
      id: workingOrderLines.id,
      parentLineId: workingOrderLines.parentLineId,
      courseId: workingOrderLines.courseId,
    })
    .from(workingOrderLines)
    .where(and(eq(workingOrderLines.workingOrderId, tabId), eq(workingOrderLines.lineNo, lineNo)));
  if (line === undefined) {
    throw new AppError("tab.line_not_found", { tabId, lineNo });
  }
  if (line.parentLineId !== null) {
    throw new AppError("management.request_invalid", { field: "lineNo" });
  }
  const [item] = await tx
    .select({ id: ticketItems.id })
    .from(ticketItems)
    .where(and(onDishesOrTheirExtras(tx, [line.id]), initiatedItem()));
  if (item !== undefined) {
    throw new AppError("ticket.already_fired", { workingOrderId: tabId });
  }
  await tx.update(workingOrderLines).set({ courseId }).where(eq(workingOrderLines.id, line.id));
  // The held ticket item's course snapshot too; no row when the line has no item yet.
  await tx
    .update(ticketItems)
    .set({ courseId })
    .where(onDishesOrTheirExtras(tx, [line.id]));
  await bumpRevisionKeepingPayment(tx, [tabId]);
  if (line.courseId !== courseId) await captureOrderService(tx, attendance, tabId, "course");
}
/** The forward kitchen transitions, keyed by target state: the one legal predecessor and the column
 *  stamped. `queued` is not a target: a fire reaches it. `advanceTicketItem` also takes a Ready item
 *  back to `preparing`. */
const TICKET_TRANSITIONS = {
  preparing: { from: "queued", stampedAt: "preparingAt" },
  ready: { from: "preparing", stampedAt: "readyAt" },
} as const satisfies Record<
  Exclude<TicketState, "queued">,
  { from: TicketState; stampedAt: "preparingAt" | "readyAt" }
>;
/** A ternary, not a computed key: a computed key would widen the payload to a string index and lose
 *  Drizzle's typing against `ticket_items`. */
export function advanceSet(to: Exclude<TicketState, "queued">) {
  const at = nowIso();
  return TICKET_TRANSITIONS[to].stampedAt === "preparingAt"
    ? { state: to, preparingAt: at }
    : { state: to, readyAt: at };
}
/** Advance one fired ticket item one step, or put a Ready item still on its station's screen
 *  ({@link kitchenWork}) back to `preparing` (clearing `readyAt`, keeping `preparingAt`). A `to`
 *  outside the transition table is refused `management.request_invalid` on `to`, an unknown item
 *  `ticket_item.not_found`, an item not released yet (`fired_at` is null: held, or Requested and
 *  waiting for the pass) `ticket.item_held`, and a skip, a repeat or a Ready item going back once it
 *  is off that screen `ticket.invalid_transition`. */
export async function advanceTicketItem(
  tx: Transaction,
  itemId: string,
  to: TicketState,
  attendance?: OrderAttendance & { personId: string },
): Promise<void> {
  // Own string keys only: `hasOwn` converts its key, so ["preparing"] would otherwise match, and an
  // inherited name such as "__proto__" is not a transition.
  if (typeof to !== "string" || !Object.hasOwn(TICKET_TRANSITIONS, to)) {
    throw new AppError("management.request_invalid", { field: "to" });
  }
  const validTo = to as Exclude<TicketState, "queued">;
  const transition = TICKET_TRANSITIONS[validTo];

  const updated = await tx
    .update(ticketItems)
    .set(advanceSet(validTo))
    .where(
      and(
        eq(ticketItems.id, itemId),
        eq(ticketItems.state, transition.from),
        isNotNull(ticketItems.firedAt),
      ),
    )
    .returning({ lineId: ticketItems.workingOrderLineId });
  if (updated.length === 0 && validTo === "preparing") {
    updated.push(
      ...(await tx
        .update(ticketItems)
        .set({ state: "preparing", readyAt: null })
        .where(
          and(
            eq(ticketItems.id, itemId),
            eq(ticketItems.state, "ready"),
            isNotNull(ticketItems.firedAt),
            exists(
              tx
                .select({ id: workingOrderLines.id })
                .from(workingOrderLines)
                .innerJoin(workingOrders, eq(workingOrders.id, workingOrderLines.workingOrderId))
                .where(
                  and(eq(workingOrderLines.id, ticketItems.workingOrderLineId), kitchenWork()),
                ),
            ),
          ),
        )
        .returning({ lineId: ticketItems.workingOrderLineId })),
    );
  }
  if (updated.length === 0) {
    const [item] = await tx
      .select({ firedAt: ticketItems.firedAt })
      .from(ticketItems)
      .where(eq(ticketItems.id, itemId));
    if (item === undefined) throw new AppError("ticket_item.not_found", { ticketItemId: itemId });
    if (item.firedAt === null) throw new AppError("ticket.item_held", { ticketItemId: itemId });
    throw new AppError("ticket.invalid_transition", { ticketItemId: itemId });
  }
  if (attendance === undefined) return;
  await captureKitchenActivity(
    tx,
    attendance,
    attendance.personId,
    (
      await tx
        .select({ orderId: workingOrderLines.workingOrderId })
        .from(workingOrderLines)
        .where(
          inArray(
            workingOrderLines.id,
            updated.map((row) => row.lineId),
          ),
        )
    ).map((row) => row.orderId),
  );
}
