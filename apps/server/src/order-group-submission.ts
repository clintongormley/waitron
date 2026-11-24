import "./errors.js";
import { type Transaction, workingOrderLines } from "@waitron/db";
import type { AllergyPatch, AllergyLineRef } from "@waitron/module";
import { AppError } from "@waitron/shared";
import { and, eq, or, inArray } from "drizzle-orm";
import type { AttendanceRecorder } from "./attendance-capture.js";
import { parseBillEditExpected, requireBillEditor } from "./bill-editing.js";
import { copyAllergyWorkingTicks, enqueueKitchenAllergyChanges } from "./kitchen-allergy.js";
import type { LateSendConfirmation } from "./late-send.js";
import { VENUE_SERVICE } from "./modules.js";
import type { BillEditExpected } from "./order-drafts.js";
import { correctJoin, printHoldTickets } from "./order-group-hold-paper.js";
import { type OrderGroup, readGroups } from "./order-group-reads.js";
import {
  type GroupRelease,
  requireHeldGroup,
  nextFireKind,
  startGroupAfter,
  startGroup,
  recordGroupEvent,
  currentRevision,
} from "./order-group-records.js";
import { expandPortionRows } from "./order-portions.js";
import { runServiceCommand, checkAndBumpParty, requireBillOfParty } from "./parties.js";
import {
  normaliseAllergyPatch,
  applyPartyAllergyPatch,
  assertPartyAllergyAnswered,
} from "./party-allergy.js";
import type { OriginConfig } from "./trading-context.js";
import type { OrderAttendance } from "./working-order-context.js";
import { refusePaymentInFlight, bumpRevision } from "./working-order-edit-state.js";
import { fireableLineColumns, routingOnce, fireLines } from "./working-order-kitchen-fire.js";
import { type TabRoundLine, priceTabRound, insertTabRound } from "./working-order-open.js";

/** A line of a submitted group: a round line, released with its group rather than by course. */
export type GroupLine = TabRoundLine;

export interface SubmitGroupsInput {
  allergy?: AllergyPatch;
  expectedEdit: BillEditExpected;
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
  /** When supplied, must agree with expectedEdit.billId. */
  billId?: string;
  /** Kept out of the replay fingerprint: a retry without it gets the recorded answer. */
  lateSend?: LateSendConfirmation;
}

export interface SubmittedGroups {
  /** The bill the lines went on. */
  tabId: string;
  revision: number;
  /** The groups this submission created or joined, in the order submitted. */
  groups: OrderGroup[];
}
/**
 * Put each submitted group's lines on the observed bill,
 * released to the kitchen now (`fire`) or held until {@link fireGroup}. Every line is credited to
 * the operator. A new held group prints its HOLD ticket at the stations that print held work in
 * advance ({@link printHoldTickets}); lines joining a group print `+N` at the stations that have its
 * HOLD paper ({@link recordJoiningStations}).
 */
export async function submitGroups(
  tx: Transaction,
  cfg: OriginConfig,
  partyId: string,
  input: SubmitGroupsInput,
  attendance?: OrderAttendance,
): Promise<SubmittedGroups> {
  const {
    submissionId,
    expectedPartyRevision,
    operatorId,
    expectedEdit: observed,
    lateSend,
    ...body
  } = input;
  const expectedEdit = parseBillEditExpected(observed);
  const allergy = input.allergy === undefined ? undefined : normaliseAllergyPatch(input.allergy);
  return runServiceCommand(
    tx,
    { kind: "party", partyId },
    submissionId,
    "group.submit",
    { partyId, operatorId, ...body, allergy, expectedEdit },
    async () => {
      await checkAndBumpParty(tx, partyId, expectedPartyRevision, "open");
      return placeGroups(
        tx,
        cfg,
        partyId,
        { ...input, expectedEdit, lateSend },
        attendance === undefined
          ? undefined
          : { recorder: attendance.recorder, at: attendance.clock.now().instant.toISOString() },
        async (portionIds) => {
          let parent = 0;
          const targets = input.groups.flatMap((group, groupIndex) =>
            group.lines.map((_, lineIndex) => ({
              ref: { kind: "submitted", groupIndex, lineIndex } as AllergyLineRef,
              draftLineId: null,
              workingLineId: portionIds[parent++]![0]!,
            })),
          );
          if (allergy !== undefined) {
            const changes = await applyPartyAllergyPatch(tx, partyId, allergy, operatorId, targets);
            // One target names one line, so a tick lands on the first portion and is copied to the rest.
            const pairs = portionIds.flatMap(([first, ...rest]) =>
              rest.map((to) => ({ from: first!, to })),
            );
            await copyAllergyWorkingTicks(tx, pairs);
            const copied = new Set(changes.workingLineIds);
            await enqueueKitchenAllergyChanges(tx, cfg, {
              ...changes,
              after: await VENUE_SERVICE.readPartyAllergy(tx, partyId),
              workingLineIds: [
                ...changes.workingLineIds,
                ...pairs.filter(({ from }) => copied.has(from)).map(({ to }) => to),
              ].sort(),
            });
          }
          await assertPartyAllergyAnswered(tx, partyId);
        },
      );
    },
    cfg.madeHereSink,
  );
}

