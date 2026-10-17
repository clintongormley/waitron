import { readLineNutrition, type LineNutrition } from "./line-nutrition.js";
import {
  readLineCancellations,
  serviceCompletedAt,
  serviceQuantities,
} from "./line-service-state.js";
import type { AttendanceRecorder } from "./attendance-capture.js";
import { captureKitchenActivity } from "./attendance-capture.js";
import type { OrderAttendance } from "./working-order.js";
import {
  and,
  asc,
  eq,
  gt,
  inArray,
  isNotNull,
  isNull,
  ne,
  not,
  notExists,
  or,
  sql,
} from "drizzle-orm";
import type { SQL } from "drizzle-orm";
import { staffPresentationName } from "@waitron/catalogue";
import {
  devices,
  kitchenCourses,
  lineServiceCancellations,
  nowIso,
  orderGroupEvents,
  orderGroups,
  orderDraftRecalledLines,
  orderDrafts,
  ticketItems,
  parties,
  workingOrderLines,
  workingOrders,
} from "@waitron/db";
import type { Transaction } from "@waitron/db";
import { persons } from "@waitron/identity";
import {
  AppError,
  centsToDecimal,
  sumDecimals,
  toScale,
  MONEY_SCALE,
  partyTablesName,
  stringToThousandths,
  thousandthsToDecimal,
} from "@waitron/shared";
import { enqueueHoldCorrections, enqueueKitchenTickets, firedQuantity } from "./kitchen-print.js";
import type { FiredItem, HoldCorrection, TicketState } from "./kitchen-print.js";
import { VENUE_SERVICE } from "./modules.js";
import { trimQuantityForDisplay } from "./receipt-lines.js";
import type { OriginConfig, TillConfig } from "./till-config.js";
import {
  checkAndBumpParty,
  partyFamily,
  partyMainBill,
  partyRevisionOfOrder,
  requireBillOfParty,
  runServiceCommand,
} from "./parties.js";
import {
  advanceSet,
  bumpRevision,
  fireLines,
  fireableLineColumns,
  fireOrderLines,
  insertTabRound,
  isReleased,
  priceTabRound,
  routingOnce,
  type RoutingOnce,
  refusePaymentInFlight,
  splitLinesWithinOrder,
  splitUnitsWithinOrder,
  type TabRoundLine,
} from "./working-order.js";
import "./errors.js";
import { stillMovable } from "./station-move.js";
import { dishKitchenItems, onDishesOrTheirExtras } from "./dish-kitchen.js";
import { readPartyTables } from "./orders-list.js";
import { isRecalledDish, refuseRecalledWrite } from "./draft-source.js";

export type GroupRelease = "fire" | "hold";

/** A line of a submitted group: a round line, released with its group rather than by course. */
export type GroupLine = Omit<TabRoundLine, "hold" | "release">;

export interface SubmitGroupsInput {
  submissionId: string;
  expectedPartyRevision: number;
  groups: {
    lines: GroupLine[];
    release: GroupRelease;
    joinGroupId?: string;
    afterGroupId?: string;
  }[];
  /** Add to this HELD group instead of creating one: then `groups` holds one group, `hold`. */
  joinGroupId?: string;
  operatorId: string;
  /** The bill of the party the lines go on; absent, the party's main bill. */
  billId?: string;
}

export interface PartyCommandArgs {
  submissionId: string;
  expectedPartyRevision: number;
  operatorId: string;
}

/** Who fires a group: a person, or a kitchen display nobody is signed in on. */
export type Firer = { personId: string } | { deviceId: string };

export interface OrderGroup {
  id: string;
  position: number;
  displayNumber: number;
  numberPartyId: string;
  numberPartyLabel?: string;
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
  /** Dishes with active service, excluding recalled sources. */
  lineIds: string[];
  courseIds: string[];
  /** The dishes by staff name, e.g. "2 × Steak, 1 × Fish". */
  summary: string;
}

export interface SubmittedGroups {
  /** The bill the lines went on. */
  tabId: string;
  revision: number;
  /** The groups this submission created or joined, in the order submitted. */
  groups: OrderGroup[];
}

/**
 * Put each submitted group's lines on the party's main bill, or on the bill of the party it names,
 * released to the kitchen now (`fire`) or held until {@link fireGroup}. Every line is credited to
 * the operator. A new held group prints its HOLD ticket where the venue prints held work in advance
 * ({@link printHoldTickets}); lines joining a group whose HOLD ticket was queued print `+N` for it.
 */
export async function submitGroups(
  tx: Transaction,
  cfg: OriginConfig,
  partyId: string,
  input: SubmitGroupsInput,
  attendance?: OrderAttendance,
): Promise<SubmittedGroups> {
  const { submissionId, expectedPartyRevision, operatorId, ...body } = input;
  return runServiceCommand(
    tx,
    { kind: "party", partyId },
    submissionId,
    "group.submit",
    { partyId, operatorId, ...body },
    async () => {
      await checkAndBumpParty(tx, partyId, expectedPartyRevision, "open");
      return placeGroups(
        tx,
        cfg,
        partyId,
        { ...input, revisionMoved: true },
        attendance === undefined
          ? undefined
          : { recorder: attendance.recorder, at: attendance.clock.now().instant.toISOString() },
      );
    },
    cfg.madeHereSink,
  );
}

export type PlaceGroupsInput = Pick<SubmitGroupsInput, "joinGroupId" | "operatorId" | "billId"> & {
  groups: (SubmitGroupsInput["groups"][number] & { existingLineIds?: string[] })[];
  /** The command has already moved the party's revision on, so making a main bill does not. */
  revisionMoved?: boolean;
  /** Draft ids in the same order as the input dishes, before extras become child rows. */
  sourceDraftLineIds?: readonly string[];
};

/**
 * {@link submitGroups} without its replay record or party revision check, for a command that makes
 * both itself.
 */
export async function placeGroups(
  tx: Transaction,
  cfg: OriginConfig,
  partyId: string,
  input: PlaceGroupsInput,
  attendance?: { recorder: AttendanceRecorder; at: string },
): Promise<SubmittedGroups> {
  const { operatorId } = input;
  if (input.groups.length === 0) {
    throw new AppError("management.request_invalid", { field: "groups" });
  }
  if (
    input.joinGroupId !== undefined &&
    (input.groups.length !== 1 ||
      input.groups[0]!.release !== "hold" ||
      input.groups.some(
        (group) => group.joinGroupId !== undefined || group.afterGroupId !== undefined,
      ))
  )
    throw new AppError("management.request_invalid", { field: "joinGroupId" });
  const groups = input.groups.map((group) => ({
    ...group,
    joinGroupId: group.joinGroupId ?? input.joinGroupId,
  }));
  const joined = new Set<string>();
  for (const group of groups) {
    const { joinGroupId, afterGroupId } = group;
    if ((joinGroupId !== undefined || afterGroupId !== undefined) && group.release !== "hold") {
      throw new AppError("management.request_invalid", { field: "release" });
    }
    if (joinGroupId !== undefined) {
      if (afterGroupId !== undefined || joined.has(joinGroupId)) {
        throw new AppError("management.request_invalid", { field: "joinGroupId" });
      }
      joined.add(joinGroupId);
      await requireHeldGroup(tx, partyId, joinGroupId);
    }
    if (afterGroupId !== undefined) await requireHeldGroup(tx, partyId, afterGroupId);
  }
  const lines = input.groups.flatMap((group) =>
    group.lines.map((line) => ({
      ...line,
      hold: group.release === "hold",
      release: group.release === "fire",
    })),
  );
  const tabId = await resolveOrderBill(tx, cfg, partyId, input);
  const empty = (group: PlaceGroupsInput["groups"][number]) =>
    group.lines.length === 0 && (group.existingLineIds?.length ?? 0) === 0;
  // Recalled families already carry their charge and must bypass fresh pricing.
  const round =
    lines.length === 0 && !groups.some(empty)
      ? null
      : await priceTabRound(tx, cfg, tabId, empty(groups[0]!) ? [] : lines, "checked");
  if (groups.some(empty)) {
    throw new AppError("sale.empty_basket", {});
  }
  const groupIds: string[] = [];
  const insertedAfter = new Map<string, string>();
  for (const group of groups) {
    let groupId: string;
    if (group.joinGroupId !== undefined) groupId = group.joinGroupId;
    else if (group.afterGroupId !== undefined) {
      groupId = await startGroupAfter(
        tx,
        partyId,
        insertedAfter.get(group.afterGroupId) ?? group.afterGroupId,
        operatorId,
      );
      insertedAfter.set(group.afterGroupId, groupId);
    } else groupId = await startGroup(tx, partyId, group.release, operatorId);
    groupIds.push(groupId);
  }
  // The k-th parent row is input line k; an extras child goes with its dish.
  const groupOfLine = input.groups.flatMap((group, i) => group.lines.map(() => groupIds[i]!));
  const groupOfRow = new Map<string, string>();
  let parents = 0;
  const rows = (round?.rows ?? []).map((row) => {
    const groupId =
      row.parentLineId == null ? groupOfLine[parents++]! : groupOfRow.get(row.parentLineId)!;
    groupOfRow.set(row.id!, groupId);
    return { ...row, groupId, creditedTo: operatorId };
  });
  const inserted = round === null ? [] : await insertTabRound(tx, cfg, round, rows);
  for (const [index, group] of groups.entries()) {
    const ids = group.existingLineIds ?? [];
    if (ids.length === 0) continue;
    const moved = await tx
      .update(workingOrderLines)
      .set({ groupId: groupIds[index]! })
      .where(
        and(
          eq(workingOrderLines.workingOrderId, tabId),
          or(inArray(workingOrderLines.id, ids), inArray(workingOrderLines.parentLineId, ids)),
        ),
      )
      .returning({
        ...fireableLineColumns,
        lineNo: workingOrderLines.lineNo,
        groupId: workingOrderLines.groupId,
      });
    inserted.push(...moved);
  }
  if (input.sourceDraftLineIds !== undefined) {
    const draftIds = input.sourceDraftLineIds;
    await VENUE_SERVICE.moveAllergyDraftTicks(
      tx,
      partyId,
      rows
        .filter((row) => row.parentLineId == null)
        .map((row, i) => ({
          draftLineId: draftIds[i]!,
          workingLineId: row.id!,
        })),
    );
  }
  const routing = routingOnce(tx, cfg, new Date());
  for (const [i, group] of groups.entries()) {
    const groupId = groupIds[i]!;
    const fire = group.release === "fire";
    await fireLines(
      tx,
      cfg,
      tabId,
      inserted
        .filter((row) => row.groupId === groupId)
        .map((row) => ({ ...row, hold: !fire, release: fire })),
      { routing },
    );
    if (group.joinGroupId !== undefined) {
      await correctJoin(
        tx,
        cfg,
        groupId,
        inserted
          .filter((row) => row.groupId === groupId && row.parentLineId == null)
          .map((row) => row.id!),
      );
    } else if (!fire) {
      await printHoldTickets(tx, cfg, [groupId]);
    }
    await bumpRevision(tx, [tabId]);
    await recordGroupEvent(
      tx,
      {
        partyId,
        groupId,
        kind: group.joinGroupId === undefined ? "submitted" : "joined",
        actorId: operatorId,
        detail: { workingOrderId: tabId, release: group.release },
      },
      attendance,
    );
  }
  const listed = new Map(
    (await readGroups(tx, partyId, groupIds)).map((group) => [group.id, group]),
  );
  return {
    tabId,
    revision: await currentRevision(tx, partyId),
    groups: groupIds.map((id) => listed.get(id)!),
  };
}

