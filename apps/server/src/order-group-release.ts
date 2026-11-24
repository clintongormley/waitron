import "./errors.js";
import {
  type Transaction,
  workingOrderLines,
  workingOrders,
  unpaidDepartures,
  orderGroups,
} from "@waitron/db";
import { AppError } from "@waitron/shared";
import { eq, and, isNull, sql, inArray, ne, or, asc } from "drizzle-orm";
import type { AttendanceRecorder } from "./attendance-capture.js";
import { dishKitchenItems } from "./dish-kitchen.js";
import type { LateSendConfirmation } from "./late-send.js";
import { readLineCancellations } from "./line-service-state.js";
import {
  printedHeldGroups,
  heldPaperStations,
  heldItemsOf,
  correctHoldTickets,
} from "./order-group-hold-paper.js";
import {
  type PartyFireArgs,
  type Firer,
  requireHeldGroup,
  readGroupNumberLabels,
  nextFireKind,
  startGroup,
  recordGroupEvent,
  removeEmptiedHeldGroups,
} from "./order-group-records.js";
import { activeGroupLines } from "./order-group-transfer.js";
import { runServiceCommand, checkAndBumpParty, partyFamily } from "./parties.js";
import {
  normaliseAllergyPatch,
  prepareAllergyRelease,
  assertPartyAllergyAnswered,
} from "./party-allergy.js";
import type { OriginConfig } from "./trading-context.js";
import type { OrderAttendance } from "./working-order-context.js";
import { routingOnce } from "./working-order-kitchen-fire.js";
import { fireOrderLines } from "./working-order-kitchen-service.js";
import { lateUnsentDishesOf } from "./working-order-late-send.js";
import { clearGroups } from "./working-order-transfer.js";

