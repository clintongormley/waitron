import "./errors.js";
import {
  type Transaction,
  type OrderGroupRequestKind,
  nowIso,
  orderGroups,
  workingOrderLines,
  parties,
  orderEvents,
  workingOrders,
} from "@waitron/db";
import type { AllergyPatch } from "@waitron/module";
import { AppError, partyTablesName } from "@waitron/shared";
import { and, eq, sql, gt, ne, inArray, notExists, isNull, or } from "drizzle-orm";
import type { AttendanceRecorder } from "./attendance-capture.js";
import type { LateSendConfirmation } from "./late-send.js";
import { readPartyTables } from "./orders-list.js";

export type GroupRelease = "fire" | "hold";

export interface PartyCommandArgs {
  submissionId: string;
  expectedPartyRevision: number;
  operatorId: string;
}

export interface PartyFireArgs extends PartyCommandArgs {
  allergy?: AllergyPatch;
  lateSend?: LateSendConfirmation;
}
/** Who fires a group: a person or a kitchen display. */
export type Firer = { personId: string } | { deviceId: string };
/**
 * A new group at the end of the party's sequence, fired or held, submitted by the operator. The
 * caller puts its lines in it and records its event.
 */
export async function startGroup(
  tx: Transaction,
  partyId: string,
  release: GroupRelease,
  operatorId: string,
  requestKind: OrderGroupRequestKind,
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
      requestKind,
    })
    .returning({ id: orderGroups.id });
  return group!.id;
}
/**
 * new_order while the party has no fired group, added after: a held or removed group is not food
 * the pass was asked to cook.
 */
export async function nextFireKind(
  tx: Transaction,
  partyId: string,
): Promise<"new_order" | "added"> {
  const [group] = await tx
    .select({ id: orderGroups.id })
    .from(orderGroups)
    .where(and(eq(orderGroups.partyId, partyId), eq(orderGroups.state, "fired")))
    .limit(1);
  return group === undefined ? "new_order" : "added";
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
  const groupId = await startGroup(tx, partyId, "hold", operatorId, "next_course");
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
                .where(
                  and(
                    eq(workingOrderLines.groupId, orderGroups.id),
                    isNull(sql`+${workingOrderLines.parentLineId}`),
                  ),
                ),
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
      { partyId, groupId, kind: "group.removed", actorId, detail: {} },
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
export async function requireHeldGroup(
  tx: Transaction,
  partyId: string,
  groupId: string,
): Promise<void> {
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
export async function lastPosition(tx: Transaction, partyId: string): Promise<number> {
  const [{ last }] = await tx
    .select({ last: sql<number>`cast(coalesce(max(${orderGroups.position}), 0) as int)` })
    .from(orderGroups)
    .where(eq(orderGroups.partyId, partyId));
  return last;
}
export async function nextGroupNumber(tx: Transaction, partyId: string): Promise<number> {
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
export function groupNumberIdentity(group: {
  displayNumber: number;
  numberPartyId: string | null;
}): {
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
export async function currentRevision(tx: Transaction, partyId: string): Promise<number> {
  const [party] = await tx
    .select({ revision: parties.revision })
    .from(parties)
    .where(eq(parties.id, partyId));
  if (party === undefined) throw new AppError("party.not_open", { partyId });
  return party.revision;
}

export async function recordGroupEvent(
  tx: Transaction,
  values: typeof orderEvents.$inferInsert & {
    kind: Extract<(typeof orderEvents.$inferInsert)["kind"], `group.${string}`>;
    partyId: string;
  },
  attendance?: { recorder: AttendanceRecorder; at: string },
): Promise<void> {
  const [event] = await tx.insert(orderEvents).values(values).returning({ id: orderEvents.id });
  if (attendance === undefined || !values.actorId) return;
  const [order] = await tx
    .select({ id: workingOrders.id })
    .from(workingOrders)
    .where(eq(workingOrders.partyId, values.partyId))
    .limit(1);
  if (order === undefined) return;
  await attendance.recorder(tx, {
    source: "draft",
    key: `group:${event!.id}`,
    personId: values.actorId,
    kind: "order",
    at: attendance.at,
    offsetMinutes: 0,
    outcome: "qualified",
  });
}
