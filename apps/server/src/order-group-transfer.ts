import {
  type Transaction,
  orderGroups,
  workingOrderLines,
  workingOrders,
  orderDrafts,
  orderDraftLines,
  kitchenCourses,
  ticketItems,
  type OrderGroupRequestKind,
} from "@waitron/db";
import { eq, asc, and, inArray, sql, isNull, or, type Column } from "drizzle-orm";
import type { AttendanceRecorder } from "./attendance-capture.js";
import { dishKitchenItems } from "./dish-kitchen.js";
import { readLineCancellations } from "./line-service-state.js";
import { heldPaperStations, recordHeldPaper } from "./order-group-hold-paper.js";
import { onShownBill } from "./order-group-reads.js";
import {
  lastPosition,
  nextGroupNumber,
  recordGroupEvent,
  removeEmptiedHeldGroups,
  type Firer,
  nextFireKind,
  type GroupRelease,
  startGroup,
} from "./order-group-records.js";
import { notSetMenuLine } from "./set-menu-bill.js";
import type { OriginConfig } from "./trading-context.js";
import { routingOnce } from "./working-order-kitchen-fire.js";
import { fireOrderLines } from "./working-order-kitchen-service.js";
import { serviceRequested } from "./working-order-serving.js";

/**
 * Give every group of `fromPartyId` to `intoPartyId`, after its last position and in their own
 * order: a merge of two parties' bills, whose lines keep their groups.
 */
export async function moveGroupsToParty(
  tx: Transaction,
  fromPartyId: string,
  intoPartyId: string,
): Promise<void> {
  const groups = await tx
    .select({ id: orderGroups.id })
    .from(orderGroups)
    .where(eq(orderGroups.partyId, fromPartyId))
    .orderBy(asc(orderGroups.position), asc(orderGroups.createdAt), asc(orderGroups.id));
  let position = await lastPosition(tx, intoPartyId);
  for (const group of groups) {
    await tx
      .update(orderGroups)
      .set({ partyId: intoPartyId, position: ++position })
      .where(eq(orderGroups.id, group.id));
  }
}
/**
 * Give each held group of `fromPartyId` holding one of `lineIds` a held copy at `toPartyId`, and
 * move those lines and their extras to it. Returns source group id → copy id.
 */
export async function copyHeldGroups(
  tx: Transaction,
  fromPartyId: string,
  toPartyId: string,
  lineIds: readonly string[],
  operatorId: string,
  attendance?: { recorder: AttendanceRecorder; at: string },
): Promise<Map<string, string>> {
  return copyGroups(tx, "held", fromPartyId, toPartyId, lineIds, operatorId, attendance);
}
/**
 * {@link copyHeldGroups} for fired groups, whose copies are fired as their source was: for the
 * dishes {@link waitingDishesOnHoldPaper} keeps in their group, so each of the source's HOLD
 * stations at which a moving dish waits is still recorded for the copy the pass releases them from.
 */
export async function copyWaitingGroups(
  tx: Transaction,
  fromPartyId: string,
  toPartyId: string,
  lineIds: readonly string[],
  operatorId: string,
  attendance?: { recorder: AttendanceRecorder; at: string },
): Promise<Map<string, string>> {
  return copyGroups(tx, "fired", fromPartyId, toPartyId, lineIds, operatorId, attendance);
}
/**
 * Of `dishes`, those of a fired group that wait for the pass (a kitchen record of the dish or an
 * extra asked for and not released), in a group where one such record is at a station recorded
 * as having the group's HOLD paper.
 */
export async function waitingDishesOnHoldPaper(
  tx: Transaction,
  dishes: readonly { id: string; groupId: string }[],
): Promise<string[]> {
  if (dishes.length === 0) return [];
  const recorded = await heldPaperStations(
    tx,
    dishes.map((dish) => dish.groupId),
  );
  const kitchen = await dishKitchenItems(
    tx,
    dishes.map((dish) => dish.id),
  );
  const waiting = (dishId: string) =>
    (kitchen.get(dishId) ?? []).filter(
      (item) => item.requestedAt !== null && item.firedAt === null,
    );
  const onPaper = new Set(
    dishes
      .filter((dish) =>
        waiting(dish.id).some((item) => recorded.get(dish.groupId)?.has(item.stationId) === true),
      )
      .map((dish) => dish.groupId),
  );
  return dishes
    .filter((dish) => onPaper.has(dish.groupId) && waiting(dish.id).length > 0)
    .map((dish) => dish.id);
}