async function judgeHeldSetMenuDishes(
  tx: Transaction,
  lines: readonly {
    id: string;
    workingOrderId: string;
    setMenuRole: "set_menu" | "dish" | null;
    sentAt: string | null;
  }[],
  lateSend: LateSendConfirmation | undefined,
): Promise<void> {
  const dishes = lines.filter(({ setMenuRole }) => setMenuRole === "dish");
  if (dishes.length === 0) return;
  const kitchen = await dishKitchenItems(
    tx,
    dishes.map(({ id }) => id),
  );
  const bills = new Map<string, { id: string; parentLineId: null }[]>();
  for (const { id, workingOrderId, sentAt } of dishes) {
    const items = kitchen.get(id);
    const held =
      items === undefined
        ? sentAt === null
        : items.some(({ requestedAt, firedAt }) => requestedAt === null && firedAt === null);
    if (!held) continue;
    const bill = bills.get(workingOrderId) ?? [];
    bill.push({ id, parentLineId: null });
    bills.set(workingOrderId, bill);
  }
  await lateUnsentDishesOf(
    tx,
    [...bills].map(([orderId, lines]) => ({ orderId, lines })),
    { ask: lateSend },
  );
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
  args: PartyFireArgs,
  firer: Firer = { personId: args.operatorId },
  attendance?: OrderAttendance,
): Promise<{ revision: number }> {
  const routing = routingOnce(tx, new Date());
  if (args.allergy !== undefined) args = { ...args, allergy: normaliseAllergyPatch(args.allergy) };
  return runServiceCommand(
    tx,
    { kind: "party", partyId },
    args.submissionId,
    "group.fire",
    {
      partyId,
      groupId,
      operatorId: args.operatorId,
      ...(args.allergy === undefined ? {} : { allergy: args.allergy }),
    },
    async () => {
      const revision = await checkAndBumpParty(tx, partyId, args.expectedPartyRevision, "open");
      await requireHeldGroup(tx, partyId, groupId);
      await prepareAllergyRelease(
        tx,
        cfg,
        partyId,
        { kind: "group", groupId },
        args.allergy,
        "personId" in firer ? firer.personId : null,
      );
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
        undefined,
        { ask: args.lateSend },
      );
      return { revision };
    },
    cfg.madeHereSink,
  );
}
/** Fire a whole held dish and its extras without changing its bill's financial facts. */
export async function fireHeldLine(
  tx: Transaction,
  cfg: OriginConfig,
  partyId: string,
  lineId: string,
  args: PartyFireArgs,
  attendance?: OrderAttendance,
): Promise<{ revision: number }> {
  const routing = routingOnce(tx, new Date());
  if (args.allergy !== undefined) args = { ...args, allergy: normaliseAllergyPatch(args.allergy) };
  return runServiceCommand(
    tx,
    { kind: "party", partyId },
    args.submissionId,
    "group.fire_line",
    {
      partyId,
      lineId,
      operatorId: args.operatorId,
      ...(args.allergy === undefined ? {} : { allergy: args.allergy }),
    },
    async () => {
      const revision = await checkAndBumpParty(tx, partyId, args.expectedPartyRevision, "open");
      const [line] = await tx
        .select({
          groupId: workingOrderLines.groupId,
          quantity: workingOrderLines.quantity,
          setMenuRole: workingOrderLines.setMenuRole,
          sentAt: workingOrderLines.sentAt,
          workingOrderId: workingOrderLines.workingOrderId,
          billStatus: workingOrders.status,
          departureId: unpaidDepartures.id,
          state: orderGroups.state,
        })
        .from(workingOrderLines)
        .innerJoin(workingOrders, eq(workingOrders.id, workingOrderLines.workingOrderId))
        .innerJoin(orderGroups, eq(orderGroups.id, workingOrderLines.groupId))
        .leftJoin(unpaidDepartures, eq(unpaidDepartures.workingOrderId, workingOrders.id))
        .where(
          and(
            eq(workingOrderLines.id, lineId),
            // The NULL-parent index range includes historical top-level dishes.
            isNull(sql`+${workingOrderLines.parentLineId}`),
            inArray(workingOrders.partyId, await partyFamily(tx, partyId)),
            eq(orderGroups.partyId, partyId),
            ne(orderGroups.state, "removed"),
          ),
        );
      if (line === undefined) throw new AppError("group.not_found", { lineId });
      if (line.state !== "held") throw new AppError("group.not_held", { groupId: line.groupId! });
      if (line.billStatus === "abandoned" || line.departureId !== null)
        throw new AppError("tab.not_open", { tabId: line.workingOrderId });
      const cancelled = (await readLineCancellations(tx, [lineId])).get(lineId) ?? 0;
      if (line.quantity <= cancelled) throw new AppError("group.line_cancelled", { lineId });
      await prepareAllergyRelease(
        tx,
        cfg,
        partyId,
        { kind: "held-line", lineId },
        args.allergy,
        args.operatorId,
      );
      await judgeHeldSetMenuDishes(tx, [{ id: lineId, ...line }], args.lateSend);
      const source = line.groupId!;
      const printed = (await printedHeldGroups(tx, [source])).get(source);
      const heldPaper = (await heldPaperStations(tx, [source])).get(source) ?? new Set<string>();
      const labels = await readGroupNumberLabels(tx, [partyId]);
      if (printed !== undefined) {
        const items = (await heldItemsOf(tx, [lineId])).get(lineId) ?? [];
        await correctHoldTickets(
          tx,
          cfg,
          items.map((item) => ({
            workingOrderId: line.workingOrderId,
            workingOrderLineId: item.workingOrderLineId,
            stationId: item.stationId,
            quantity: item.firedQuantity,
            groupId: source,
            group: printed,
            numberPartyLabel: labels.get(source),
          })),
          { kind: "HOLD CHANGED", direction: "removed" },
        );
      }
      const kind = (await nextFireKind(tx, partyId)) === "new_order" ? "new_order" : "next_course";
      const groupId = await startGroup(tx, partyId, "fire", args.operatorId, kind, {
        at: routing.at.toISOString(),
        by: { personId: args.operatorId },
      });
      await tx
        .update(workingOrderLines)
        .set({ groupId })
        .where(or(eq(workingOrderLines.id, lineId), eq(workingOrderLines.parentLineId, lineId)));
      await fireOrderLines(tx, cfg, line.workingOrderId, [lineId], { heldPaper }, routing);
      const snapshot =
        attendance === undefined
          ? undefined
          : {
              recorder: attendance.recorder,
              at: attendance.clock.now().instant.toISOString(),
            };
      await recordGroupEvent(
        tx,
        {
          partyId,
          groupId,
          kind: "group.fired",
          actorId: args.operatorId,
          detail: { lineId, from: source },
        },
        snapshot,
      );
      await removeEmptiedHeldGroups(tx, partyId, [source], args.operatorId, snapshot);
      return { revision };
    },
    cfg.madeHereSink,
  );
}
/**
 * Before these bills leave the party: fire each held group holding one of their dishes, in the
 * party's group order, and take apart one with no dish left to fire.
 */
