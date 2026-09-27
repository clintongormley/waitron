import { and, asc, eq, inArray, isNotNull, isNull, ne, notExists, or, sql } from "drizzle-orm";
import {
  diningTables,
  nowIso,
  orderGroupEvents,
  orderGroups,
  ticketItems,
  visitTables,
  visits,
  workingOrderLines,
  workingOrders,
} from "@waitron/db";
import type { Transaction } from "@waitron/db";
import { AppError, stringToThousandths, thousandthsToDecimal } from "@waitron/shared";
import { trimQuantityForDisplay } from "./receipt-lines.js";
import type { TillConfig } from "./till-config.js";
import { checkAndBumpVisit, runServiceCommand, visitRevisionOfOrder } from "./visits.js";
import {
  advanceSet,
  bumpRevision,
  fireLines,
  fireOrderLines,
  insertTabRound,
  priceTabRound,
  refusePaymentInFlight,
  splitLinesWithinOrder,
  type TabRoundLine,
} from "./working-order.js";
import "./errors.js";

export type GroupRelease = "fire" | "hold";

/** A line of a submitted group: a round line, released with its group rather than by course. */
export type GroupLine = Omit<TabRoundLine, "hold" | "release">;

export interface SubmitGroupsInput {
  submissionId: string;
  expectedVisitRevision: number;
  groups: { lines: GroupLine[]; release: GroupRelease }[];
  /** Add to this HELD group instead of creating one: then `groups` holds one group, `hold`. */
  joinGroupId?: string;
  operatorId: string;
}

export interface VisitCommandArgs {
  submissionId: string;
  expectedVisitRevision: number;
  operatorId: string;
}

export interface OrderGroup {
  id: string;
  position: number;
  state: "held" | "fired";
  firedAt: string | null;
  remindAt: string | null;
  /**
   * Present only when a person has recorded every fired kitchen item of the group ready (a station's
   * advance or the pass's Ready); a group with no kitchen item is never ready.
   */
  ready?: true;
  /** Present only when every fired kitchen item of the group has been sent away from the pass. */
  away?: true;
  /** The group's dish lines, whichever of the visit's bills they sit on. */
  lineIds: string[];
  /** The dishes by staff name, e.g. "2 × Steak, 1 × Fish". */
  summary: string;
}

export interface SubmittedGroups {
  /** The tab the lines went on: the party's next tab when its tab had been paid. */
  tabId: string;
  revision: number;
  /** The groups this submission created or joined, in the order submitted. */
  groups: OrderGroup[];
}

/**
 * Put each submitted group's lines on the visit's tab, released to the kitchen now (`fire`) or held
 * until {@link fireGroup}. Every line is credited to the operator. A group never matches another by
 * course; only `joinGroupId` adds to an existing one.
 */
