import "./errors.js";
import { and, eq, inArray } from "drizzle-orm";
import { AppError, isUuid } from "@waitron/shared";
import { deviceProfiles, devices, nowIso, ticketItems } from "@waitron/db";
import type { Transaction } from "@waitron/db";
import { deviceBindingColumns, deviceProfileJoin } from "./device-session.js";
import { requestedItem } from "./kitchen-phase.js";
import { VENUE_SERVICE } from "./modules.js";
import { passScopeOf, readPassCardRows } from "./pass-board.js";
import { passCardRelease, type PassTarget } from "./pass-card.js";
import type { TradingContext } from "./trading-context.js";
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

/** D48: authority, then `passReleaseAsk(body)`, then zones, replay (B3.5a1) and staleness. */
export async function releasePassItems(
  tx: Transaction,
  cfg: TradingContext,
  by: PassActor,
  body: unknown,
  _attendance?: OrderAttendance,
): Promise<PassReleaseResult> {
  const [device] = await tx
    .select(deviceBindingColumns)
    .from(devices)
    .innerJoin(deviceProfiles, deviceProfileJoin)
    .where(eq(devices.id, by.deviceId));
  if (device === undefined) throw new AppError("device.unauthorized", {});
  const screen = (await VENUE_SERVICE.readDeviceKitchenScreens(tx, cfg, by.deviceId)).find(
    (candidate) => candidate.kind === "pass",
  );
  if (screen?.available !== true) throw new AppError("device.unauthorized", {});
  const ask = passReleaseAsk(body);

  const offered = passCardRelease(
    ask.target,
    await readPassCardRows(tx, cfg, ask.target),
    passScopeOf(screen),
  );
  const asked = [...ask.ticketItemIds].sort();
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
    .returning({ id: ticketItems.id });
  if (released.length !== offered.ticketItemIds.length) throw stale();
  return { releasedTicketItemIds: offered.ticketItemIds };
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