/** The bill a submission goes on: the open bill of the party it names, or else the main bill. */
async function resolveOrderBill(
  tx: Transaction,
  cfg: OriginConfig,
  partyId: string,
  input: Pick<PlaceGroupsInput, "billId" | "revisionMoved">,
): Promise<string> {
  const { billId } = input;
  if (billId === undefined) {
    return partyMainBill(tx, cfg, partyId, input.revisionMoved === true ? "moved" : "move");
  } else {
    await requireBillOfParty(tx, partyId, billId);
    return billId;
  }
}

/**
 * Release a held group: its lines are released bill by bill, in the order the bills were opened,
 * as {@link fireOrderLines} releases them.
 */
export async function fireGroup(
  tx: Transaction,
  cfg: OriginConfig,
  partyId: string,
  groupId: string,
  args: PartyCommandArgs,
  firer: Firer = { personId: args.operatorId },
  attendance?: OrderAttendance,
): Promise<{ revision: number }> {
  const routing = routingOnce(tx, cfg, new Date());
  return runServiceCommand(
    tx,
    { kind: "party", partyId },
    args.submissionId,
    "group.fire",
    { partyId, groupId, operatorId: args.operatorId },
    async () => {
      const revision = await checkAndBumpParty(tx, partyId, args.expectedPartyRevision, "open");
      await requireHeldGroup(tx, partyId, groupId);
      await releaseGroup(
        tx,
        cfg,
        partyId,
        groupId,
        firer,
        {},
        routing,
        attendance === undefined || "deviceId" in firer
          ? undefined
          : { recorder: attendance.recorder, at: attendance.clock.now().instant.toISOString() },
      );
      return { revision };
    },
    cfg.madeHereSink,
  );
}

/**
 * The pass's Ready for a group: every fired kitchen item of its lines, on every bill of the party,
 * goes straight to `ready`. A held group's items are unfired, so it changes none, yet the command is
 * recorded and the party's revision moves on.
 */
export async function bumpGroupReady(
  tx: Transaction,
  cfg: TillConfig,
  partyId: string,
  groupId: string,
  args: PartyCommandArgs,
  firer: Firer = { personId: args.operatorId },
  attendance?: OrderAttendance,
): Promise<{ revision: number }> {
  void cfg;
  return passStep(
    tx,
    partyId,
    groupId,
    args,
    "group.ready",
    async () => {
      return tx
        .update(ticketItems)
        .set(advanceSet("ready"))
        .where(
          and(
            inArray(ticketItems.workingOrderLineId, groupLinesOf(tx, groupId)),
            ne(ticketItems.state, "ready"),
            isNotNull(ticketItems.firedAt),
          ),
        )
        .returning({ orderId: ticketItems.workingOrderId });
    },
    attendance,
    "personId" in firer ? firer.personId : undefined,
  );
}

/** The pass's Away for a group: stamps `away_at` on its ready items not yet away, on every bill. */
export async function markGroupAway(
  tx: Transaction,
  cfg: TillConfig,
  partyId: string,
  groupId: string,
  args: PartyCommandArgs,
  firer: Firer = { personId: args.operatorId },
  attendance?: OrderAttendance,
): Promise<{ revision: number }> {
  void cfg;
  return passStep(
    tx,
    partyId,
    groupId,
    args,
    "group.away",
    async () => {
      return tx
        .update(ticketItems)
        .set({ awayAt: nowIso() })
        .where(
          and(
            inArray(ticketItems.workingOrderLineId, groupLinesOf(tx, groupId)),
            eq(ticketItems.state, "ready"),
            isNull(ticketItems.awayAt),
          ),
        )
        .returning({ orderId: ticketItems.workingOrderId });
    },
    attendance,
    "personId" in firer ? firer.personId : undefined,
  );
}

async function passStep(
  tx: Transaction,
  partyId: string,
  groupId: string,
  args: PartyCommandArgs,
  kind: "group.ready" | "group.away",
  apply: () => Promise<{ orderId: string }[]>,
  attendance: OrderAttendance | undefined,
  personId: string | undefined,
): Promise<{ revision: number }> {
  return runServiceCommand(
    tx,
    { kind: "party", partyId },
    args.submissionId,
    kind,
    { partyId, groupId, operatorId: args.operatorId },
    async () => {
      const revision = await checkAndBumpParty(tx, partyId, args.expectedPartyRevision, "open");
      await requireGroup(tx, partyId, groupId);
      const changed = await apply();
      await captureKitchenActivity(
        tx,
        attendance,
        personId,
        changed.map((row) => row.orderId),
        `party:${partyId}:${args.submissionId}`,
      );
      return { revision };
    },
  );
}

function groupLinesOf(tx: Transaction, groupId: string) {
  return tx
    .select({ id: workingOrderLines.id })
    .from(workingOrderLines)
    .where(eq(workingOrderLines.groupId, groupId));
}

/**
 * The course Fire: on an order of a party, release every held group of the party that holds a dish
 * of this course on this order, whole and in position order, as {@link fireGroup} does. It touches
 * nothing when the order is on no party or no held group qualifies. It carries no submission id, so
 * it records no replay: each group's `fired` event names the course and the order.
 */
export async function fireHeldGroupsOfCourse(
  tx: Transaction,
  cfg: OriginConfig,
  orderId: string,
  courseId: string,
  firer: Firer,
  routing?: RoutingOnce,
  attendance?: OrderAttendance,
): Promise<void> {
  const party = await partyRevisionOfOrder(tx, orderId);
  if (party === null) return;
  const partyId = party.id;
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
        eq(orderGroups.partyId, partyId),
        eq(orderGroups.state, "held"),
        eq(workingOrderLines.workingOrderId, orderId),
        eq(workingOrderLines.courseId, courseId),
        isNull(workingOrderLines.parentLineId),
      ),
    )
    .orderBy(asc(orderGroups.position), asc(orderGroups.createdAt), asc(orderGroups.id));
  if (groups.length === 0) return;
  await checkAndBumpParty(tx, partyId, party.revision, "open");
  const snapshot =
    attendance === undefined || "deviceId" in firer
      ? undefined
      : { recorder: attendance.recorder, at: attendance.clock.now().instant.toISOString() };
  for (const group of groups) {
    await releaseGroup(
      tx,
      cfg,
      partyId,
      group.id,
      firer,
      {
        courseId,
        workingOrderId: orderId,
      },
      routing,
      snapshot,
    );
  }
}

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
 * Release a held group's lines bill by bill, in the order the bills were opened, as
 * {@link fireOrderLines} releases them, and record it fired. The caller has moved the party's
 * revision on and checked the group is held.
 */