export async function submitGroups(
  tx: Transaction,
  cfg: TillConfig,
  visitId: string,
  input: SubmitGroupsInput,
): Promise<SubmittedGroups> {
  const { submissionId, expectedVisitRevision, operatorId, ...body } = input;
  return runServiceCommand(
    tx,
    { kind: "visit", visitId },
    submissionId,
    "group.submit",
    { visitId, operatorId, ...body },
    async () => {
      await checkAndBumpVisit(tx, visitId, expectedVisitRevision, "open");
      if (input.groups.length === 0) {
        throw new AppError("management.request_invalid", { field: "groups" });
      }
      if (input.joinGroupId !== undefined) {
        if (input.groups.length !== 1 || input.groups[0]!.release !== "hold") {
          throw new AppError("management.request_invalid", { field: "joinGroupId" });
        }
        await requireHeldGroup(tx, visitId, input.joinGroupId);
      }
      const lines = input.groups.flatMap((group) =>
        group.lines.map((line) => ({
          ...line,
          hold: group.release === "hold",
          release: group.release === "fire",
        })),
      );
      // A first group with no lines prices nothing, as the tab is checked before the empty basket.
      const round = await priceTabRound(
        tx,
        cfg,
        await visitTab(tx, visitId),
        input.groups[0]!.lines.length === 0 ? [] : lines,
      );
      if (input.groups.some((group) => group.lines.length === 0)) {
        throw new AppError("sale.empty_basket", {});
      }
      const { tabId } = round;
      const groupIds: string[] = [];
      for (const group of input.groups) {
        groupIds.push(
          input.joinGroupId ?? (await startGroup(tx, visitId, group.release, operatorId)),
        );
      }
      // The k-th parent row is input line k; an extras child goes with its dish.
      const groupOfLine = input.groups.flatMap((group, i) => group.lines.map(() => groupIds[i]!));
      const groupOfRow = new Map<string, string>();
      let parents = 0;
      const rows = round.rows.map((row) => {
        const groupId =
          row.parentLineId == null ? groupOfLine[parents++]! : groupOfRow.get(row.parentLineId)!;
        groupOfRow.set(row.id!, groupId);
        return { ...row, groupId, creditedTo: operatorId };
      });
      const inserted = await insertTabRound(tx, cfg, round, rows);
      for (const [i, group] of input.groups.entries()) {
        const groupId = groupIds[i]!;
        const fire = group.release === "fire";
        await fireLines(
          tx,
          cfg,
          tabId,
          inserted
            .filter((row) => row.groupId === groupId)
            .map((row) => ({ ...row, hold: !fire, release: fire })),
        );
        await bumpRevision(tx, [tabId]);
        await recordGroupEvent(tx, {
          visitId,
          groupId,
          kind: input.joinGroupId === undefined ? "submitted" : "joined",
          actorId: operatorId,
          detail: { workingOrderId: tabId, release: group.release },
        });
      }
      const listed = new Map(
        (await readGroups(tx, visitId, groupIds)).map((group) => [group.id, group]),
      );
      return {
        tabId,
        revision: await currentRevision(tx, visitId),
        groups: groupIds.map((id) => listed.get(id)!),
      };
    },
  );
}

/**
 * Release a held group: its lines are released bill by bill, in the order the bills were opened,
 * as {@link fireOrderLines} releases them.
 */
export async function fireGroup(
  tx: Transaction,
  cfg: TillConfig,
  visitId: string,
  groupId: string,
  args: VisitCommandArgs,
): Promise<{ revision: number }> {
  return runServiceCommand(
    tx,
    { kind: "visit", visitId },
    args.submissionId,
    "group.fire",
    { visitId, groupId, operatorId: args.operatorId },
    async () => {
      const revision = await checkAndBumpVisit(tx, visitId, args.expectedVisitRevision, "open");
      await requireHeldGroup(tx, visitId, groupId);
      await releaseGroup(tx, cfg, visitId, groupId, args.operatorId, {});
      return { revision };
    },
  );
}

/**
 * The pass's Ready for a group: every fired kitchen item of its dishes, on every bill of the visit,
 * goes straight to `ready`. A held group's items are unfired, so it changes none, yet the command is
 * recorded and the visit's revision moves on.
 */
export async function bumpGroupReady(
  tx: Transaction,
  cfg: TillConfig,
  visitId: string,
  groupId: string,
  args: VisitCommandArgs,
): Promise<{ revision: number }> {
  void cfg;
  return passStep(tx, visitId, groupId, args, "group.ready", async () => {
    await tx
      .update(ticketItems)
      .set(advanceSet("ready"))
      .where(
        and(
          inArray(ticketItems.workingOrderLineId, dishLinesOf(tx, groupId)),
          ne(ticketItems.state, "ready"),
          isNotNull(ticketItems.firedAt),
        ),
      );
  });
}

/** The pass's Away for a group: stamps `away_at` on its ready items not yet away, on every bill. */
export async function markGroupAway(
  tx: Transaction,
  cfg: TillConfig,
  visitId: string,
  groupId: string,
  args: VisitCommandArgs,
): Promise<{ revision: number }> {
  void cfg;
  return passStep(tx, visitId, groupId, args, "group.away", async () => {
    await tx
      .update(ticketItems)
      .set({ awayAt: nowIso() })
      .where(
        and(
          inArray(ticketItems.workingOrderLineId, dishLinesOf(tx, groupId)),
          eq(ticketItems.state, "ready"),
          isNull(ticketItems.awayAt),
        ),
      );
  });
}