export async function releaseHeldWorkOf(
  tx: Transaction,
  cfg: OriginConfig,
  partyId: string,
  billIds: readonly string[],
  operatorId: string,
  attendance?: OrderAttendance,
): Promise<void> {
  if (billIds.length === 0) return;
  const serviceDish = isNull(sql`+${workingOrderLines.parentLineId}`);
  const held = await tx
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
        inArray(workingOrderLines.workingOrderId, [...billIds]),
        serviceDish,
      ),
    )
    .orderBy(asc(orderGroups.position), asc(orderGroups.createdAt), asc(orderGroups.id));
  if (held.length === 0) return;
  const recorded =
    attendance === undefined
      ? undefined
      : { recorder: attendance.recorder, at: attendance.clock.now().instant.toISOString() };
  const routing = routingOnce(tx, new Date());
  for (const group of held) {
    const active = await activeGroupLines(tx, group.id);
    if (active.length > 0) {
      await releaseGroup(
        tx,
        cfg,
        partyId,
        group.id,
        { personId: operatorId },
        {},
        routing,
        recorded,
        active,
      );
      continue;
    }
    const lines = await tx
      .select({ id: workingOrderLines.id })
      .from(workingOrderLines)
      .where(
        and(
          eq(workingOrderLines.groupId, group.id),
          serviceDish,
          inArray(workingOrderLines.workingOrderId, [...billIds]),
        ),
      );
    await clearGroups(
      tx,
      lines.map((line) => line.id),
    );
    await removeEmptiedHeldGroups(tx, partyId, [group.id], operatorId, recorded);
  }
}
/**
 * Release a held group's lines bill by bill, in the order the bills were opened, as
 * {@link fireOrderLines} releases them, and record it fired. The caller has checked the group is
 * held.
 */
async function releaseGroup(
  tx: Transaction,
  cfg: OriginConfig,
  partyId: string,
  groupId: string,
  firer: Firer,
  detail: Record<string, unknown>,
  routing = routingOnce(tx, new Date()),
  attendance?: { recorder: AttendanceRecorder; at: string },
  active?: Awaited<ReturnType<typeof activeGroupLines>>,
  late?: { ask: LateSendConfirmation | undefined },
): Promise<void> {
  active ??= await activeGroupLines(tx, groupId);
  if (active.length === 0) throw new AppError("management.request_invalid", { field: "groupId" });
  await assertPartyAllergyAnswered(tx, partyId);
  if (late !== undefined) await judgeHeldSetMenuDishes(tx, active, late.ask);
  const byOrder = new Map<string, string[]>();
  for (const line of active) {
    byOrder.set(line.workingOrderId, [...(byOrder.get(line.workingOrderId) ?? []), line.id]);
  }
  // The record, not the setting: a ticket at a station recorded as having the group's HOLD paper is
  // marked FIRE.
  const fire = { heldPaper: (await heldPaperStations(tx, [groupId])).get(groupId) ?? new Set() };
  // Every bill in this group must use the same station snapshot at the release instant.
  await routing();
  for (const [orderId, lineIds] of byOrder) {
    await fireOrderLines(tx, cfg, orderId, lineIds, fire, routing);
  }
  const firstFood = (await nextFireKind(tx, partyId)) === "new_order";
  await tx
    .update(orderGroups)
    .set({
      state: "fired",
      ...(firstFood ? { requestKind: "new_order" as const } : {}),
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
      kind: "group.fired",
      detail,
      ...("deviceId" in firer ? { actorDeviceId: firer.deviceId } : { actorId: firer.personId }),
    },
    attendance,
  );
}
