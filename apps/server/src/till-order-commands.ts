import type { Transaction } from "@waitron/db";
import { canUseDeviceProfile } from "@waitron/identity";
import type { AllergyCommand } from "@waitron/module";
import { isUuid, AppError } from "@waitron/shared";
import { invalid } from "./bill-allocation.js";
import { submissionIdOf } from "./bill-payments-api.js";
import { assertDeviceStillProven, assertProfileAction } from "./device-session.js";
import type { PartyCommandArgs } from "./order-group-records.js";
import type { StationMoveRequest } from "./station-move.js";
import { requireRevision } from "./till-request-fields.js";
import { requireSession, assertStillSignedIn } from "./till-session.js";
import "./errors.js";

/** The body of a move-station request on order `orderId`. */
export function stationMoveRequest(
  orderId: string,
  body: Record<string, unknown>,
): StationMoveRequest {
  const submissionId = submissionIdOf(body);
  if (
    !Array.isArray(body.lineIds) ||
    body.lineIds.length === 0 ||
    body.lineIds.length > 100 ||
    !body.lineIds.every((lineId) => typeof lineId === "string")
  )
    throw invalid("lineIds");
  const lineIds = body.lineIds as string[];
  for (const lineId of lineIds)
    if (!isUuid(lineId)) throw new AppError("tab.line_not_found", { tabId: orderId, lineId });
  if (typeof body.stationId !== "string" || !isUuid(body.stationId))
    throw new AppError("station.not_found", { stationId: String(body.stationId) });
  return { submissionId, lineIds, stationId: body.stationId };
}
/** What every group command carries: its submission id, the party revision read, and who acts —
 *  the signed-in person or the kitchen display. */
export function groupCommand(operatorId: string, body: Record<string, unknown>): PartyCommandArgs {
  return {
    submissionId: submissionIdOf(body),
    expectedPartyRevision: requireRevision(body.expectedPartyRevision, "expectedPartyRevision"),
    operatorId,
  };
}

export function allergyCommand(body: Record<string, unknown>): AllergyCommand | undefined {
  if (
    body.submissionId === undefined &&
    body.expectedPartyRevision === undefined &&
    body.allergy === undefined
  )
    return undefined;
  const { submissionId, expectedPartyRevision } = groupCommand("", body);
  return {
    submissionId,
    expectedPartyRevision,
    ...(body.allergy === undefined ? {} : { allergy: body.allergy as AllergyCommand["allergy"] }),
  };
}

export async function recheckFireSession(
  tx: Transaction,
  session: Awaited<ReturnType<typeof requireSession>>,
) {
  await assertStillSignedIn(tx, session);
  const device = await assertDeviceStillProven(tx, { device: session.device, tokenHash: null });
  assertProfileAction(device, "take-orders");
  if (!(await canUseDeviceProfile(tx, device.deviceProfileId, session.personId)))
    throw new AppError("device_profile.not_admitted", {});
  return { ...session, device };
}