async function passStep(
  tx: Transaction,
  visitId: string,
  groupId: string,
  args: VisitCommandArgs,
  kind: "group.ready" | "group.away",
  apply: () => Promise<void>,
): Promise<{ revision: number }> {
  return runServiceCommand(
    tx,
    { kind: "visit", visitId },
    args.submissionId,
    kind,
    { visitId, groupId, operatorId: args.operatorId },
    async () => {
      const revision = await checkAndBumpVisit(tx, visitId, args.expectedVisitRevision, "open");
      await requireGroup(tx, visitId, groupId);
      await apply();
      return { revision };
    },
  );
}

/** The ids of a group's dish lines, as a subquery: an extras line never has a kitchen item. */
function dishLinesOf(tx: Transaction, groupId: string) {
  return tx
    .select({ id: workingOrderLines.id })
    .from(workingOrderLines)
    .where(and(eq(workingOrderLines.groupId, groupId), isNull(workingOrderLines.parentLineId)));
}

/**
 * The course Fire: on an order of a visit, release every held group of the visit that holds a dish
 * of this course on this order, whole and in position order, as {@link fireGroup} does. It touches
 * nothing when the order is on no visit or no held group qualifies. It carries no submission id, so
 * it records no replay: each group's `fired` event names the course and the order.
 */
export async function fireHeldGroupsOfCourse(
  tx: Transaction,
  cfg: TillConfig,
  orderId: string,
  courseId: string,
  operatorId: string,
): Promise<void> {
  const visit = await visitRevisionOfOrder(tx, orderId);
  if (visit === null) return;
  const visitId = visit.id;
  const groups = await tx
    .selectDistinct({
      id: orderGroups.id,
      position: orderGroups.position,
      createdAt: orderGroups.createdAt,
    })
    .from(orderGroups)
    .innerJoin(workingOrderLines, eq(workingOrderLines.groupId, orderGroups.id))
    .where(
      and(
        eq(orderGroups.visitId, visitId),
        eq(orderGroups.state, "held"),
        eq(workingOrderLines.workingOrderId, orderId),
        eq(workingOrderLines.courseId, courseId),
        isNull(workingOrderLines.parentLineId),
      ),
    )
    .orderBy(asc(orderGroups.position), asc(orderGroups.createdAt), asc(orderGroups.id));
  if (groups.length === 0) return;
  await checkAndBumpVisit(tx, visitId, visit.revision, "open");
  for (const group of groups) {
    await releaseGroup(tx, cfg, visitId, group.id, operatorId, {
      courseId,
      workingOrderId: orderId,
    });
  }
}

/**
 * Give every group of `fromVisitId` to `intoVisitId`, after its last position and in their own
 * order: a merge of two parties' bills, whose lines keep their groups.
 */
export async function moveGroupsToVisit(
  tx: Transaction,
  fromVisitId: string,
  intoVisitId: string,
): Promise<void> {
  const groups = await tx
    .select({ id: orderGroups.id })
    .from(orderGroups)
    .where(eq(orderGroups.visitId, fromVisitId))
    .orderBy(asc(orderGroups.position), asc(orderGroups.createdAt), asc(orderGroups.id));
  let position = await lastPosition(tx, intoVisitId);
  for (const group of groups) {
    await tx
      .update(orderGroups)
      .set({ visitId: intoVisitId, position: ++position })
      .where(eq(orderGroups.id, group.id));
  }
}

/**
 * Release a held group's lines bill by bill, in the order the bills were opened, as
 * {@link fireOrderLines} releases them, and record it fired. The caller has moved the visit's
 * revision on and checked the group is held.
 */