async function copyGroups(
  tx: Transaction,
  state: "held" | "fired",
  fromPartyId: string,
  toPartyId: string,
  lineIds: readonly string[],
  operatorId: string,
  attendance?: { recorder: AttendanceRecorder; at: string },
): Promise<Map<string, string>> {
  const copies = new Map<string, string>();
  if (lineIds.length === 0) return copies;
  const rows = await tx
    .select({
      lineId: workingOrderLines.id,
      billId: workingOrderLines.workingOrderId,
      groupId: orderGroups.id,
      submittedBy: orderGroups.submittedBy,
      holdPrintedAt: orderGroups.holdPrintedAt,
      createdAt: orderGroups.createdAt,
      firedAt: orderGroups.firedAt,
      firedBy: orderGroups.firedBy,
      firedByDeviceId: orderGroups.firedByDeviceId,
      requestKind: orderGroups.requestKind,
    })
    .from(workingOrderLines)
    .innerJoin(orderGroups, eq(orderGroups.id, workingOrderLines.groupId))
    .innerJoin(workingOrders, eq(workingOrders.id, workingOrderLines.workingOrderId))
    .where(
      and(
        inArray(
          workingOrderLines.id,
          sql`(select value from json_each(${JSON.stringify([...new Set(lineIds)])}))`,
        ),
        isNull(sql`+${workingOrderLines.parentLineId}`),
        eq(orderGroups.partyId, fromPartyId),
        eq(orderGroups.state, state),
      ),
    )
    .orderBy(
      asc(orderGroups.position),
      asc(orderGroups.createdAt),
      asc(orderGroups.id),
      asc(workingOrders.orderNumber),
      asc(workingOrderLines.lineNo),
    );
  const sources = new Map<string, Omit<(typeof rows)[number], "lineId"> & { lineIds: string[] }>();
  for (const { lineId, ...row } of rows) {
    const source = sources.get(row.groupId);
    if (source === undefined) sources.set(row.groupId, { ...row, lineIds: [lineId] });
    else source.lineIds.push(lineId);
  }
  if (sources.size === 0) return copies;
  const recorded = await heldPaperStations(tx, [...sources.keys()]);
  const kitchen = await dishKitchenItems(
    tx,
    rows.map((row) => row.lineId),
  );
  let position = await lastPosition(tx, toPartyId);
  let displayNumber = await nextGroupNumber(tx, toPartyId);
  for (const [sourceId, source] of sources) {
    const [copy] = await tx
      .insert(orderGroups)
      .values({
        partyId: toPartyId,
        position: ++position,
        displayNumber: displayNumber++,
        numberPartyId: toPartyId,
        state,
        ...(state === "held"
          ? { firedAt: null, firedBy: null, firedByDeviceId: null, requestKind: "next_course" }
          : {
              firedAt: source.firedAt,
              firedBy: source.firedBy,
              firedByDeviceId: source.firedByDeviceId,
              requestKind: source.requestKind,
            }),
        submittedBy: source.submittedBy,
        holdPrintedAt: source.holdPrintedAt,
        remindAt: null,
        createdAt: source.createdAt,
      })
      .returning({ id: orderGroups.id });
    const copyId = copy!.id;
    copies.set(sourceId, copyId);
    const held = recorded.get(sourceId);
    const stations = new Set<string>();
    for (const lineId of source.lineIds)
      for (const item of kitchen.get(lineId) ?? [])
        if (
          item.firedAt === null &&
          (state === "held" || item.requestedAt !== null) &&
          held?.has(item.stationId) === true
        )
          stations.add(item.stationId);
    if (stations.size > 0) await recordHeldPaper(tx, copyId, stations);
    await tx
      .update(workingOrderLines)
      .set({ groupId: copyId })
      .where(
        or(
          inArray(
            workingOrderLines.id,
            sql`(select value from json_each(${JSON.stringify(source.lineIds)}))`,
          ),
          inArray(
            workingOrderLines.parentLineId,
            sql`(select value from json_each(${JSON.stringify(source.lineIds)}))`,
          ),
        ),
      );
    await recordGroupEvent(
      tx,
      {
        partyId: fromPartyId,
        groupId: sourceId,
        kind: "group.lines_moved",
        actorId: operatorId,
        detail: { lineIds: source.lineIds, to: copyId },
      },
      attendance,
    );
    await recordGroupEvent(
      tx,
      {
        partyId: toPartyId,
        groupId: copyId,
        kind: "group.lines_moved",
        actorId: operatorId,
        detail: { lineIds: source.lineIds, from: sourceId, arrived: true },
      },
      attendance,
    );
  }
  await pointDraftsAtCopies(tx, new Set(rows.map((row) => row.billId)), copies);
  if (state === "held")
    await removeEmptiedHeldGroups(tx, fromPartyId, [...sources.keys()], operatorId, attendance);
  return copies;
}
/**
 * Rewrites the open drafts of `billIds` from each source group to its copy. A staying bill's
 * draft is left alone: `validateDraftPlaces` holds a draft to its own party's groups.
 */
