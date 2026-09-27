import { and, asc, eq, inArray, isNull, ne, or } from "drizzle-orm";
import {
  diningTables,
  nowIso,
  orderGroupEvents,
  orderGroups,
  visitTables,
  visits,
  workingOrderLines,
  workingOrders,
} from "@waitron/db";
import type { Transaction } from "@waitron/db";
import { AppError, stringToThousandths, thousandthsToDecimal } from "@waitron/shared";
import type { TillConfig } from "./till-config.js";
import { checkAndBumpVisit, runServiceCommand } from "./visits.js";
import {
  addTabRound,
  bumpRevision,
  fireOrderLines,
  splitLineWithinOrder,
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
      let tabId = await visitTab(tx, visitId);
      let position = await lastPosition(tx, visitId);
      const groupIds: string[] = [];
      for (const group of input.groups) {
        const fire = group.release === "fire";
        const groupId =
          input.joinGroupId ??
          (await insertGroup(tx, {
            visitId,
            position: ++position,
            state: fire ? "fired" : "held",
            firedAt: fire ? nowIso() : null,
            firedBy: fire ? operatorId : null,
            submittedBy: operatorId,
          }));
        ({ tabId } = await addTabRound(
          tx,
          cfg,
          tabId,
          group.lines.map((line) => ({ ...line, hold: !fire, release: fire })),
          { groupId, creditedTo: operatorId },
        ));
        await recordEvent(tx, {
          visitId,
          groupId,
          kind: input.joinGroupId === undefined ? "submitted" : "joined",
          actorId: operatorId,
          detail: { tabId, release: group.release },
        });
        groupIds.push(groupId);
      }
      const listed = new Map((await readGroups(tx, visitId)).map((group) => [group.id, group]));
      return {
        tabId,
        revision: await currentRevision(tx, visitId),
        groups: groupIds.map((id) => listed.get(id)!),
      };
    },
  );
}

/**
 * Release a held group: every line of it, on whichever of the visit's bills it sits, is fired and
 * stamped sent, and each touched bill's revision moves on. A sold-out line refuses the whole group
 * before anything is released.
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
      await checkAndBumpVisit(tx, visitId, args.expectedVisitRevision, "open");
      await requireHeldGroup(tx, visitId, groupId);
      const lines = await tx
        .select({ id: workingOrderLines.id, workingOrderId: workingOrderLines.workingOrderId })
        .from(workingOrderLines)
        .where(and(eq(workingOrderLines.groupId, groupId), isNull(workingOrderLines.parentLineId)))
        .orderBy(asc(workingOrderLines.workingOrderId), asc(workingOrderLines.lineNo));
      // A sold-out line on an open bill refuses inside `fireOrderLines`, and the refusal rolls
      // back whatever an earlier bill of the group had released.
      const byOrder = new Map<string, string[]>();
      for (const line of lines) {
        byOrder.set(line.workingOrderId, [...(byOrder.get(line.workingOrderId) ?? []), line.id]);
      }
      for (const [orderId, lineIds] of byOrder) {
        await fireOrderLines(tx, cfg, orderId, lineIds);
      }
      await tx
        .update(orderGroups)
        .set({ state: "fired", firedAt: nowIso(), firedBy: args.operatorId })
        .where(eq(orderGroups.id, groupId));
      await recordEvent(tx, {
        visitId,
        groupId,
        kind: "fired",
        actorId: args.operatorId,
        detail: {},
      });
      return { revision: await currentRevision(tx, visitId) };
    },
  );
}

/**
 * Put the visit's held groups in this order. `heldGroupIds` names every held group once; they take
 * the positions the held groups already hold, so a fired group never moves.
 */