async function releaseGroup(
  tx: Transaction,
  cfg: TillConfig,
  visitId: string,
  groupId: string,
  operatorId: string,
  detail: Record<string, unknown>,
): Promise<void> {
  const lines = await tx
    .select({ id: workingOrderLines.id, workingOrderId: workingOrderLines.workingOrderId })
    .from(workingOrderLines)
    .innerJoin(workingOrders, eq(workingOrders.id, workingOrderLines.workingOrderId))
    .where(and(eq(workingOrderLines.groupId, groupId), isNull(workingOrderLines.parentLineId)))
    .orderBy(asc(workingOrders.orderNumber), asc(workingOrderLines.lineNo));
  const byOrder = new Map<string, string[]>();
  for (const line of lines) {
    byOrder.set(line.workingOrderId, [...(byOrder.get(line.workingOrderId) ?? []), line.id]);
  }
  for (const [orderId, lineIds] of byOrder) {
    await fireOrderLines(tx, cfg, orderId, lineIds);
  }
  await tx
    .update(orderGroups)
    .set({ state: "fired", firedAt: nowIso(), firedBy: operatorId })
    .where(eq(orderGroups.id, groupId));
  await recordGroupEvent(tx, { visitId, groupId, kind: "fired", actorId: operatorId, detail });
}

/**
 * Put the visit's held groups in this order. `heldGroupIds` names every held group once; they take
 * the positions the held groups already hold, so a fired group never moves.
 */
export async function reorderHeldGroups(
  tx: Transaction,
  visitId: string,
  heldGroupIds: string[],
  args: VisitCommandArgs,
): Promise<{ revision: number }> {
  return runServiceCommand(
    tx,
    { kind: "visit", visitId },
    args.submissionId,
    "group.reorder",
    { visitId, heldGroupIds, operatorId: args.operatorId },
    async () => {
      const revision = await checkAndBumpVisit(tx, visitId, args.expectedVisitRevision, "open");
      const groups = await tx
        .select({ id: orderGroups.id, state: orderGroups.state, position: orderGroups.position })
        .from(orderGroups)
        .where(and(eq(orderGroups.visitId, visitId), ne(orderGroups.state, "removed")));
      const byId = new Map(groups.map((group) => [group.id, group]));
      for (const id of heldGroupIds) {
        const group = byId.get(id);
        if (group === undefined) throw new AppError("group.not_found", { groupId: id });
        if (group.state !== "held") throw new AppError("group.not_held", { groupId: id });
      }
      const held = groups.filter((group) => group.state === "held");
      if (
        new Set(heldGroupIds).size !== heldGroupIds.length ||
        heldGroupIds.length !== held.length
      ) {
        throw new AppError("management.request_invalid", { field: "heldGroupIds" });
      }
      await refusePaymentInFlight(tx, await billsOfGroups(tx, heldGroupIds));
      const positions = held.map((group) => group.position).sort((a, b) => a - b);
      for (const [i, id] of heldGroupIds.entries()) {
        if (byId.get(id)!.position !== positions[i]) {
          await tx
            .update(orderGroups)
            .set({ position: positions[i]! })
            .where(eq(orderGroups.id, id));
        }
      }
      await recordGroupEvent(tx, {
        visitId,
        groupId: null,
        kind: "reordered",
        actorId: args.operatorId,
        detail: { heldGroupIds },
      });
      return { revision };
    },
  );
}

/**
 * Move dish lines, or part of one, from held groups into another held group or a new one at the end
 * of the sequence. A line stays on its bill; a part moved splits the row. A group the move empties
 * is removed.
 */