async function pointDraftsAtCopies(
  tx: Transaction,
  billIds: ReadonlySet<string>,
  copies: ReadonlyMap<string, string>,
): Promise<void> {
  const drafts = tx
    .select({ id: orderDrafts.id })
    .from(orderDrafts)
    .where(and(inArray(orderDrafts.billId, [...billIds]), eq(orderDrafts.state, "open")));
  const sourceIds = [...copies.keys()];
  const toCopy = (column: Column) =>
    sql`case ${column} ${sql.join(
      [...copies].map(([sourceId, copyId]) => sql`when ${sourceId} then ${copyId}`),
      sql` `,
    )} else ${column} end`;
  await tx
    .update(orderDraftLines)
    .set({ joinGroupId: toCopy(orderDraftLines.joinGroupId) })
    .where(
      and(
        inArray(orderDraftLines.draftId, drafts),
        inArray(orderDraftLines.joinGroupId, sourceIds),
      ),
    );
  await tx
    .update(orderDraftLines)
    .set({ afterGroupId: toCopy(orderDraftLines.afterGroupId) })
    .where(
      and(
        inArray(orderDraftLines.draftId, drafts),
        inArray(orderDraftLines.afterGroupId, sourceIds),
      ),
    );
}

export async function activeGroupLines(tx: Transaction, groupId: string) {
  const lines = await tx
    .select({
      id: workingOrderLines.id,
      workingOrderId: workingOrderLines.workingOrderId,
      quantity: workingOrderLines.quantity,
      setMenuRole: workingOrderLines.setMenuRole,
      sentAt: workingOrderLines.sentAt,
    })
    .from(workingOrderLines)
    .innerJoin(workingOrders, eq(workingOrders.id, workingOrderLines.workingOrderId))
    .where(
      and(
        eq(workingOrderLines.groupId, groupId),
        isNull(sql`+${workingOrderLines.parentLineId}`),
        onShownBill(),
      ),
    )
    .orderBy(asc(workingOrders.orderNumber), asc(workingOrderLines.lineNo));
  const cancellations = await readLineCancellations(
    tx,
    lines.map((line) => line.id),
  );
  return lines.filter((line) => line.quantity > (cancellations.get(line.id) ?? 0));
}