async function releaseGroup(
  tx: Transaction,
  cfg: OriginConfig,
  partyId: string,
  groupId: string,
  firer: Firer,
  detail: Record<string, unknown>,
  routing = routingOnce(tx, cfg, new Date()),
  attendance?: { recorder: AttendanceRecorder; at: string },
): Promise<void> {
  const lines = await tx
    .select({
      id: workingOrderLines.id,
      workingOrderId: workingOrderLines.workingOrderId,
      quantity: workingOrderLines.quantity,
    })
    .from(workingOrderLines)
    .innerJoin(workingOrders, eq(workingOrders.id, workingOrderLines.workingOrderId))
    .where(
      and(
        eq(workingOrderLines.groupId, groupId),
        isNull(workingOrderLines.parentLineId),
        not(isRecalledDish(tx)),
      ),
    )
    .orderBy(asc(workingOrders.orderNumber), asc(workingOrderLines.lineNo));
  const cancellations = await readLineCancellations(
    tx,
    lines.map((line) => line.id),
  );
  const active = lines.filter((line) => line.quantity > (cancellations.get(line.id) ?? 0));
  if (active.length === 0) throw new AppError("management.request_invalid", { field: "groupId" });
  const byOrder = new Map<string, string[]>();
  for (const line of active) {
    byOrder.set(line.workingOrderId, [...(byOrder.get(line.workingOrderId) ?? []), line.id]);
  }
  const [group] = await tx
    .select({ holdPrintedAt: orderGroups.holdPrintedAt })
    .from(orderGroups)
    .where(eq(orderGroups.id, groupId));
  // The marker, not the setting: a group whose HOLD ticket was queued is fired by a FIRE slip.
  const mark = group!.holdPrintedAt === null ? undefined : "FIRE";
  // Every bill in this group must use the same station snapshot at the release instant.
  await routing();
  for (const [orderId, lineIds] of byOrder) {
    await fireOrderLines(tx, cfg, orderId, lineIds, mark, routing);
  }
  await tx
    .update(orderGroups)
    .set({
      state: "fired",
      firedAt: routing.at.toISOString(),
      remindAt: null,
      ...("deviceId" in firer
        ? { firedBy: null, firedByDeviceId: firer.deviceId }
        : { firedBy: firer.personId, firedByDeviceId: null }),
    })
    .where(eq(orderGroups.id, groupId));
  await recordGroupEvent(
    tx,
    {
      partyId,
      groupId,
      kind: "fired",
      detail,
      ...("deviceId" in firer ? { actorDeviceId: firer.deviceId } : { actorId: firer.personId }),
    },
    attendance,
  );
}

/**
 * Put the party's held groups in this order. `heldGroupIds` names every held group once; they take
 * the positions the held groups already hold, so a fired group never moves.
 */
export async function reorderHeldGroups(
  tx: Transaction,
  partyId: string,
  heldGroupIds: string[],
  args: PartyCommandArgs,
  attendance?: OrderAttendance,
): Promise<{ revision: number }> {
  return runServiceCommand(
    tx,
    { kind: "party", partyId },
    args.submissionId,
    "group.reorder",
    { partyId, heldGroupIds, operatorId: args.operatorId },
    async () => {
      const revision = await checkAndBumpParty(tx, partyId, args.expectedPartyRevision, "open");
      const groups = await tx
        .select({ id: orderGroups.id, state: orderGroups.state, position: orderGroups.position })
        .from(orderGroups)
        .where(and(eq(orderGroups.partyId, partyId), ne(orderGroups.state, "removed")));
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
          // A snooze belongs to the place in the sequence it was given at.
          await tx
            .update(orderGroups)
            .set({ position: positions[i]!, remindAt: null })
            .where(eq(orderGroups.id, id));
        }
      }
      await recordGroupEvent(
        tx,
        {
          partyId,
          groupId: null,
          kind: "reordered",
          actorId: args.operatorId,
          detail: { heldGroupIds },
        },
        attendance === undefined
          ? undefined
          : { recorder: attendance.recorder, at: attendance.clock.now().instant.toISOString() },
      );
      return { revision };
    },
  );
}

/** The longest snooze, in whole minutes. */
export const MAX_SNOOZE_MINUTES = 120;

/**
 * Snooze the release reminder of the group waiting: its `remind_at`
 * becomes now plus `minutes` (D11).
 */
export async function snoozeReminder(
  tx: Transaction,
  cfg: TillConfig,
  partyId: string,
  groupId: string,
  minutes: number,
  args: PartyCommandArgs,
): Promise<{ revision: number }> {
  return runServiceCommand(
    tx,
    { kind: "party", partyId },
    args.submissionId,
    "group.snooze",
    { partyId, groupId, minutes, operatorId: args.operatorId },
    async () => {
      const revision = await checkAndBumpParty(tx, partyId, args.expectedPartyRevision, "open");
      if (!Number.isInteger(minutes) || minutes < 1 || minutes > MAX_SNOOZE_MINUTES) {
        throw new AppError("management.request_invalid", { field: "minutes" });
      }
      await requireWaitingGroup(tx, partyId, groupId);
      await tx
        .update(orderGroups)
        .set({ remindAt: new Date(Date.now() + minutes * 60_000).toISOString() })
        .where(eq(orderGroups.id, groupId));
      return { revision };
    },
    cfg.madeHereSink,
  );
}

/**
 * Clear the snooze of the group waiting, so its reminder falls due as if never snoozed. A group
 * with no snooze is accepted and left as it is.
 */
export async function unsnoozeReminder(
  tx: Transaction,
  cfg: TillConfig,
  partyId: string,
  groupId: string,
  args: PartyCommandArgs,
): Promise<{ revision: number }> {
  return runServiceCommand(
    tx,
    { kind: "party", partyId },
    args.submissionId,
    "group.unsnooze",
    { partyId, groupId, operatorId: args.operatorId },
    async () => {
      const revision = await checkAndBumpParty(tx, partyId, args.expectedPartyRevision, "open");
      await requireWaitingGroup(tx, partyId, groupId);
      await tx.update(orderGroups).set({ remindAt: null }).where(eq(orderGroups.id, groupId));
      return { revision };
    },
    cfg.madeHereSink,
  );
}

/**
 * Move dish lines, or part of one, from held groups into another held group or a new one at the end
 * of the sequence. A line stays on its bill; a part moved splits the row. A group the move empties
 * is removed. What moved prints `-N` for a group it left, and `+N` for one it joined, whose HOLD
 * ticket was queued; a new group prints its own HOLD ticket where the venue prints held work in
 * advance ({@link printHoldTickets}).
 */