export async function moveLinesToGroup(
  tx: Transaction,
  cfg: TillConfig,
  visitId: string,
  moves: { lineId: string; quantity: string }[],
  target: { groupId: string } | "new",
  args: VisitCommandArgs,
): Promise<{ revision: number }> {
  return runServiceCommand(
    tx,
    { kind: "visit", visitId },
    args.submissionId,
    "group.move",
    { visitId, moves, target, operatorId: args.operatorId },
    async () => {
      const revision = await checkAndBumpVisit(tx, visitId, args.expectedVisitRevision, "open");
      if (moves.length === 0 || new Set(moves.map((m) => m.lineId)).size !== moves.length) {
        throw new AppError("management.request_invalid", { field: "moves" });
      }
      if (target !== "new") await requireHeldGroup(tx, visitId, target.groupId);
      const lines = await tx
        .select({
          id: workingOrderLines.id,
          workingOrderId: workingOrderLines.workingOrderId,
          lineNo: workingOrderLines.lineNo,
          quantity: workingOrderLines.quantity,
          groupId: workingOrderLines.groupId,
          groupState: orderGroups.state,
          billStatus: workingOrders.status,
        })
        .from(workingOrderLines)
        .innerJoin(orderGroups, eq(orderGroups.id, workingOrderLines.groupId))
        .innerJoin(workingOrders, eq(workingOrders.id, workingOrderLines.workingOrderId))
        .where(
          and(
            inArray(
              workingOrderLines.id,
              moves.map((m) => m.lineId),
            ),
            isNull(workingOrderLines.parentLineId),
            eq(orderGroups.visitId, visitId),
            ne(orderGroups.state, "removed"),
          ),
        );
      // An extras line is not found on its own: it moves only with its dish.
      const lineById = new Map(lines.map((line) => [line.id, line]));
      for (const { lineId } of moves) {
        const line = lineById.get(lineId);
        if (line === undefined) throw new AppError("group.not_found", { lineId });
        if (line.groupState !== "held") {
          throw new AppError("group.not_held", { groupId: line.groupId! });
        }
        // A paid bill may still hold a held line; its lines can no longer be written.
        if (line.billStatus !== "open") {
          throw new AppError("working_order.not_open", { workingOrderId: line.workingOrderId });
        }
      }
      const targetId =
        target === "new" ? await startGroup(tx, visitId, "hold", args.operatorId) : target.groupId;
      const sources = new Set<string>();
      const splitsByBill = new Map<string, { lineNo: number; quantity: string }[]>();
      for (const { lineId, quantity } of moves) {
        const line = lineById.get(lineId)!;
        sources.add(line.groupId!);
        const splits = splitsByBill.get(line.workingOrderId) ?? [];
        splitsByBill.set(line.workingOrderId, splits);
        if (isWholeLine(quantity, line.quantity)) {
          await tx
            .update(workingOrderLines)
            .set({ groupId: targetId })
            .where(
              or(eq(workingOrderLines.id, lineId), eq(workingOrderLines.parentLineId, lineId)),
            );
        } else {
          splits.push({ lineNo: line.lineNo, quantity });
        }
      }
      for (const [billId, splits] of splitsByBill) {
        if (splits.length === 0) continue;
        const splitIds = await splitLinesWithinOrder(tx, cfg, billId, splits);
        await tx
          .update(workingOrderLines)
          .set({ groupId: targetId })
          .where(inArray(workingOrderLines.id, splitIds));
      }
      await bumpRevision(tx, [...splitsByBill.keys()]);
      await recordGroupEvent(tx, {
        visitId,
        groupId: targetId,
        kind: "lines_moved",
        actorId: args.operatorId,
        detail: { moves, from: [...sources] },
      });
      await removeEmptiedHeldGroups(tx, visitId, [...sources], args.operatorId);
      return { revision };
    },
  );
}

/**
 * A new group at the end of the visit's sequence, fired now or held, submitted by the operator. The
 * caller puts its lines in it and records its event.
 */
export async function startGroup(
  tx: Transaction,
  visitId: string,
  release: GroupRelease,
  operatorId: string,
): Promise<string> {
  const fire = release === "fire";
  const [group] = await tx
    .insert(orderGroups)
    .values({
      visitId,
      position: (await lastPosition(tx, visitId)) + 1,
      state: fire ? "fired" : "held",
      firedAt: fire ? nowIso() : null,
      firedBy: fire ? operatorId : null,
      submittedBy: operatorId,
    })
    .returning({ id: orderGroups.id });
  return group!.id;
}

/**
 * Mark `removed`, with a `removed` event naming the operator, each of these groups that is held and
 * has no line left on any bill. A fired group stays as it is.
 */