export async function groupArrivingDishes(
  tx: Transaction,
  cfg: OriginConfig,
  partyId: string,
  billId: string,
  operatorId: string,
  firers: ReadonlyMap<string, Firer>,
  attendance?: { recorder: AttendanceRecorder; at: string },
): Promise<{ fired: string | null; held: string[] }> {
  const dishes = await tx
    .select({
      id: workingOrderLines.id,
      courseId: workingOrderLines.courseId,
      courseActive: kitchenCourses.active,
      sentAt: workingOrderLines.sentAt,
      ticketItemId: ticketItems.id,
      ticketFiredAt: ticketItems.firedAt,
      ticketRequestedAt: ticketItems.requestedAt,
      ticketMadeHere: ticketItems.madeHere,
    })
    .from(workingOrderLines)
    .leftJoin(ticketItems, eq(ticketItems.workingOrderLineId, workingOrderLines.id))
    .leftJoin(kitchenCourses, eq(kitchenCourses.id, workingOrderLines.courseId))
    .where(
      and(
        eq(workingOrderLines.workingOrderId, billId),
        isNull(sql`+${workingOrderLines.parentLineId}`),
        isNull(workingOrderLines.groupId),
        notSetMenuLine(),
      ),
    )
    .orderBy(
      sql`${kitchenCourses.displayOrder} asc nulls first`,
      asc(kitchenCourses.name),
      asc(workingOrderLines.lineNo),
    );
  const released: typeof dishes = [];
  const immediate: typeof dishes = [];
  const heldByCourse = new Map<string | null, typeof dishes>();
  for (const line of dishes) {
    if (serviceRequested({ ...line, groupState: null })) released.push(line);
    else if (line.courseActive !== true) immediate.push(line);
    else {
      const course = heldByCourse.get(line.courseId);
      if (course === undefined) heldByCourse.set(line.courseId, [line]);
      else course.push(line);
    }
  }
  const routing = immediate.length === 0 ? undefined : routingOnce(tx, new Date());
  const firing = [
    // A copy added when a waiting dish was raised carries its parent's sent time, so its request
    // time dates it.
    ...released.map((line) => ({
      id: line.id,
      firedAt: line.ticketFiredAt ?? line.ticketRequestedAt ?? line.sentAt,
    })),
    ...immediate.map((line) => ({ id: line.id, firedAt: routing!.at.toISOString() })),
  ];
  const fired =
    firing.length === 0
      ? null
      : await groupArrived(
          tx,
          partyId,
          billId,
          firing,
          "fire",
          await nextFireKind(tx, partyId),
          operatorId,
          firers,
          attendance,
        );
  if (immediate.length > 0)
    await fireOrderLines(
      tx,
      cfg,
      billId,
      immediate.map((line) => line.id),
      undefined,
      routing,
    );
  const held: string[] = [];
  for (const lines of heldByCourse.values()) {
    held.push(
      (await groupArrived(
        tx,
        partyId,
        billId,
        lines.map((line) => ({ id: line.id, firedAt: null })),
        "hold",
        "next_course",
        operatorId,
        firers,
        attendance,
      ))!,
    );
  }
  return { fired, held };
}

async function groupArrived(
  tx: Transaction,
  partyId: string,
  billId: string,
  lines: readonly { id: string; firedAt: string | null }[],
  release: GroupRelease,
  requestKind: OrderGroupRequestKind,
  operatorId: string,
  firers: ReadonlyMap<string, Firer>,
  attendance?: { recorder: AttendanceRecorder; at: string },
): Promise<string | null> {
  if (lines.length === 0) return null;
  let fired: { at: string; by: Firer } | undefined;
  if (release === "fire") {
    const at = (line: (typeof lines)[number]) => line.firedAt!;
    const first = lines.reduce((earliest, line) => (at(line) < at(earliest) ? line : earliest));
    fired = { at: at(first), by: firers.get(first.id) ?? { personId: operatorId } };
  }
  const groupId = await startGroup(tx, partyId, release, operatorId, requestKind, fired);
  const ids = lines.map((line) => line.id);
  await tx
    .update(workingOrderLines)
    .set({ groupId })
    .where(
      or(
        inArray(workingOrderLines.id, sql`(select value from json_each(${JSON.stringify(ids)}))`),
        inArray(
          workingOrderLines.parentLineId,
          sql`(select value from json_each(${JSON.stringify(ids)}))`,
        ),
      ),
    );
  await recordGroupEvent(
    tx,
    {
      partyId,
      groupId,
      kind: "group.lines_moved",
      actorId: operatorId,
      detail: { workingOrderId: billId, arrived: true },
    },
    attendance,
  );
  return groupId;
}