export async function reorderHeldGroups(
  tx: Transaction,
  _cfg: TillConfig,
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
      const positions = held.map((group) => group.position).sort((a, b) => a - b);
      for (const [i, id] of heldGroupIds.entries()) {
        if (byId.get(id)!.position !== positions[i]) {
          await tx
            .update(orderGroups)
            .set({ position: positions[i]! })
            .where(eq(orderGroups.id, id));
        }
      }
      await recordEvent(tx, {
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
      await checkAndBumpVisit(tx, visitId, args.expectedVisitRevision, "open");
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
        })
        .from(workingOrderLines)
        .innerJoin(orderGroups, eq(orderGroups.id, workingOrderLines.groupId))
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
      }
      const targetId =
        target === "new"
          ? await insertGroup(tx, {
              visitId,
              position: (await lastPosition(tx, visitId)) + 1,
              state: "held",
              firedAt: null,
              firedBy: null,
              submittedBy: args.operatorId,
            })
          : target.groupId;
      const sources = new Set<string>();
      const bills = new Set<string>();
      for (const { lineId, quantity } of moves) {
        const line = lineById.get(lineId)!;
        sources.add(line.groupId!);
        bills.add(line.workingOrderId);
        if (isWholeLine(quantity, line.quantity)) {
          await tx
            .update(workingOrderLines)
            .set({ groupId: targetId })
            .where(
              or(eq(workingOrderLines.id, lineId), eq(workingOrderLines.parentLineId, lineId)),
            );
        } else {
          const splitId = await splitLineWithinOrder(
            tx,
            cfg,
            line.workingOrderId,
            line.lineNo,
            quantity,
          );
          await tx
            .update(workingOrderLines)
            .set({ groupId: targetId })
            .where(eq(workingOrderLines.id, splitId));
        }
      }
      await bumpRevision(tx, [...bills]);
      await recordEvent(tx, {
        visitId,
        groupId: targetId,
        kind: "lines_moved",
        actorId: args.operatorId,
        detail: { moves, from: [...sources] },
      });
      for (const source of sources) {
        const [left] = await tx
          .select({ id: workingOrderLines.id })
          .from(workingOrderLines)
          .where(eq(workingOrderLines.groupId, source))
          .limit(1);
        if (left === undefined) {
          await tx.update(orderGroups).set({ state: "removed" }).where(eq(orderGroups.id, source));
          await recordEvent(tx, {
            visitId,
            groupId: source,
            kind: "removed",
            actorId: args.operatorId,
            detail: {},
          });
        }
      }
      return { revision: await currentRevision(tx, visitId) };
    },
  );
}

/** The visit's groups in sequence, removed ones left out, with the visit's revision. */
export async function listOrderGroups(
  tx: Transaction,
  visitId: string,
): Promise<{ revision: number; groups: OrderGroup[] }> {
  const [visit] = await tx
    .select({ revision: visits.revision })
    .from(visits)
    .where(eq(visits.id, visitId));
  if (visit === undefined) throw new AppError("visit.not_open", { visitId });
  return { revision: visit.revision, groups: await readGroups(tx, visitId) };
}

async function readGroups(tx: Transaction, visitId: string): Promise<OrderGroup[]> {
  const groups = await tx
    .select({
      id: orderGroups.id,
      position: orderGroups.position,
      state: orderGroups.state,
      firedAt: orderGroups.firedAt,
      remindAt: orderGroups.remindAt,
    })
    .from(orderGroups)
    .where(and(eq(orderGroups.visitId, visitId), ne(orderGroups.state, "removed")))
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
    .where(and(eq(orderGroups.visitId, visitId), isNull(workingOrderLines.parentLineId)))
    .orderBy(asc(workingOrders.orderNumber), asc(workingOrderLines.lineNo));
  return groups.map((group) => {
    const own = lines.filter((line) => line.groupId === group.id);
    const counts = new Map<string, number>();
    for (const line of own) {
      const label = line.variantName === null ? line.name : `${line.name} ${line.variantName}`;
      counts.set(label, (counts.get(label) ?? 0) + line.quantity);
    }
    return {
      ...group,
      state: group.state as "held" | "fired",
      lineIds: own.map((line) => line.id),
      summary: [...counts]
        .map(([label, quantity]) => `${plainQuantity(quantity)} × ${label}`)
        .join(", "),
    };
  });
}

/** A stored quantity with no trailing zeros: 2000 is "2", 1500 is "1.5". */
function plainQuantity(thousandths: number): string {
  return thousandthsToDecimal(thousandths).replace(/0+$/, "").replace(/\.$/, "");
}

/** Whether `quantity` is exactly the line's stored quantity; a malformed one is not. */
function isWholeLine(quantity: string, stored: number): boolean {
  try {
    return stringToThousandths(quantity) === stored;
  } catch {
    return false;
  }
}

async function requireHeldGroup(tx: Transaction, visitId: string, groupId: string): Promise<void> {
  const [group] = await tx
    .select({ state: orderGroups.state })
    .from(orderGroups)
    .where(and(eq(orderGroups.id, groupId), eq(orderGroups.visitId, visitId)));
  if (group === undefined || group.state === "removed") {
    throw new AppError("group.not_found", { groupId });
  }
  if (group.state !== "held") throw new AppError("group.not_held", { groupId });
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
  const rows = await tx
    .select({ position: orderGroups.position })
    .from(orderGroups)
    .where(eq(orderGroups.visitId, visitId));
  return Math.max(0, ...rows.map((row) => row.position));
}

async function currentRevision(tx: Transaction, visitId: string): Promise<number> {
  const [visit] = await tx
    .select({ revision: visits.revision })
    .from(visits)
    .where(eq(visits.id, visitId));
  return visit!.revision;
}

async function insertGroup(
  tx: Transaction,
  values: typeof orderGroups.$inferInsert,
): Promise<string> {
  const [group] = await tx.insert(orderGroups).values(values).returning({ id: orderGroups.id });
  return group!.id;
}

async function recordEvent(
  tx: Transaction,
  values: typeof orderGroupEvents.$inferInsert,
): Promise<void> {
  await tx.insert(orderGroupEvents).values(values);
}