export async function moveLinesToGroup(
  tx: Transaction,
  cfg: TillConfig,
  partyId: string,
  moves: { lineId: string; quantity: string }[],
  target: { groupId: string } | "new",
  args: PartyCommandArgs,
  attendance?: OrderAttendance,
): Promise<{ revision: number }> {
  return runServiceCommand(
    tx,
    { kind: "party", partyId },
    args.submissionId,
    "group.move",
    { partyId, moves, target, operatorId: args.operatorId },
    async () => {
      const revision = await checkAndBumpParty(tx, partyId, args.expectedPartyRevision, "open");
      if (moves.length === 0 || new Set(moves.map((m) => m.lineId)).size !== moves.length) {
        throw new AppError("management.request_invalid", { field: "moves" });
      }
      if (target !== "new") await requireHeldGroup(tx, partyId, target.groupId);
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
            eq(orderGroups.partyId, partyId),
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
      await refuseRecalledWrite(
        tx,
        inArray(
          workingOrderLines.id,
          moves.map((move) => move.lineId),
        ),
      );
      const printed = await printedHeldGroups(tx, [
        ...lines.map((line) => line.groupId!),
        ...(target === "new" ? [] : [target.groupId]),
      ]);
      const numberLabels = await readGroupNumberLabels(tx, [partyId]);
      const heldItems = await heldItemsOf(
        tx,
        moves.map((m) => m.lineId),
      );
      const targetId =
        target === "new" ? await startGroup(tx, partyId, "hold", args.operatorId) : target.groupId;
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
      const splitIds = new Map<string, string>();
      for (const [billId, splits] of splitsByBill) {
        if (splits.length === 0) continue;
        const split = await splitLinesWithinOrder(tx, cfg, billId, splits);
        await tx
          .update(workingOrderLines)
          .set({ groupId: targetId })
          .where(
            inArray(
              workingOrderLines.id,
              [...split.values()].map((row) => row.id),
            ),
          );
        for (const [from, to] of split) splitIds.set(from, to.id);
      }
      const taken: HeldChange[] = [];
      const given: HeldChange[] = [];
      for (const { lineId, quantity } of moves) {
        const line = lineById.get(lineId)!;
        const items = heldItems.get(lineId);
        if (items === undefined || line.groupId === targetId) continue;
        const split = splitIds.get(lineId);
        for (const item of items) {
          // A partial move has no split-off extras; a whole move uses each record's own line.
          const moved = split === undefined ? item.lineQuantity : stringToThousandths(quantity);
          const change = {
            workingOrderId: line.workingOrderId,
            stationId: item.stationId,
            quantity: moved,
          };
          const from = printed.get(line.groupId!);
          if (from !== undefined)
            taken.push({
              ...change,
              workingOrderLineId: item.workingOrderLineId,
              group: from,
              numberPartyLabel: numberLabels.get(line.groupId!),
            });
          const to = printed.get(targetId);
          if (to !== undefined) {
            given.push({
              ...change,
              workingOrderLineId: split ?? item.workingOrderLineId,
              group: to,
              numberPartyLabel: numberLabels.get(targetId),
            });
          }
        }
      }
      await correctHoldTickets(tx, cfg, taken, { kind: "HOLD CHANGED", direction: "removed" });
      await correctHoldTickets(tx, cfg, given, { kind: "HOLD CHANGED", direction: "added" });
      if (target === "new") await printHoldTickets(tx, cfg, [targetId]);
      await bumpRevision(tx, [...splitsByBill.keys()]);
      const snapshot =
        attendance === undefined
          ? undefined
          : { recorder: attendance.recorder, at: attendance.clock.now().instant.toISOString() };
      await recordGroupEvent(
        tx,
        {
          partyId,
          groupId: targetId,
          kind: "lines_moved",
          actorId: args.operatorId,
          detail: { moves, from: [...sources] },
        },
        snapshot,
      );
      await removeEmptiedHeldGroups(tx, partyId, [...sources], args.operatorId, snapshot);
      return { revision };
    },
    cfg.madeHereSink,
  );
}

export async function splitHeldLineIntoUnits(
  tx: Transaction,
  cfg: TillConfig,
  partyId: string,
  lineId: string,
  args: PartyCommandArgs,
  attendance?: OrderAttendance,
): Promise<{ revision: number }> {
  return runServiceCommand(
    tx,
    { kind: "party", partyId },
    args.submissionId,
    "group.split_line",
    { partyId, lineId, operatorId: args.operatorId },
    async () => {
      const revision = await checkAndBumpParty(tx, partyId, args.expectedPartyRevision, "open");
      const [source] = await tx
        .select({ draft: orderDrafts, line: workingOrderLines, ownerName: persons.displayName })
        .from(orderDraftRecalledLines)
        .innerJoin(orderDrafts, eq(orderDrafts.id, orderDraftRecalledLines.draftId))
        .innerJoin(
          workingOrderLines,
          eq(workingOrderLines.id, orderDraftRecalledLines.sourceLineId),
        )
        .leftJoin(persons, eq(persons.id, orderDrafts.ownerId))
        .where(
          and(eq(orderDraftRecalledLines.sourceLineId, lineId), eq(orderDrafts.state, "open")),
        );
      if (source !== undefined) {
        if (
          source.draft.partyId !== partyId ||
          source.line.parentLineId !== null ||
          source.draft.billId !== source.line.workingOrderId
        )
          throw new AppError("group.not_found", { lineId });
        if (source.draft.ownerId !== args.operatorId)
          throw new AppError("draft.taken_over", {
            draftId: source.draft.id,
            ownerId: source.draft.ownerId,
            ownerName: source.ownerName ?? "",
          });
        await requireBillOfParty(tx, partyId, source.line.workingOrderId);
        await refusePaymentInFlight(tx, [source.line.workingOrderId]);
        if (
          source.line.unitPrecision !== 0 ||
          source.line.quantity < 2000 ||
          source.line.quantity % 1000 !== 0
        )
          throw new AppError("tab.transfer_quantity_invalid", {
            tabId: source.line.workingOrderId,
            lineNo: source.line.lineNo,
            quantity: thousandthsToDecimal(source.line.quantity),
          });
        for (let unit = 1; unit < source.line.quantity / 1000; unit += 1)
          await splitLinesWithinOrder(
            tx,
            cfg,
            source.line.workingOrderId,
            [{ lineNo: source.line.lineNo, quantity: "1" }],
            { splitExtras: true },
          );
        await tx
          .update(orderDrafts)
          .set({ revision: source.draft.revision + 1, updatedAt: nowIso() })
          .where(eq(orderDrafts.id, source.draft.id));
        await bumpRevision(tx, [source.line.workingOrderId]);
        await recordGroupEvent(
          tx,
          {
            partyId,
            groupId: source.line.groupId,
            kind: "lines_moved",
            actorId: args.operatorId,
            detail: { splitLineId: lineId },
          },
          attendance === undefined
            ? undefined
            : { recorder: attendance.recorder, at: attendance.clock.now().instant.toISOString() },
        );
        return { revision };
      }
      const [line] = await tx
        .select({
          workingOrderId: workingOrderLines.workingOrderId,
          lineNo: workingOrderLines.lineNo,
          groupId: workingOrderLines.groupId,
          groupState: orderGroups.state,
          billStatus: workingOrders.status,
        })
        .from(workingOrderLines)
        .innerJoin(orderGroups, eq(orderGroups.id, workingOrderLines.groupId))
        .innerJoin(workingOrders, eq(workingOrders.id, workingOrderLines.workingOrderId))
        .where(
          and(
            eq(workingOrderLines.id, lineId),
            isNull(workingOrderLines.parentLineId),
            eq(orderGroups.partyId, partyId),
            ne(orderGroups.state, "removed"),
          ),
        );
      if (line === undefined) throw new AppError("group.not_found", { lineId });
      if (line.groupState !== "held")
        throw new AppError("group.not_held", { groupId: line.groupId! });
      if (line.billStatus !== "open")
        throw new AppError("working_order.not_open", { workingOrderId: line.workingOrderId });
      await refusePaymentInFlight(tx, [line.workingOrderId]);
      await splitUnitsWithinOrder(tx, cfg, line.workingOrderId, line.lineNo);
      await bumpRevision(tx, [line.workingOrderId]);
      await recordGroupEvent(
        tx,
        {
          partyId,
          groupId: line.groupId!,
          kind: "lines_moved",
          actorId: args.operatorId,
          detail: { splitLineId: lineId },
        },
        attendance === undefined
          ? undefined
          : { recorder: attendance.recorder, at: attendance.clock.now().instant.toISOString() },
      );
      return { revision };
    },
    cfg.madeHereSink,
  );
}

/**
 * A new group at the end of the party's sequence, fired or held, submitted by the operator. The
 * caller puts its lines in it and records its event.
 */
export async function startGroup(
  tx: Transaction,
  partyId: string,
  release: GroupRelease,
  operatorId: string,
  fired: { at: string; by: Firer } = { at: nowIso(), by: { personId: operatorId } },
): Promise<string> {
  const fire = release === "fire";
  const [group] = await tx
    .insert(orderGroups)
    .values({
      partyId,
      position: (await lastPosition(tx, partyId)) + 1,
      displayNumber: await nextGroupNumber(tx, partyId),
      numberPartyId: partyId,
      state: fire ? "fired" : "held",
      firedAt: fire ? fired.at : null,
      firedBy: fire && "personId" in fired.by ? fired.by.personId : null,
      firedByDeviceId: fire && "deviceId" in fired.by ? fired.by.deviceId : null,
      submittedBy: operatorId,
    })
    .returning({ id: orderGroups.id });
  return group!.id;
}

export async function startGroupAfter(
  tx: Transaction,
  partyId: string,
  afterGroupId: string,
  operatorId: string,
): Promise<string> {
  await requireHeldGroup(tx, partyId, afterGroupId);
  const [anchor] = await tx
    .select({ position: orderGroups.position })
    .from(orderGroups)
    .where(eq(orderGroups.id, afterGroupId));
  const groupId = await startGroup(tx, partyId, "hold", operatorId);
  await tx
    .update(orderGroups)
    .set({ position: sql`${orderGroups.position} + 1`, remindAt: null })
    .where(
      and(
        eq(orderGroups.partyId, partyId),
        gt(orderGroups.position, anchor!.position),
        ne(orderGroups.id, groupId),
      ),
    );
  await tx
    .update(orderGroups)
    .set({ position: anchor!.position + 1 })
    .where(eq(orderGroups.id, groupId));
  return groupId;
}

/**
 * Mark `removed`, with a `removed` event naming the operator, each of these groups that is held and
 * has no line left on any bill. A fired group stays as it is.
 */