export async function removeEmptiedHeldGroups(
  tx: Transaction,
  visitId: string,
  groupIds: readonly string[],
  operatorId: string | undefined,
): Promise<void> {
  if (groupIds.length === 0) return;
  const emptied = new Set(
    (
      await tx
        .select({ id: orderGroups.id })
        .from(orderGroups)
        .where(
          and(
            inArray(orderGroups.id, [...groupIds]),
            eq(orderGroups.state, "held"),
            notExists(
              tx
                .select({ id: workingOrderLines.id })
                .from(workingOrderLines)
                .where(eq(workingOrderLines.groupId, orderGroups.id)),
            ),
          ),
        )
    ).map((group) => group.id),
  );
  if (emptied.size === 0) return;
  const actorId = requireOperator(operatorId);
  await tx
    .update(orderGroups)
    .set({ state: "removed" })
    .where(inArray(orderGroups.id, [...emptied]));
  for (const groupId of new Set(groupIds)) {
    if (!emptied.has(groupId)) continue;
    await recordGroupEvent(tx, { visitId, groupId, kind: "removed", actorId, detail: {} });
  }
}

/** The operator a group write names, else `management.request_invalid`: an event needs one. */
export function requireOperator(operatorId: string | undefined): string {
  if (operatorId === undefined) {
    throw new AppError("management.request_invalid", { field: "operatorId" });
  }
  return operatorId;
}

/** The visit's groups in sequence, removed ones left out, with the visit's revision. */
export async function listOrderGroups(
  tx: Transaction,
  visitId: string,
): Promise<{ revision: number; groups: OrderGroup[] }> {
  return { revision: await currentRevision(tx, visitId), groups: await readGroups(tx, visitId) };
}

/** The visit's groups in sequence, removed ones left out; only those named, when `only` is given. */
async function readGroups(
  tx: Transaction,
  visitId: string,
  only?: readonly string[],
): Promise<OrderGroup[]> {
  const scope = only === undefined ? [] : [inArray(orderGroups.id, [...only])];
  const groups = await tx
    .select({
      id: orderGroups.id,
      position: orderGroups.position,
      state: orderGroups.state,
      firedAt: orderGroups.firedAt,
      remindAt: orderGroups.remindAt,
    })
    .from(orderGroups)
    .where(and(eq(orderGroups.visitId, visitId), ne(orderGroups.state, "removed"), ...scope))
    .orderBy(asc(orderGroups.position), asc(orderGroups.createdAt), asc(orderGroups.id));
  const lines = await tx
    .select({
      id: workingOrderLines.id,
      groupId: workingOrderLines.groupId,
      name: workingOrderLines.name,
      variantName: workingOrderLines.variantName,
      quantity: workingOrderLines.quantity,
    })
    .from(workingOrderLines)
    .innerJoin(orderGroups, eq(orderGroups.id, workingOrderLines.groupId))
    .innerJoin(workingOrders, eq(workingOrders.id, workingOrderLines.workingOrderId))
    .where(and(eq(orderGroups.visitId, visitId), isNull(workingOrderLines.parentLineId), ...scope))
    .orderBy(asc(workingOrders.orderNumber), asc(workingOrderLines.lineNo));
  const kitchen = await tx
    .select({
      groupId: workingOrderLines.groupId,
      fired: sql<number>`count(*)`,
      ready: sql<number>`sum(${ticketItems.state} = 'ready')`,
      away: sql<number>`sum(${ticketItems.awayAt} is not null)`,
    })
    .from(ticketItems)
    .innerJoin(workingOrderLines, eq(workingOrderLines.id, ticketItems.workingOrderLineId))
    .innerJoin(orderGroups, eq(orderGroups.id, workingOrderLines.groupId))
    .where(and(eq(orderGroups.visitId, visitId), isNotNull(ticketItems.firedAt), ...scope))
    .groupBy(workingOrderLines.groupId);
  const readyGroups = new Set(
    kitchen.filter((row) => row.ready === row.fired).map((row) => row.groupId!),
  );
  const awayGroups = new Set(
    kitchen.filter((row) => row.away === row.fired).map((row) => row.groupId!),
  );
  const linesByGroup = new Map<string, typeof lines>();
  for (const line of lines) {
    const own = linesByGroup.get(line.groupId!) ?? [];
    own.push(line);
    linesByGroup.set(line.groupId!, own);
  }
  return groups.map((group) => {
    const own = linesByGroup.get(group.id) ?? [];
    const counts = new Map<string, number>();
    for (const line of own) {
      const label = line.variantName === null ? line.name : `${line.name} ${line.variantName}`;
      counts.set(label, (counts.get(label) ?? 0) + line.quantity);
    }
    return {
      ...group,
      state: group.state as "held" | "fired",
      ...(readyGroups.has(group.id) ? { ready: true as const } : {}),
      ...(awayGroups.has(group.id) ? { away: true as const } : {}),
      lineIds: own.map((line) => line.id),
      summary: [...counts]
        .map(
          ([label, quantity]) =>
            `${trimQuantityForDisplay(thousandthsToDecimal(quantity))} × ${label}`,
        )
        .join(", "),
    };
  });
}

