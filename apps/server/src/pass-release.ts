import "./errors.js";
import { and, eq, inArray } from "drizzle-orm";
import { profileAllows } from "@waitron/layouts";
import { AppError, isUuid } from "@waitron/shared";
import { deviceProfiles, devices, nowIso, ticketItems } from "@waitron/db";
import type { Transaction } from "@waitron/db";
import { captureKitchenActivity } from "./attendance-capture.js";
import { deviceBindingColumns, deviceProfileJoin, toDeviceBinding } from "./device-session.js";
import { requestedItem } from "./kitchen-phase.js";
import { VENUE_SERVICE } from "./modules.js";
import { passScopeOf, readPassCardRows, type PassScope } from "./pass-board.js";
import { passCardRelease, type PassRow, type PassTarget } from "./pass-card.js";
import { enqueueKitchenTickets, type FiredItem } from "./kitchen-print.js";
import { notifyKitchenAllergyDestination } from "./kitchen-allergy.js";
import { heldPaperStations } from "./order-groups.js";
import type { TradingContext } from "./trading-context.js";
import { assertSubjectZones } from "./zone-access.js";
import { runServiceCommand, type CommandScope } from "./parties.js";
import type { OrderAttendance } from "./working-order.js";

export type PassActor =
  { deviceId: string; personId: null } | { deviceId: string; personId: string; sessionId: string };

export interface PassReleaseAsk {
  submissionId: string;
  target: PassTarget;
  ticketItemIds: string[];
  expectedContext: string;
}

export interface PassReleaseResult {
  releasedTicketItemIds: string[];
}

const stale = () => new AppError("ticket.pass_context_changed", {});

/** D48: authority, then `passReleaseAsk(body)`, then zones, replay and staleness. */
export async function releasePassItems(
  tx: Transaction,
  cfg: TradingContext,
  by: PassActor,
  body: unknown,
  attendance?: OrderAttendance,
): Promise<PassReleaseResult> {
  const [row] = await tx
    .select(deviceBindingColumns)
    .from(devices)
    .innerJoin(deviceProfiles, deviceProfileJoin)
    .where(eq(devices.id, by.deviceId));
  if (row === undefined) throw new AppError("device.unauthorized", {});
  const device = toDeviceBinding(by.deviceId, row);
  if (device.formFactor !== "kds" && by.personId === null)
    throw new AppError("session.required", {});
  for (const [allowed, action] of [
    [profileAllows(device, "prepare-orders"), "prepare-orders"],
    [device.capabilities.includes("run-the-pass"), "run-the-pass"],
  ] as const)
    if (!allowed) throw new AppError("device.forbidden_action", { action });
  const screen = (await VENUE_SERVICE.readDeviceKitchenScreens(tx, cfg, by.deviceId)).find(
    (candidate) => candidate.kind === "pass",
  );
  if (screen?.available !== true) throw new AppError("device.unauthorized", {});
  const ask = passReleaseAsk(body);
  await assertSubjectZones(tx, cfg, device.deviceProfileId, [
    ask.target.kind === "group"
      ? { partyId: ask.target.partyId }
      : { orderId: ask.target.workingOrderId },
  ]);

  const asked = [...ask.ticketItemIds].sort();
  const scope: CommandScope =
    ask.target.kind === "group"
      ? { kind: "party", partyId: ask.target.partyId }
      : { kind: "bill", workingOrderId: ask.target.workingOrderId };
  return runServiceCommand(
    tx,
    scope,
    ask.submissionId,
    "pass.release",
    {
      target: ask.target,
      ticketItemIds: asked,
      expectedContext: ask.expectedContext,
      deviceId: by.deviceId,
      personId: by.personId,
    },
    () => release(tx, cfg, by, passScopeOf(screen), ask, asked, attendance),
  );
}