export async function removeEmptiedHeldGroups(
  tx: Transaction,
  partyId: string,
  groupIds: readonly string[],
  operatorId: string | undefined,
  attendance?: { recorder: AttendanceRecorder; at: string },
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
    .set({ state: "removed", remindAt: null })
    .where(inArray(orderGroups.id, [...emptied]));
  for (const groupId of new Set(groupIds)) {
    if (!emptied.has(groupId)) continue;
    await recordGroupEvent(
      tx,
      { partyId, groupId, kind: "removed", actorId, detail: {} },
      attendance,
    );
  }
}

/** The operator a group write names, else `management.request_invalid`: an event needs one. */
export function requireOperator(operatorId: string | undefined): string {
  if (operatorId === undefined) {
    throw new AppError("management.request_invalid", { field: "operatorId" });
  }
  return operatorId;
}

/** The party's groups in sequence, removed ones left out, with the party's revision. */
export async function listOrderGroups(
  tx: Transaction,
  partyId: string,
): Promise<{ revision: number; groups: OrderGroup[] }> {
  return { revision: await currentRevision(tx, partyId), groups: await readGroups(tx, partyId) };
}

/** The party's groups in sequence, removed ones left out; only those named, when `only` is given. */
async function readGroups(
  tx: Transaction,
  partyId: string,
  only?: readonly string[],
): Promise<OrderGroup[]> {
  const numberLabels = await readGroupNumberLabels(tx, [partyId]);
  const scope = only === undefined ? [] : [inArray(orderGroups.id, [...only])];
  const groups = await tx
    .select({
      id: orderGroups.id,
      position: orderGroups.position,
      displayNumber: orderGroups.displayNumber,
      numberPartyId: orderGroups.numberPartyId,
      state: orderGroups.state,
      firedAt: orderGroups.firedAt,
      remindAt: orderGroups.remindAt,
    })
    .from(orderGroups)
    .where(and(eq(orderGroups.partyId, partyId), ne(orderGroups.state, "removed"), ...scope))
    .orderBy(asc(orderGroups.position), asc(orderGroups.createdAt), asc(orderGroups.id));
  const lines = await tx
    .select({
      id: workingOrderLines.id,
      groupId: workingOrderLines.groupId,
      name: workingOrderLines.name,
      variantName: workingOrderLines.variantName,
      quantity: workingOrderLines.quantity,
      courseId: workingOrderLines.courseId,
      recalled: isRecalledDish(tx).mapWith(Boolean),
    })
    .from(workingOrderLines)
    .innerJoin(orderGroups, eq(orderGroups.id, workingOrderLines.groupId))
    .innerJoin(workingOrders, eq(workingOrders.id, workingOrderLines.workingOrderId))
    .where(and(eq(orderGroups.partyId, partyId), isNull(workingOrderLines.parentLineId), ...scope))
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
    .where(and(eq(orderGroups.partyId, partyId), isNotNull(ticketItems.firedAt), ...scope))
    .groupBy(workingOrderLines.groupId);
  const readyGroups = new Set(
    kitchen.filter((row) => row.ready === row.fired).map((row) => row.groupId!),
  );
  const awayGroups = new Set(
    kitchen.filter((row) => row.away === row.fired).map((row) => row.groupId!),
  );
  const linesByGroup = new Map<string, typeof lines>();
  const cancellations = await readLineCancellations(
    tx,
    lines.map((line) => line.id),
  );
  for (const line of lines) {
    const own = linesByGroup.get(line.groupId!) ?? [];
    own.push(line);
    linesByGroup.set(line.groupId!, own);
  }
  return groups.map((group) => {
    const own = linesByGroup.get(group.id) ?? [];
    const active = own
      .filter((line) => !line.recalled)
      .map((line) => ({
        ...line,
        quantity: serviceQuantities(line.quantity, 0, cancellations.get(line.id) ?? 0).active,
      }))
      .filter((line) => line.quantity > 0);
    const counts = new Map<string, number>();
    for (const line of active) {
      const label = staffPresentationName(line);
      counts.set(label, (counts.get(label) ?? 0) + line.quantity);
    }
    return {
      ...group,
      ...groupNumberIdentity(group),
      ...(numberLabels.has(group.id) ? { numberPartyLabel: numberLabels.get(group.id)! } : {}),
      state: group.state as "held" | "fired",
      ...(readyGroups.has(group.id) ? { ready: true as const } : {}),
      ...(awayGroups.has(group.id) ? { away: true as const } : {}),
      lineIds: active.map((line) => line.id),
      courseIds: [
        ...new Set(own.flatMap((line) => (line.courseId === null ? [] : [line.courseId]))),
      ],
      summary: [...counts]
        .map(
          ([label, quantity]) =>
            `${trimQuantityForDisplay(thousandthsToDecimal(quantity))} × ${label}`,
        )
        .join(", "),
    };
  });
}

/** The group waiting to be released, and when staff are reminded to release it (D11). */
export interface ReleaseReminder {
  groupId: string;
  /** Null while earlier active dishes remain unserved, or when no completion dates it. */
  dueAt: string | null;
}

/** `servedAt` carries the effective completion time, including charged cancellation. */
export function releaseReminder(
  groups: readonly Pick<OrderGroup, "id" | "state" | "remindAt">[],
  lines: readonly { groupId: string | null; servedAt: string | null; fullyCancelled?: true }[],
  minutes: number | null,
): ReleaseReminder | null {
  if (minutes === null) return null;
  const waiting = groups.findIndex((group) => {
    if (group.state !== "held") return false;
    const own = lines.filter((line) => line.groupId === group.id);
    return own.length === 0 || own.some((line) => line.fullyCancelled !== true);
  });
  if (waiting === -1) return null;
  const { id: groupId, remindAt } = groups[waiting]!;
  const ahead = new Set(groups.slice(0, waiting).map((group) => group.id));
  let latest: number | null = null;
  for (const line of lines) {
    if (line.groupId === null || !ahead.has(line.groupId)) continue;
    if (line.servedAt === null) return { groupId, dueAt: null };
    latest = Math.max(latest ?? Number.NEGATIVE_INFINITY, Date.parse(line.servedAt));
  }
  if (remindAt !== null) return { groupId, dueAt: remindAt };
  return {
    groupId,
    dueAt: latest === null ? null : new Date(latest + minutes * 60_000).toISOString(),
  };
}

/**
 * Each of these parties' release reminders ({@link releaseReminder}), keyed by party, from one read
 * of the setting and one each of the parties' groups and dish lines. A party that is not open has
 * none: it can no longer fire or snooze a group. A line on an abandoned bill is left out, as
 * {@link readCurrentOrders} leaves it out.
 */
export async function readReleaseReminders(
  tx: Transaction,
  partyIds: readonly string[],
): Promise<Map<string, ReleaseReminder | null>> {
  const reminders = new Map<string, ReleaseReminder | null>(partyIds.map((id) => [id, null]));
  if (partyIds.length === 0) return reminders;
  const minutes = await VENUE_SERVICE.readReleaseReminderMinutes(tx);
  if (minutes === null) return reminders;
  const groups = await tx
    .select({
      id: orderGroups.id,
      partyId: orderGroups.partyId,
      state: orderGroups.state,
      remindAt: orderGroups.remindAt,
    })
    .from(orderGroups)
    .innerJoin(parties, eq(parties.id, orderGroups.partyId))
    .where(
      and(
        inArray(orderGroups.partyId, [...partyIds]),
        ne(orderGroups.state, "removed"),
        eq(parties.state, "open"),
      ),
    )
    .orderBy(asc(orderGroups.position), asc(orderGroups.createdAt), asc(orderGroups.id));
  if (groups.length === 0) return reminders;
  const lines = await tx
    .select({
      groupId: workingOrderLines.groupId,
      quantity: workingOrderLines.quantity,
      servedQuantity: workingOrderLines.servedQuantity,
      servedAt: workingOrderLines.servedAt,
      cancelledQuantity: sql<number>`coalesce(${lineServiceCancellations.quantity}, 0)`,
      cancelledAt: lineServiceCancellations.cancelledAt,
    })
    .from(workingOrderLines)
    .innerJoin(workingOrders, eq(workingOrders.id, workingOrderLines.workingOrderId))
    .leftJoin(lineServiceCancellations, eq(lineServiceCancellations.lineId, workingOrderLines.id))
    .where(
      and(
        inArray(
          workingOrderLines.groupId,
          groups.map((group) => group.id),
        ),
        isNull(workingOrderLines.parentLineId),
        onShownBill(),
        not(isRecalledDish(tx)),
      ),
    );
  for (const partyId of new Set(groups.map((group) => group.partyId))) {
    const active = new Set(lines.map((line) => line.groupId));
    const own = groups.filter((group) => group.partyId === partyId && active.has(group.id));
    const ids = new Set(own.map((group) => group.id));
    reminders.set(
      partyId,
      releaseReminder(
        own.map((group) => ({ ...group, state: group.state as "held" | "fired" })),
        lines
          .filter((line) => ids.has(line.groupId!))
          .map((line) => ({
            groupId: line.groupId,
            servedAt: serviceCompletedAt(line),
            ...(line.cancelledQuantity >= line.quantity ? { fullyCancelled: true as const } : {}),
          })),
        minutes,
      ),
    );
  }
  return reminders;
}

