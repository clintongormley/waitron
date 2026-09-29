import { and, asc, eq, inArray, isNotNull, isNull, ne, notExists, or, sql } from "drizzle-orm";
import type { SQL } from "drizzle-orm";
import { staffPresentationName } from "@waitron/catalogue";
import {
  nowIso,
  orderGroupEvents,
  orderGroups,
  ticketItems,
  parties,
  workingOrderLines,
  workingOrders,
} from "@waitron/db";
import type { Transaction } from "@waitron/db";
import { persons } from "@waitron/identity";
import { AppError, stringToThousandths, thousandthsToDecimal } from "@waitron/shared";
import { enqueueHoldCorrections, enqueueKitchenTickets } from "./kitchen-print.js";
import type { FiredItem, HoldCorrection, TicketState } from "./kitchen-print.js";
import { VENUE_SERVICE } from "./modules.js";
import { trimQuantityForDisplay } from "./receipt-lines.js";
import type { TillConfig } from "./till-config.js";
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
  fireOrderLines,
  insertTabRound,
  isReleased,
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
  expectedPartyRevision: number;
  groups: { lines: GroupLine[]; release: GroupRelease }[];
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
  /** The group's dish lines, whichever of the party's bills they sit on. */
  lineIds: string[];
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
 * the operator. A group never matches another by course; only `joinGroupId` adds to an existing
 * one. A new held group prints its HOLD ticket where the venue prints held work in advance
 * ({@link printHoldTickets}); lines joining a group whose HOLD ticket was queued print `+N` for it.
 */
export async function submitGroups(
  tx: Transaction,
  cfg: TillConfig,
  partyId: string,
  input: SubmitGroupsInput,
): Promise<SubmittedGroups> {
  const { submissionId, expectedPartyRevision, operatorId, ...body } = input;
  return runServiceCommand(
    tx,
    { kind: "visit", partyId },
    submissionId,
    "group.submit",
    { partyId, operatorId, ...body },
    async () => {
      await checkAndBumpParty(tx, partyId, expectedPartyRevision, "open");
      return placeGroups(tx, cfg, partyId, { ...input, revisionMoved: true });
    },
  );
}

export type PlaceGroupsInput = Pick<
  SubmitGroupsInput,
  "groups" | "joinGroupId" | "operatorId" | "billId"
> & {
  /** The command has already moved the party's revision on, so making a main bill does not. */
  revisionMoved?: boolean;
};

/**
 * {@link submitGroups} without its replay record or party revision check, for a command that makes
 * both itself.
 */