export type PlaceGroupsInput = Pick<
  SubmitGroupsInput,
  "joinGroupId" | "operatorId" | "billId" | "expectedEdit" | "lateSend"
> & {
  groups: (SubmitGroupsInput["groups"][number] & { existingLineIds?: string[] })[];
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
  beforeOutput?: (portionIds: readonly (readonly string[])[]) => Promise<void>,
): Promise<SubmittedGroups> {
  const { operatorId } = input;
  const expectedEdit = parseBillEditExpected(input.expectedEdit);
  const tabId = input.billId ?? expectedEdit.billId;
  if (expectedEdit.billId !== tabId)
    throw new AppError("management.request_invalid", { field: "expectedEdit.billId" });
  await requireBillOfParty(tx, partyId, tabId);
  await refusePaymentInFlight(tx, [tabId]);
  await requireBillEditor(tx, tabId, operatorId, expectedEdit);
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
  const lines = input.groups.flatMap((group) => group.lines);
  const empty = (group: PlaceGroupsInput["groups"][number]) =>
    group.lines.length === 0 && (group.existingLineIds?.length ?? 0) === 0;
  const priced =
    lines.length === 0 && !groups.some(empty)
      ? null
      : await priceTabRound(
          tx,
          cfg,
          tabId,
          empty(groups[0]!) ? [] : lines,
          "checked",
          input.lateSend,
        );
  if (groups.some(empty)) {
    throw new AppError("sale.empty_basket", {});
  }
  const expanded =
    priced === null
      ? null
      : expandPortionRows(
          priced.rows,
          priced.lineContexts,
          priced.portionable,
          priced.rows[0]?.lineNo ?? 1,
        );
  const round =
    priced === null || expanded === null
      ? null
      : { ...priced, rows: expanded.rows, lineContexts: expanded.lineContexts };
  const requestOfRow = expanded?.requestOfRow ?? [];
  const groupIds: string[] = [];
  const insertedAfter = new Map<string, string>();
  const fireKind = groups.some(
    (group) =>
      group.release === "fire" &&
      group.joinGroupId === undefined &&
      group.afterGroupId === undefined,
  )
    ? await nextFireKind(tx, partyId)
    : undefined;
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
    } else
      groupId = await startGroup(
        tx,
        partyId,
        group.release,
        operatorId,
        group.release === "fire" ? fireKind! : "next_course",
      );
    groupIds.push(groupId);
  }
  const groupOfLine = input.groups.flatMap((group, i) => group.lines.map(() => groupIds[i]!));
  const rows = (round?.rows ?? []).map((row, i) => ({
    ...row,
    groupId: groupOfLine[requestOfRow[i]!]!,
    creditedTo: operatorId,
  }));
  const inserted = round === null ? [] : await insertTabRound(tx, cfg, round, rows);
  const portionsOfLine: string[][] = lines.map(() => []);
  rows.forEach((row, i) => {
    if (row.parentLineId == null) portionsOfLine[requestOfRow[i]!]!.push(row.id!);
  });
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
      portionsOfLine.map(([first], i) => ({ draftLineId: draftIds[i]!, workingLineId: first! })),
    );
    await copyAllergyWorkingTicks(
      tx,
      portionsOfLine.flatMap(([first, ...rest]) => rest.map((to) => ({ from: first!, to }))),
    );
  }
  await beforeOutput?.(portionsOfLine);
  const routing = routingOnce(tx, new Date());
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
      await correctJoin(tx, cfg, [
        {
          groupId,
          lineIds: inserted
            .filter((row) => row.groupId === groupId && row.parentLineId == null)
            .map((row) => row.id!),
        },
      ]);
    } else if (!fire) {
      await printHoldTickets(tx, cfg, [groupId]);
    }
    await bumpRevision(tx, [tabId]);
    await recordGroupEvent(
      tx,
      {
        partyId,
        groupId,
        kind: group.joinGroupId === undefined ? "group.submitted" : "group.joined",
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