/** What the kitchen has recorded for a dish row: nothing is inferred, so a station that never
 * records progress leaves `queued` with its fired time. */
export interface CurrentOrderKitchen {
  state: TicketState;
  stationId: string;
  movable: boolean;
  /** Null while the item is held, or since it was recalled. */
  firedAt: string | null;
  /** When the pass sent it away, if it recorded that. */
  awayAt: string | null;
}

/** An extra picked with a dish; it is served with its dish, never on its own. */
export interface CurrentOrderExtra {
  lineId: string;
  /** The staff name. */
  name: string;
  quantity: string;
  netAmount: string;
  unitPriceGross: string;
  priceQuantity: string;
  /** Present only for food cancelled while its charge remains on the bill. */
  cancelledQuantity?: string;
}

/** A dish line of the party, on whichever of its bills, a paid one included. */
export interface CurrentOrderRow {
  billStatus: (typeof workingOrders.$inferSelect)["status"];
  /** Stored dish and extras total, after adjustments. */
  netAmount: string;
  /** All kitchen components must be ready; no kitchen work leaves this null. */
  readyAt: string | null;
  firedAt: string | null;
  nutrition?: LineNutrition;
  lineId: string;
  workingOrderId: string;
  lineNo: number;
  courseId: string | null;
  /** The staff name, the variant's on a variant line. */
  name: string;
  quantity: string;
  /** Part of the billed quantity cancelled without removing its charge. */
  cancelledQuantity?: string;
  /** Decimal places the line's unit takes, so a part can be served (0 = sold by the unit). */
  unitPrecision: number | null;
  servedQuantity: string;
  servedAt: string | null;
  /** Released work, which alone can be marked served. */
  released: boolean;
  /** Null for a dish with no kitchen item, such as one needing no preparation. */
  kitchen: CurrentOrderKitchen | null;
  note: string | null;
  extras: CurrentOrderExtra[];
}

export interface CurrentOrderGroup {
  id: string;
  position: number;
  displayNumber: number;
  numberPartyId: string;
  numberPartyLabel?: string;
  state: "held" | "fired";
  firedAt: string | null;
  /** A snooze's time, until it is cleared or the group fires, empties or moves in a reorder. */
  remindAt: string | null;
  /** A fired group's firing; a held group's holding. */
  sentAt: string;
  /** The display name of whoever fired or held it; null when no person record matches. */
  sentBy: string | null;
  rows: CurrentOrderRow[];
}

/** What the party has ordered and what is known of it (spec §4 Current orders). */
export interface CurrentOrders {
  revision: number;
  hasGroups: boolean;
  nextDisplayNumber: number;
  retainedCourses: { id: string; name: string; displayOrder: number; heldUntilFired: boolean }[];
  reminder: ReleaseReminder | null;
  /** In sequence, removed ones left out. */
  groups: CurrentOrderGroup[];
  /** Dish lines in no group, such as a round sent straight to a bill. */
  ungrouped: CurrentOrderRow[];
}

/** The bills Current orders shows, and serving acts on: every one but an abandoned bill. */
export function onShownBill(): SQL {
  return ne(workingOrders.status, "abandoned");
}

/**
 * The party's Current orders: its groups in sequence with their dish rows, and the rows in no
 * group, across every bill of the party and of every party merged into it, paid ones included; rows
 * bill by bill in the order the bills were opened. An abandoned bill's lines are left out, as the
 * kitchen's reads leave them out. A row whose group belongs to another party's sequence (on a party
 * merged away, whose groups moved on) is shown there, not here. Refused `party.not_open` for an
 * unknown party.
 */
export async function readCurrentOrders(tx: Transaction, partyId: string): Promise<CurrentOrders> {
  const [party] = await tx
    .select({ revision: parties.revision, state: parties.state })
    .from(parties)
    .where(eq(parties.id, partyId));
  if (party === undefined) throw new AppError("party.not_open", { partyId });
  const family = await partyFamily(tx, partyId);
  const nextDisplayNumber = await nextGroupNumber(tx, partyId);
  const numberLabels = await readGroupNumberLabels(tx, [partyId]);
  const groups = await tx
    .select({
      id: orderGroups.id,
      position: orderGroups.position,
      displayNumber: orderGroups.displayNumber,
      numberPartyId: orderGroups.numberPartyId,
      state: orderGroups.state,
      firedAt: orderGroups.firedAt,
      remindAt: orderGroups.remindAt,
      createdAt: orderGroups.createdAt,
      sentBy: sql<string | null>`coalesce(${persons.displayName}, ${devices.label})`,
    })
    .from(orderGroups)
    .leftJoin(
      persons,
      eq(
        persons.id,
        sql`case when ${orderGroups.state} = 'fired' then ${orderGroups.firedBy} else ${orderGroups.submittedBy} end`,
      ),
    )
    .leftJoin(
      devices,
      and(eq(orderGroups.state, "fired"), eq(devices.id, orderGroups.firedByDeviceId)),
    )
    .where(eq(orderGroups.partyId, partyId))
    .orderBy(asc(orderGroups.position), asc(orderGroups.createdAt), asc(orderGroups.id));
  const lines = await tx
    .select({
      id: workingOrderLines.id,
      workingOrderId: workingOrderLines.workingOrderId,
      billStatus: workingOrders.status,
      lineTotal: workingOrderLines.lineTotal,
      unitPriceGross: workingOrderLines.unitPriceGross,
      priceQuantity: workingOrderLines.priceQuantity,
      lineNo: workingOrderLines.lineNo,
      courseId: workingOrderLines.courseId,
      course: {
        id: kitchenCourses.id,
        name: kitchenCourses.name,
        displayOrder: kitchenCourses.displayOrder,
        heldUntilFired: kitchenCourses.heldUntilFired,
      },
      recalled: isRecalledDish(tx).mapWith(Boolean),
      parentLineId: workingOrderLines.parentLineId,
      name: workingOrderLines.name,
      variantName: workingOrderLines.variantName,
      quantity: workingOrderLines.quantity,
      unitPrecision: workingOrderLines.unitPrecision,
      servedQuantity: workingOrderLines.servedQuantity,
      servedAt: workingOrderLines.servedAt,
      cancelledQuantity: sql<number>`coalesce(${lineServiceCancellations.quantity}, 0)`,
      cancelledAt: lineServiceCancellations.cancelledAt,
      sentAt: workingOrderLines.sentAt,
      note: workingOrderLines.note,
      groupId: workingOrderLines.groupId,
      groupState: orderGroups.state,
      ticketItemId: ticketItems.id,
      ticketState: ticketItems.state,
      ticketFiredAt: ticketItems.firedAt,
      ticketReadyAt: ticketItems.readyAt,
      ticketMadeHere: ticketItems.madeHere,
      awayAt: ticketItems.awayAt,
      stationId: ticketItems.stationId,
    })
    .from(workingOrderLines)
    .innerJoin(workingOrders, eq(workingOrders.id, workingOrderLines.workingOrderId))
    .leftJoin(orderGroups, eq(orderGroups.id, workingOrderLines.groupId))
    .leftJoin(kitchenCourses, eq(kitchenCourses.id, workingOrderLines.courseId))
    .leftJoin(lineServiceCancellations, eq(lineServiceCancellations.lineId, workingOrderLines.id))
    .leftJoin(ticketItems, eq(ticketItems.workingOrderLineId, workingOrderLines.id))
    .where(and(inArray(workingOrders.partyId, family), onShownBill()))
    .orderBy(
      asc(workingOrders.openedAt),
      asc(workingOrders.orderNumber),
      asc(workingOrders.id),
      asc(workingOrderLines.lineNo),
    );
  const nutrition = await readLineNutrition(
    tx,
    lines.map((line) => line.id),
  );
  const extras = new Map<string, CurrentOrderExtra[]>();
  const cancellations = await readLineCancellations(
    tx,
    lines.map((line) => line.id),
  );
  const heldExtras = new Set(
    lines
      .filter(
        (line) =>
          line.parentLineId !== null && line.ticketItemId !== null && line.ticketFiredAt === null,
      )
      .map((line) => line.parentLineId),
  );
  for (const line of lines) {
    if (line.parentLineId === null) continue;
    extras.set(line.parentLineId, [
      ...(extras.get(line.parentLineId) ?? []),
      {
        lineId: line.id,
        name: staffPresentationName({ name: line.name, variantName: line.variantName }),
        quantity: thousandthsToDecimal(line.quantity),
        netAmount: centsToDecimal(line.lineTotal),
        unitPriceGross: centsToDecimal(line.unitPriceGross),
        priceQuantity: thousandthsToDecimal(line.priceQuantity),
        ...((cancellations.get(line.id) ?? 0) > 0
          ? { cancelledQuantity: thousandthsToDecimal(cancellations.get(line.id)!) }
          : {}),
      },
    ]);
  }
  const families = new Map<string, (typeof lines)[number][]>();
  for (const line of lines) {
    const parentId = line.parentLineId ?? line.id;
    const familyLines = families.get(parentId) ?? [];
    familyLines.push(line);
    families.set(parentId, familyLines);
  }
  const shown: CurrentOrderGroup[] = groups
    .filter((group) => group.state !== "removed")
    .map(({ createdAt, ...group }) => ({
      ...group,
      ...groupNumberIdentity(group),
      ...(numberLabels.has(group.id) ? { numberPartyLabel: numberLabels.get(group.id)! } : {}),
      state: group.state as "held" | "fired",
      // `order_groups_fired_at_ck` requires `fired_at` exactly when the group is fired.
      sentAt: group.state === "fired" ? group.firedAt! : createdAt,
      rows: [],
    }));
  const byId = new Map(shown.map((group) => [group.id, group]));
  const ungrouped: CurrentOrderRow[] = [];
  const dishes: { groupId: string | null; servedAt: string | null; fullyCancelled?: true }[] = [];
  const retainedCourses = new Map<string, CurrentOrders["retainedCourses"][number]>();
  for (const line of lines) {
    if (line.parentLineId !== null) continue;
    if (line.course !== null) retainedCourses.set(line.course.id, line.course);
    if (line.recalled) continue;
    const group = line.groupId === null ? undefined : byId.get(line.groupId);
    if (line.groupId !== null && group === undefined) continue;
    dishes.push({
      groupId: line.groupId,
      servedAt: serviceCompletedAt(line),
      ...(line.cancelledQuantity >= line.quantity ? { fullyCancelled: true as const } : {}),
    });
    const familyLines = families.get(line.id)!;
    const kitchenItems = familyLines.filter((component) => component.ticketItemId !== null);
    const allFired = kitchenItems.every((component) => component.ticketFiredAt !== null);
    const firedTimes = kitchenItems.flatMap((component) =>
      component.ticketFiredAt === null ? [] : [component.ticketFiredAt],
    );
    const readyTimes = kitchenItems.flatMap((component) =>
      component.ticketState === "ready" && component.ticketReadyAt !== null
        ? [component.ticketReadyAt]
        : [],
    );
    const row: CurrentOrderRow = {
      billStatus: line.billStatus,
      netAmount: toScale(
        sumDecimals(familyLines.map((component) => centsToDecimal(component.lineTotal))),
        MONEY_SCALE,
      ),
      firedAt: allFired && isReleased(line) ? (firedTimes.sort()[0] ?? line.sentAt) : null,
      readyAt:
        kitchenItems.length > 0 && allFired && readyTimes.length === kitchenItems.length
          ? readyTimes.sort().at(-1)!
          : null,
      lineId: line.id,
      ...(nutrition.has(line.id) ? { nutrition: nutrition.get(line.id)! } : {}),
      workingOrderId: line.workingOrderId,
      lineNo: line.lineNo,
      courseId: line.courseId,
      name: staffPresentationName({ name: line.name, variantName: line.variantName }),
      quantity: thousandthsToDecimal(line.quantity),
      ...(line.cancelledQuantity > 0
        ? { cancelledQuantity: thousandthsToDecimal(line.cancelledQuantity) }
        : {}),
      unitPrecision: line.unitPrecision,
      servedQuantity: thousandthsToDecimal(line.servedQuantity),
      servedAt: line.servedAt,
      released:
        line.quantity > line.cancelledQuantity && isReleased(line) && !heldExtras.has(line.id),
      kitchen:
        line.ticketState === null
          ? null
          : {
              state: line.ticketState,
              firedAt: line.ticketFiredAt,
              awayAt: line.awayAt,
              stationId: line.stationId!,
              movable: stillMovable(
                { state: line.ticketState, awayAt: line.awayAt, madeHere: line.ticketMadeHere! },
                line,
              ),
            },
      note: line.note,
      extras: extras.get(line.id) ?? [],
    };
    (group?.rows ?? ungrouped).push(row);
  }
  const minutes =
    party.state === "open" ? await VENUE_SERVICE.readReleaseReminderMinutes(tx) : null;
  return {
    revision: party.revision,
    hasGroups: nextDisplayNumber > 1,
    nextDisplayNumber,
    retainedCourses: [...retainedCourses.values()].sort(
      (a, b) => a.displayOrder - b.displayOrder || a.id.localeCompare(b.id),
    ),
    reminder: releaseReminder(
      shown.filter((group) => group.rows.length > 0),
      dishes,
      minutes,
    ),
    groups: shown,
    ungrouped,
  };
}