/** Whether `quantity` is exactly the line's stored quantity; a malformed one is not. */
function isWholeLine(quantity: string, stored: number): boolean {
  try {
    return stringToThousandths(quantity) === stored;
  } catch {
    return false;
  }
}

/** The bills holding a line of any of these groups. */
async function billsOfGroups(tx: Transaction, groupIds: readonly string[]): Promise<string[]> {
  const rows = await tx
    .selectDistinct({ workingOrderId: workingOrderLines.workingOrderId })
    .from(workingOrderLines)
    .where(inArray(workingOrderLines.groupId, [...groupIds]));
  return rows.map((row) => row.workingOrderId);
}

async function requireHeldGroup(tx: Transaction, visitId: string, groupId: string): Promise<void> {
  if ((await requireGroup(tx, visitId, groupId)) !== "held") {
    throw new AppError("group.not_held", { groupId });
  }
}

/** The state of a group of this visit that is not removed, else `group.not_found`. */
async function requireGroup(
  tx: Transaction,
  visitId: string,
  groupId: string,
): Promise<"held" | "fired"> {
  const [group] = await tx
    .select({ state: orderGroups.state })
    .from(orderGroups)
    .where(and(eq(orderGroups.id, groupId), eq(orderGroups.visitId, visitId)));
  if (group === undefined || group.state === "removed") {
    throw new AppError("group.not_found", { groupId });
  }
  return group.state;
}

/** The tab the visit's tables point at, which may be a paid one the party can still order on. */
async function visitTab(tx: Transaction, visitId: string): Promise<string> {
  const [table] = await tx
    .select({ tabId: diningTables.tabId })
    .from(visitTables)
    .innerJoin(diningTables, eq(diningTables.id, visitTables.tableId))
    .where(and(eq(visitTables.visitId, visitId), isNull(visitTables.leftAt)))
    .orderBy(asc(visitTables.joinedAt), asc(visitTables.id))
    .limit(1);
  if (table?.tabId == null) throw new AppError("visit.not_open", { visitId });
  return table.tabId;
}

async function lastPosition(tx: Transaction, visitId: string): Promise<number> {
  const [{ last }] = await tx
    .select({ last: sql<number>`cast(coalesce(max(${orderGroups.position}), 0) as int)` })
    .from(orderGroups)
    .where(eq(orderGroups.visitId, visitId));
  return last;
}

async function currentRevision(tx: Transaction, visitId: string): Promise<number> {
  const [visit] = await tx
    .select({ revision: visits.revision })
    .from(visits)
    .where(eq(visits.id, visitId));
  if (visit === undefined) throw new AppError("visit.not_open", { visitId });
  return visit.revision;
}

export async function recordGroupEvent(
  tx: Transaction,
  values: typeof orderGroupEvents.$inferInsert,
): Promise<void> {
  await tx.insert(orderGroupEvents).values(values);
}