/** D47, D49 to D52: the staleness checks, the write, the paper and the person's kitchen work. */
async function release(
  tx: Transaction,
  cfg: TradingContext,
  by: PassActor,
  passScope: PassScope,
  ask: PassReleaseAsk,
  asked: readonly string[],
  attendance: OrderAttendance | undefined,
): Promise<PassReleaseResult> {
  const cardRows = await readPassCardRows(tx, cfg, ask.target);
  const offered = passCardRelease(ask.target, cardRows, passScope);
  if (
    offered.context === null ||
    offered.context !== ask.expectedContext ||
    asked.length !== offered.ticketItemIds.length ||
    asked.some((id, index) => id !== offered.ticketItemIds[index])
  )
    throw stale();

  const at = nowIso();
  const released = await tx
    .update(ticketItems)
    .set({ firedAt: at, queuedAt: at })
    .where(and(inArray(ticketItems.id, offered.ticketItemIds), requestedItem()))
    .returning({ orderId: ticketItems.workingOrderId });
  if (released.length !== offered.ticketItemIds.length) throw stale();
  await printRelease(tx, cfg, ask.target, cardRows, offered.ticketItemIds);
  await captureKitchenActivity(
    tx,
    attendance,
    by.personId,
    released.map((row) => row.orderId),
    ask.submissionId,
  );
  return { releasedTicketItemIds: offered.ticketItemIds };
}

/** D50, D52: one ticket per bill at each output, FIRE where the group's HOLD paper printed, then
 *  the allergy notice, read after the stamp so a released dish's slip carries no HOLD label. */
async function printRelease(
  tx: Transaction,
  cfg: TradingContext,
  target: PassTarget,
  cardRows: readonly PassRow[],
  releasedIds: readonly string[],
): Promise<void> {
  const ids = new Set(releasedIds);
  const heldPaper =
    target.kind === "group"
      ? ((await heldPaperStations(tx, [target.groupId])).get(target.groupId) ?? new Set<string>())
      : new Set<string>();
  const byOrder = new Map<string, FiredItem[]>();
  for (const row of cardRows) {
    if (!ids.has(row.item.id)) continue;
    const items = byOrder.get(row.orderId) ?? [];
    items.push({
      workingOrderLineId: row.lineId,
      stationId: row.stationId,
      quantity: row.remaining,
    });
    byOrder.set(row.orderId, items);
  }
  for (const [orderId, items] of byOrder)
    await enqueueKitchenTickets(tx, cfg, orderId, items, { fire: { heldPaper } });
  await notifyKitchenAllergyDestination(tx, cfg, releasedIds);
}

const invalid = (field: string) => new AppError("management.request_invalid", { field });

function uuid(value: unknown): string | null {
  return typeof value === "string" && isUuid(value) ? value.toLowerCase() : null;
}

function target(value: unknown): PassTarget {
  if (typeof value === "object" && value !== null) {
    const ask = value as Record<string, unknown>;
    if (ask.kind === "group") {
      const [partyId, groupId] = [uuid(ask.partyId), uuid(ask.groupId)];
      if (partyId !== null && groupId !== null) return { kind: "group", partyId, groupId };
    } else if (ask.kind === "bill") {
      const workingOrderId = uuid(ask.workingOrderId);
      if (workingOrderId !== null) return { kind: "bill", workingOrderId };
    }
  }
  throw invalid("target");
}

/** The ask's shape only (D48 step 3). */
export function passReleaseAsk(body: unknown): PassReleaseAsk {
  const ask = (typeof body === "object" && body !== null ? body : {}) as Record<string, unknown>;
  const ids = Array.isArray(ask.ticketItemIds) ? ask.ticketItemIds.map(uuid) : [];
  if (ids.length === 0 || ids.includes(null) || new Set(ids).size !== ids.length)
    throw invalid("ticketItemIds");
  const passTarget = target(ask.target);
  if (typeof ask.expectedContext !== "string" || !/^[0-9a-f]{64}$/.test(ask.expectedContext))
    throw invalid("expectedContext");
  const submissionId = uuid(ask.submissionId);
  if (submissionId === null) throw invalid("submissionId");
  return {
    submissionId,
    target: passTarget,
    ticketItemIds: ids as string[],
    expectedContext: ask.expectedContext,
  };
}