/**
 * Print a HOLD ticket for each of these held groups, where the venue prints held work in advance:
 * its held kitchen items, bill by bill in the order the bills were opened, as a fire prints them.
 * A group records when its ticket was queued for a printer, or nothing when no active printer took
 * one, so it then fires with an ordinary ticket.
 */
export async function printHoldTickets(
  tx: Transaction,
  cfg: TillConfig,
  groupIds: readonly string[],
): Promise<void> {
  if (groupIds.length === 0 || !(await VENUE_SERVICE.readPrintHeldWork(tx))) return;
  for (const groupId of groupIds) {
    const items = await tx
      .select({
        workingOrderId: ticketItems.workingOrderId,
        workingOrderLineId: ticketItems.workingOrderLineId,
        stationId: ticketItems.stationId,
        quantity: ticketItems.quantity,
      })
      .from(ticketItems)
      .innerJoin(workingOrderLines, eq(workingOrderLines.id, ticketItems.workingOrderLineId))
      .innerJoin(workingOrders, eq(workingOrders.id, ticketItems.workingOrderId))
      .where(and(eq(workingOrderLines.groupId, groupId), isNull(ticketItems.firedAt)))
      .orderBy(asc(workingOrders.orderNumber), asc(workingOrderLines.lineNo));
    const byBill = new Map<string, FiredItem[]>();
    for (const { workingOrderId, ...item } of items) {
      byBill.set(workingOrderId, [...(byBill.get(workingOrderId) ?? []), item]);
    }
    let printed = false;
    for (const [orderId, bill] of byBill) {
      if (await enqueueKitchenTickets(tx, cfg, orderId, bill, { mark: "HOLD" })) printed = true;
    }
    if (printed) {
      await tx
        .update(orderGroups)
        .set({ holdPrintedAt: nowIso() })
        .where(eq(orderGroups.id, groupId));
    }
  }
}

/** Permanent paper numbers of held groups whose HOLD ticket was queued. */
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

/** Changed held work on a queued HOLD ticket, identified by its permanent group number. */
export interface HeldChange {
  workingOrderId: string;
  workingOrderLineId: string;
  stationId: string;
  quantity: number;
  group: number;
  numberPartyLabel?: string;
}

/** Record and print a HOLD correction for each change, bill by bill. */
export async function correctHoldTickets(
  tx: Transaction,
  cfg: TillConfig,
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
      bill.map(({ workingOrderLineId, stationId, quantity, group, numberPartyLabel }) => ({
        workingOrderLineId,
        stationId,
        quantity,
        wasStarted: false,
        group,
        ...(numberPartyLabel === undefined ? {} : { numberPartyLabel }),
      })),
      correction,
    );
  }
}