export async function placeGroups(
  tx: Transaction,
  cfg: TillConfig,
  partyId: string,
  input: PlaceGroupsInput,
): Promise<SubmittedGroups> {
  const { operatorId } = input;
  if (input.groups.length === 0) {
    throw new AppError("management.request_invalid", { field: "groups" });
  }
  if (input.joinGroupId !== undefined) {
    if (input.groups.length !== 1 || input.groups[0]!.release !== "hold") {
      throw new AppError("management.request_invalid", { field: "joinGroupId" });
    }
    await requireHeldGroup(tx, partyId, input.joinGroupId);
  }
  const lines = input.groups.flatMap((group) =>
    group.lines.map((line) => ({
      ...line,
      hold: group.release === "hold",
      release: group.release === "fire",
    })),
  );
  // A first group with no lines prices nothing, as the bill is checked before the empty basket.
  const tabId = await resolveOrderBill(tx, cfg, partyId, input);
  const round = await priceTabRound(
    tx,
    cfg,
    tabId,
    input.groups[0]!.lines.length === 0 ? [] : lines,
    "checked",
  );
  if (input.groups.some((group) => group.lines.length === 0)) {
    throw new AppError("sale.empty_basket", {});
  }
  const groupIds: string[] = [];
  if (input.joinGroupId !== undefined) groupIds.push(input.joinGroupId);
  else {
    for (const group of input.groups) {
      groupIds.push(await startGroup(tx, partyId, group.release, operatorId));
    }
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
    if (input.joinGroupId !== undefined) {
      await correctJoin(
        tx,
        cfg,
        groupId,
        inserted.filter((row) => row.parentLineId == null).map((row) => row.id!),
      );
    } else if (!fire) {
      await printHoldTickets(tx, cfg, [groupId]);
    }
    await bumpRevision(tx, [tabId]);
    await recordGroupEvent(tx, {
      partyId,
      groupId,
      kind: input.joinGroupId === undefined ? "submitted" : "joined",
      actorId: operatorId,
      detail: { workingOrderId: tabId, release: group.release },
    });
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
  cfg: TillConfig,
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
  cfg: TillConfig,
  partyId: string,
  groupId: string,
  args: PartyCommandArgs,
): Promise<{ revision: number }> {
  return runServiceCommand(
    tx,
    { kind: "visit", partyId },
    args.submissionId,
    "group.fire",
    { partyId, groupId, operatorId: args.operatorId },
    async () => {
      const revision = await checkAndBumpParty(tx, partyId, args.expectedPartyRevision, "open");
      await requireHeldGroup(tx, partyId, groupId);
      await releaseGroup(tx, cfg, partyId, groupId, args.operatorId, {});
      return { revision };
    },
  );
}

/**
 * The pass's Ready for a group: every fired kitchen item of its dishes, on every bill of the party,
 * goes straight to `ready`. A held group's items are unfired, so it changes none, yet the command is
 * recorded and the party's revision moves on.
 */
export async function bumpGroupReady(
  tx: Transaction,
  cfg: TillConfig,
  partyId: string,
  groupId: string,
  args: PartyCommandArgs,
): Promise<{ revision: number }> {
  void cfg;
  return passStep(tx, partyId, groupId, args, "group.ready", async () => {
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
  partyId: string,
  groupId: string,
  args: PartyCommandArgs,
): Promise<{ revision: number }> {
  void cfg;
  return passStep(tx, partyId, groupId, args, "group.away", async () => {
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
  partyId: string,
  groupId: string,
  args: PartyCommandArgs,
  kind: "group.ready" | "group.away",
  apply: () => Promise<void>,
): Promise<{ revision: number }> {
  return runServiceCommand(
    tx,
    { kind: "visit", partyId },
    args.submissionId,
    kind,
    { partyId, groupId, operatorId: args.operatorId },
    async () => {
      const revision = await checkAndBumpParty(tx, partyId, args.expectedPartyRevision, "open");
      await requireGroup(tx, partyId, groupId);
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
 * The course Fire: on an order of a party, release every held group of the party that holds a dish
 * of this course on this order, whole and in position order, as {@link fireGroup} does. It touches
 * nothing when the order is on no party or no held group qualifies. It carries no submission id, so
 * it records no replay: each group's `fired` event names the course and the order.
 */
export async function fireHeldGroupsOfCourse(
  tx: Transaction,
  cfg: TillConfig,
  orderId: string,
  courseId: string,
  operatorId: string,
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
  for (const group of groups) {
    await releaseGroup(tx, cfg, partyId, group.id, operatorId, {
      courseId,
      workingOrderId: orderId,
    });
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
  cfg: TillConfig,
  partyId: string,
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
  const [group] = await tx
    .select({ holdPrintedAt: orderGroups.holdPrintedAt })
    .from(orderGroups)
    .where(eq(orderGroups.id, groupId));
  // The marker, not the setting: a group whose HOLD ticket was queued is fired by a FIRE slip.
  const mark = group!.holdPrintedAt === null ? undefined : "FIRE";
  for (const [orderId, lineIds] of byOrder) {
    await fireOrderLines(tx, cfg, orderId, lineIds, mark);
  }
  await tx
    .update(orderGroups)
    .set({ state: "fired", firedAt: nowIso(), firedBy: operatorId, remindAt: null })
    .where(eq(orderGroups.id, groupId));
  await recordGroupEvent(tx, { partyId, groupId, kind: "fired", actorId: operatorId, detail });
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
): Promise<{ revision: number }> {
  return runServiceCommand(
    tx,
    { kind: "visit", partyId },
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
      await recordGroupEvent(tx, {
        partyId,
        groupId: null,
        kind: "reordered",
        actorId: args.operatorId,
        detail: { heldGroupIds },
      });
      return { revision };
    },
  );
}

/** The longest snooze, in whole minutes. */
export const MAX_SNOOZE_MINUTES = 120;

/**
 * Snooze the release reminder of the group waiting, the party's first held group: its `remind_at`
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
  void cfg;
  return runServiceCommand(
    tx,
    { kind: "visit", partyId },
    args.submissionId,
    "group.snooze",
    { partyId, groupId, minutes, operatorId: args.operatorId },
    async () => {
      const revision = await checkAndBumpParty(tx, partyId, args.expectedPartyRevision, "open");
      if (!Number.isInteger(minutes) || minutes < 1 || minutes > MAX_SNOOZE_MINUTES) {
        throw new AppError("management.request_invalid", { field: "minutes" });
      }
      await requireHeldGroup(tx, partyId, groupId);
      const [waiting] = await tx
        .select({ id: orderGroups.id })
        .from(orderGroups)
        .where(and(eq(orderGroups.partyId, partyId), eq(orderGroups.state, "held")))
        .orderBy(asc(orderGroups.position), asc(orderGroups.createdAt), asc(orderGroups.id))
        .limit(1);
      if (waiting!.id !== groupId) throw new AppError("group.not_waiting", { groupId });
      await tx
        .update(orderGroups)
        .set({ remindAt: new Date(Date.now() + minutes * 60_000).toISOString() })
        .where(eq(orderGroups.id, groupId));
      return { revision };
    },
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
): Promise<{ revision: number }> {
  return runServiceCommand(
    tx,
    { kind: "visit", partyId },
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
      const printed = await printedHeldGroups(tx, [
        ...lines.map((line) => line.groupId!),
        ...(target === "new" ? [] : [target.groupId]),
      ]);
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
          .where(inArray(workingOrderLines.id, [...split.values()]));
        for (const [from, to] of split) splitIds.set(from, to);
      }
      const taken: HeldChange[] = [];
      const given: HeldChange[] = [];
      for (const { lineId, quantity } of moves) {
        const line = lineById.get(lineId)!;
        const stationId = heldItems.get(lineId);
        if (stationId === undefined || line.groupId === targetId) continue;
        const split = splitIds.get(lineId);
        // Read after the split, which refused a malformed part.
        const moved = split === undefined ? line.quantity : stringToThousandths(quantity);
        const change = { workingOrderId: line.workingOrderId, stationId, quantity: moved };
        const from = printed.get(line.groupId!);
        if (from !== undefined) taken.push({ ...change, workingOrderLineId: lineId, group: from });
        const to = printed.get(targetId);
        if (to !== undefined) {
          given.push({ ...change, workingOrderLineId: split ?? lineId, group: to });
        }
      }
      await correctHoldTickets(tx, cfg, taken, { kind: "HOLD CHANGED", direction: "removed" });
      await correctHoldTickets(tx, cfg, given, { kind: "HOLD CHANGED", direction: "added" });
      if (target === "new") await printHoldTickets(tx, cfg, [targetId]);
      await bumpRevision(tx, [...splitsByBill.keys()]);
      await recordGroupEvent(tx, {
        partyId,
        groupId: targetId,
        kind: "lines_moved",
        actorId: args.operatorId,
        detail: { moves, from: [...sources] },
      });
      await removeEmptiedHeldGroups(tx, partyId, [...sources], args.operatorId);
      return { revision };
    },
  );
}

/**
 * A new group at the end of the party's sequence, fired now or held, submitted by the operator. The
 * caller puts its lines in it and records its event.
 */
export async function startGroup(
  tx: Transaction,
  partyId: string,
  release: GroupRelease,
  operatorId: string,
): Promise<string> {
  const fire = release === "fire";
  const [group] = await tx
    .insert(orderGroups)
    .values({
      partyId,
      position: (await lastPosition(tx, partyId)) + 1,
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
  partyId: string,
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
    .set({ state: "removed", remindAt: null })
    .where(inArray(orderGroups.id, [...emptied]));
  for (const groupId of new Set(groupIds)) {
    if (!emptied.has(groupId)) continue;
    await recordGroupEvent(tx, { partyId, groupId, kind: "removed", actorId, detail: {} });
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
    .where(and(eq(orderGroups.partyId, partyId), ne(orderGroups.state, "removed"), ...scope))
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

/** The group waiting to be released, and when staff are reminded to release it (D11). */
export interface ReleaseReminder {
  groupId: string;
  /** Null while a fired group before it has a dish line not fully served, or nothing dates it. */
  dueAt: string | null;
}

/**
 * The party's release reminder (D11). `groups` are the party's groups in sequence, removed ones left
 * out; `lines` are dish lines, each fully served when its `servedAt` is set. The group waiting is the
 * first held one. While a fired group before it has a dish line unserved there is no time, a snooze
 * included; otherwise it is due at its snooze (`remindAt`), else `minutes` after the latest served
 * time of those fired groups. A fired group with no dish line neither holds it up nor dates it. With
 * `minutes` null the venue has reminders off, and there is none.
 */
export function releaseReminder(
  groups: readonly Pick<OrderGroup, "id" | "state" | "remindAt">[],
  lines: readonly { groupId: string | null; servedAt: string | null }[],
  minutes: number | null,
): ReleaseReminder | null {
  if (minutes === null) return null;
  const waiting = groups.findIndex((group) => group.state === "held");
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
    .select({ groupId: workingOrderLines.groupId, servedAt: workingOrderLines.servedAt })
    .from(workingOrderLines)
    .innerJoin(workingOrders, eq(workingOrders.id, workingOrderLines.workingOrderId))
    .where(
      and(
        inArray(
          workingOrderLines.groupId,
          groups.map((group) => group.id),
        ),
        isNull(workingOrderLines.parentLineId),
        onShownBill(),
      ),
    );
  for (const partyId of new Set(groups.map((group) => group.partyId))) {
    const own = groups.filter((group) => group.partyId === partyId);
    const ids = new Set(own.map((group) => group.id));
    reminders.set(
      partyId,
      releaseReminder(
        own.map((group) => ({ ...group, state: group.state as "held" | "fired" })),
        lines.filter((line) => ids.has(line.groupId!)),
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
}

/** A dish line of the party, on whichever of its bills, a paid one included. */
export interface CurrentOrderRow {
  lineId: string;
  workingOrderId: string;
  lineNo: number;
  /** The staff name, the variant's on a variant line. */
  name: string;
  quantity: string;
  /** Decimal places the line's unit takes, so a part can be served (0 = sold by the unit). */
  unitPrecision: number | null;
  servedQuantity: string;
  /** Set once the whole quantity is served. */
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
  state: "held" | "fired";
  firedAt: string | null;
  /** A snooze's time, until the group fires, empties or moves in a reorder. */
  remindAt: string | null;
  /** A fired group's firing; a held group's holding. */
  sentAt: string;
  /** The display name of whoever fired or held it; null when no person record matches. */
  sentBy: string | null;
  rows: CurrentOrderRow[];
}

/** What the party has ordered and what is known of it (spec §4 Current orders). */
export interface CurrentOrders {
  /** The party's revision, which the served and snooze commands send back. */
  revision: number;
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
  const groups = await tx
    .select({
      id: orderGroups.id,
      position: orderGroups.position,
      state: orderGroups.state,
      firedAt: orderGroups.firedAt,
      remindAt: orderGroups.remindAt,
      createdAt: orderGroups.createdAt,
      sentBy: persons.displayName,
    })
    .from(orderGroups)
    .leftJoin(
      persons,
      eq(
        persons.id,
        sql`case when ${orderGroups.state} = 'fired' then ${orderGroups.firedBy} else ${orderGroups.submittedBy} end`,
      ),
    )
    .where(and(eq(orderGroups.partyId, partyId), ne(orderGroups.state, "removed")))
    .orderBy(asc(orderGroups.position), asc(orderGroups.createdAt), asc(orderGroups.id));
  const lines = await tx
    .select({
      id: workingOrderLines.id,
      workingOrderId: workingOrderLines.workingOrderId,
      lineNo: workingOrderLines.lineNo,
      parentLineId: workingOrderLines.parentLineId,
      name: workingOrderLines.name,
      variantName: workingOrderLines.variantName,
      quantity: workingOrderLines.quantity,
      unitPrecision: workingOrderLines.unitPrecision,
      servedQuantity: workingOrderLines.servedQuantity,
      servedAt: workingOrderLines.servedAt,
      sentAt: workingOrderLines.sentAt,
      note: workingOrderLines.note,
      groupId: workingOrderLines.groupId,
      groupState: orderGroups.state,
      ticketItemId: ticketItems.id,
      ticketState: ticketItems.state,
      ticketFiredAt: ticketItems.firedAt,
      awayAt: ticketItems.awayAt,
    })
    .from(workingOrderLines)
    .innerJoin(workingOrders, eq(workingOrders.id, workingOrderLines.workingOrderId))
    .leftJoin(orderGroups, eq(orderGroups.id, workingOrderLines.groupId))
    .leftJoin(ticketItems, eq(ticketItems.workingOrderLineId, workingOrderLines.id))
    .where(and(inArray(workingOrders.partyId, family), onShownBill()))
    .orderBy(
      asc(workingOrders.openedAt),
      asc(workingOrders.orderNumber),
      asc(workingOrders.id),
      asc(workingOrderLines.lineNo),
    );
  const extras = new Map<string, CurrentOrderExtra[]>();
  for (const line of lines) {
    if (line.parentLineId === null) continue;
    extras.set(line.parentLineId, [
      ...(extras.get(line.parentLineId) ?? []),
      {
        lineId: line.id,
        name: staffPresentationName({ name: line.name, variantName: line.variantName }),
        quantity: thousandthsToDecimal(line.quantity),
      },
    ]);
  }
  const shown: CurrentOrderGroup[] = groups.map(({ createdAt, ...group }) => ({
    ...group,
    state: group.state as "held" | "fired",
    // `order_groups_fired_at_ck` sets `fired_at` exactly when the group is fired.
    sentAt: group.state === "fired" ? group.firedAt! : createdAt,
    rows: [],
  }));
  const byId = new Map(shown.map((group) => [group.id, group]));
  const ungrouped: CurrentOrderRow[] = [];
  const dishes: { groupId: string | null; servedAt: string | null }[] = [];
  for (const line of lines) {
    if (line.parentLineId !== null) continue;
    const group = line.groupId === null ? undefined : byId.get(line.groupId);
    if (line.groupId !== null && group === undefined) continue;
    dishes.push(line);
    const row: CurrentOrderRow = {
      lineId: line.id,
      workingOrderId: line.workingOrderId,
      lineNo: line.lineNo,
      name: staffPresentationName({ name: line.name, variantName: line.variantName }),
      quantity: thousandthsToDecimal(line.quantity),
      unitPrecision: line.unitPrecision,
      servedQuantity: thousandthsToDecimal(line.servedQuantity),
      servedAt: line.servedAt,
      released: isReleased(line),
      kitchen:
        line.ticketState === null
          ? null
          : { state: line.ticketState, firedAt: line.ticketFiredAt, awayAt: line.awayAt },
      note: line.note,
      extras: extras.get(line.id) ?? [],
    };
    (group?.rows ?? ungrouped).push(row);
  }
  const minutes =
    party.state === "open" ? await VENUE_SERVICE.readReleaseReminderMinutes(tx) : null;
  return {
    revision: party.revision,
    reminder: releaseReminder(shown, dishes, minutes),
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

/** Of these groups, the positions of those still held whose HOLD ticket was queued. */
export async function printedHeldGroups(
  tx: Transaction,
  groupIds: readonly string[],
): Promise<Map<string, number>> {
  if (groupIds.length === 0) return new Map();
  const rows = await tx
    .select({ id: orderGroups.id, position: orderGroups.position })
    .from(orderGroups)
    .where(
      and(
        inArray(orderGroups.id, [...new Set(groupIds)]),
        eq(orderGroups.state, "held"),
        isNotNull(orderGroups.holdPrintedAt),
      ),
    );
  return new Map(rows.map((row) => [row.id, row.position]));
}

/** Changed held work on a queued HOLD ticket: the thousandths changed, and the group's position. */
export interface HeldChange {
  workingOrderId: string;
  workingOrderLineId: string;
  stationId: string;
  quantity: number;
  group: number;
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
      bill.map(({ workingOrderLineId, stationId, quantity, group }) => ({
        workingOrderLineId,
        stationId,
        quantity,
        wasStarted: false,
        group,
      })),
      correction,
    );
  }
}

/** The station of each of these dish lines that has a held kitchen item. */
async function heldItemsOf(
  tx: Transaction,
  lineIds: readonly string[],
): Promise<Map<string, string>> {
  const rows = await tx
    .select({
      workingOrderLineId: ticketItems.workingOrderLineId,
      stationId: ticketItems.stationId,
    })
    .from(ticketItems)
    .where(and(inArray(ticketItems.workingOrderLineId, [...lineIds]), isNull(ticketItems.firedAt)));
  return new Map(rows.map((row) => [row.workingOrderLineId, row.stationId]));
}

/** `+N` on the HOLD ticket of the group these dish lines just joined, where one was queued. */
async function correctJoin(
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
      quantity: workingOrderLines.quantity,
    })
    .from(ticketItems)
    .innerJoin(workingOrderLines, eq(workingOrderLines.id, ticketItems.workingOrderLineId))
    .where(inArray(ticketItems.workingOrderLineId, [...lineIds]))
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
): Promise<void> {
  await tx.insert(orderGroupEvents).values(values);
}