/** All held kitchen records of each named dish and its split-off extras. */
async function heldItemsOf(
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

/** `+N` on the HOLD ticket of the group these dish lines just joined, where one was queued. */
export async function correctJoin(
  tx: Transaction,
  cfg: TillConfig,
  groupId: string,
  lineIds: readonly string[],
): Promise<void> {
  const group = (await printedHeldGroups(tx, [groupId])).get(groupId);
  if (group === undefined) return;
  const joined = await tx
    .select({
      workingOrderId: ticketItems.workingOrderId,
      workingOrderLineId: ticketItems.workingOrderLineId,
      stationId: ticketItems.stationId,
      quantity: firedQuantity,
    })
    .from(ticketItems)
    .innerJoin(workingOrderLines, eq(workingOrderLines.id, ticketItems.workingOrderLineId))
    .where(onDishesOrTheirExtras(tx, lineIds))
    .orderBy(asc(workingOrderLines.lineNo));
  await correctHoldTickets(
    tx,
    cfg,
    joined.map((item) => ({ ...item, group })),
    { kind: "HOLD CHANGED", direction: "added" },
  );
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

/** The group is the party's first held one with active sent dishes. */
async function requireWaitingGroup(tx: Transaction, partyId: string, groupId: string) {
  await requireHeldGroup(tx, partyId, groupId);
  const waiting = (await readGroups(tx, partyId)).find(
    (group) => group.state === "held" && group.lineIds.length > 0,
  );
  if (waiting?.id !== groupId) throw new AppError("group.not_waiting", { groupId });
}

async function requireHeldGroup(tx: Transaction, partyId: string, groupId: string): Promise<void> {
  if ((await requireGroup(tx, partyId, groupId)) !== "held") {
    throw new AppError("group.not_held", { groupId });
  }
}

/** The state of a group of this party that is not removed, else `group.not_found`. */
export async function requireGroup(
  tx: Transaction,
  partyId: string,
  groupId: string,
): Promise<"held" | "fired"> {
  const [group] = await tx
    .select({ state: orderGroups.state })
    .from(orderGroups)
    .where(and(eq(orderGroups.id, groupId), eq(orderGroups.partyId, partyId)));
  if (group === undefined || group.state === "removed") {
    throw new AppError("group.not_found", { groupId });
  }
  return group.state;
}

async function lastPosition(tx: Transaction, partyId: string): Promise<number> {
  const [{ last }] = await tx
    .select({ last: sql<number>`cast(coalesce(max(${orderGroups.position}), 0) as int)` })
    .from(orderGroups)
    .where(eq(orderGroups.partyId, partyId));
  return last;
}

async function nextGroupNumber(tx: Transaction, partyId: string): Promise<number> {
  const groups = await tx
    .select({
      id: orderGroups.id,
      displayNumber: orderGroups.displayNumber,
      numberPartyId: orderGroups.numberPartyId,
    })
    .from(orderGroups)
    .where(or(eq(orderGroups.partyId, partyId), eq(orderGroups.numberPartyId, partyId)));
  let last = 0;
  for (const group of groups) last = Math.max(last, groupNumberIdentity(group).displayNumber);
  return last + 1;
}

export async function readGroupNumberLabels(
  tx: Transaction,
  partyIds: readonly string[],
): Promise<Map<string, string>> {
  const labels = new Map<string, string>();
  if (partyIds.length === 0) return labels;
  const groups = await tx
    .select({
      id: orderGroups.id,
      partyId: orderGroups.partyId,
      displayNumber: orderGroups.displayNumber,
      numberPartyId: orderGroups.numberPartyId,
    })
    .from(orderGroups)
    .where(
      and(inArray(orderGroups.partyId, [...new Set(partyIds)]), ne(orderGroups.state, "removed")),
    );
  const counts = new Map<string, number>();
  for (const group of groups) {
    const key = `${group.partyId}:${group.displayNumber}`;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const duplicates = groups.filter((g) => counts.get(`${g.partyId}:${g.displayNumber}`)! > 1);
  if (duplicates.length === 0) return labels;
  const origins = await tx
    .select({ id: parties.id, state: parties.state, tableNames: parties.tableNames })
    .from(parties)
    .where(inArray(parties.id, [...new Set(duplicates.map((g) => g.numberPartyId!))]));
  const current = await readPartyTables(
    tx,
    origins.filter((p) => p.state === "open").map((p) => p.id),
  );
  const names = new Map(
    origins.map((p) => [
      p.id,
      partyTablesName(p.state === "open" ? (current.get(p.id) ?? []) : (p.tableNames ?? [])),
    ]),
  );
  for (const group of duplicates) labels.set(group.id, names.get(group.numberPartyId!)!);
  return labels;
}

function groupNumberIdentity(group: { displayNumber: number; numberPartyId: string | null }): {
  displayNumber: number;
  numberPartyId: string;
} {
  if (
    !Number.isSafeInteger(group.displayNumber) ||
    group.displayNumber < 1 ||
    group.numberPartyId === null
  ) {
    throw new AppError("management.request_invalid", { field: "groupId" });
  }
  return { displayNumber: group.displayNumber, numberPartyId: group.numberPartyId };
}

async function currentRevision(tx: Transaction, partyId: string): Promise<number> {
  const [party] = await tx
    .select({ revision: parties.revision })
    .from(parties)
    .where(eq(parties.id, partyId));
  if (party === undefined) throw new AppError("party.not_open", { partyId });
  return party.revision;
}

export async function recordGroupEvent(
  tx: Transaction,
  values: typeof orderGroupEvents.$inferInsert,
  attendance?: { recorder: AttendanceRecorder; at: string },
): Promise<void> {
  const [event] = await tx
    .insert(orderGroupEvents)
    .values(values)
    .returning({ id: orderGroupEvents.id });
  if (attendance === undefined || !values.actorId) return;
  const orders = await tx
    .selectDistinct({ locationId: workingOrders.locationId })
    .from(workingOrders)
    .where(eq(workingOrders.partyId, values.partyId));
  if (orders.length !== 1) return;
  await attendance.recorder(tx, {
    source: "draft",
    key: `group:${event!.id}`,
    personId: values.actorId,
    locationId: orders[0]!.locationId,
    kind: "order",
    at: attendance.at,
    offsetMinutes: 0,
    outcome: "qualified",
  });
}

/**
 * A bill that has just arrived in the party gets groups for its dishes that have none, so the pass
 * can mark them and the waiter can release what is unsent: its released dishes ({@link isReleased})
 * go in one new fired group, and the rest in one new held group per course, because firing a course
 * releases whole every held group holding one of its dishes on that bill. A dish with no course
 * goes in the held group of the earliest active course among the waiting dishes; with none
 * active, the earliest course's, and in a held group of its own when no waiting dish has a course.
 * The groups follow the party's last one in firing order: fired, then held by course. An extras
 * line takes its dish's group. The fired group takes its earliest-fired dish's firing — its kitchen
 * item's, else its sent time — and, as its firer, the person or kitchen display `firers` says fired
 * that dish's group in the party it left (by line id), else the operator. The caller has moved the party's revision on.
 */
export async function groupArrivingDishes(
  tx: Transaction,
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
      ticketMadeHere: ticketItems.madeHere,
    })
    .from(workingOrderLines)
    .leftJoin(ticketItems, eq(ticketItems.workingOrderLineId, workingOrderLines.id))
    .leftJoin(kitchenCourses, eq(kitchenCourses.id, workingOrderLines.courseId))
    .where(
      and(
        eq(workingOrderLines.workingOrderId, billId),
        isNull(workingOrderLines.parentLineId),
        isNull(workingOrderLines.groupId),
        notExists(
          tx
            .select({ id: orderDraftRecalledLines.id })
            .from(orderDraftRecalledLines)
            .where(eq(orderDraftRecalledLines.sourceLineId, workingOrderLines.id)),
        ),
      ),
    )
    .orderBy(
      sql`${kitchenCourses.displayOrder} asc nulls first`,
      asc(kitchenCourses.name),
      asc(workingOrderLines.lineNo),
    );
  const released: typeof dishes = [];
  const heldByCourse = new Map<string | null, typeof dishes>();
  for (const line of dishes) {
    if (isReleased({ ...line, groupState: null })) released.push(line);
    else {
      const course = heldByCourse.get(line.courseId);
      if (course === undefined) heldByCourse.set(line.courseId, [line]);
      else course.push(line);
    }
  }
  const loose = heldByCourse.get(null);
  const courses = [...heldByCourse.values()].filter((lines) => lines[0]!.courseId !== null);
  const earliest = courses.find((lines) => lines[0]!.courseActive === true) ?? courses[0];
  if (loose !== undefined && earliest !== undefined) {
    earliest.push(...loose);
    heldByCourse.delete(null);
  }
  const fired = await groupArrived(
    tx,
    partyId,
    billId,
    released,
    "fire",
    operatorId,
    firers,
    attendance,
  );
  const held: string[] = [];
  for (const lines of heldByCourse.values()) {
    held.push(
      (await groupArrived(tx, partyId, billId, lines, "hold", operatorId, firers, attendance))!,
    );
  }
  return { fired, held };
}

async function groupArrived(
  tx: Transaction,
  partyId: string,
  billId: string,
  lines: readonly { id: string; ticketFiredAt: string | null; sentAt: string | null }[],
  release: GroupRelease,
  operatorId: string,
  firers: ReadonlyMap<string, Firer>,
  attendance?: { recorder: AttendanceRecorder; at: string },
): Promise<string | null> {
  if (lines.length === 0) return null;
  let fired: { at: string; by: Firer } | undefined;
  if (release === "fire") {
    // A released dish ({@link isReleased}) has a fired kitchen item or, lacking one, a sent time.
    const at = (line: (typeof lines)[number]) => (line.ticketFiredAt ?? line.sentAt)!;
    const first = lines.reduce((earliest, line) => (at(line) < at(earliest) ? line : earliest));
    fired = { at: at(first), by: firers.get(first.id) ?? { personId: operatorId } };
  }
  const groupId = await startGroup(tx, partyId, release, operatorId, fired);
  const ids = lines.map((line) => line.id);
  await tx
    .update(workingOrderLines)
    .set({ groupId })
    .where(or(inArray(workingOrderLines.id, ids), inArray(workingOrderLines.parentLineId, ids)));
  await recordGroupEvent(
    tx,
    {
      partyId,
      groupId,
      kind: "lines_moved",
      actorId: operatorId,
      detail: { workingOrderId: billId, arrived: true },
    },
    attendance,
  );
  return groupId;
}
