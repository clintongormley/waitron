import "./errors.js";
import type { Transaction } from "@waitron/db";
import type { ClockStepRecorded, ClockStepRequest } from "@waitron/fiscal";
import type { ErrorParams, NodeId } from "@waitron/shared";
import { CLOCK_BEHIND_MARGIN_MS, chainHeads, latestRecord } from "./clock-behind.js";
import {
  closingProof,
  nextConfirmationSeq,
  openCheck,
  openClockCheck,
  storedWitnesses,
  type OpenCheck,
} from "./clock-checks.js";
import { recordCorrected, recordMisdated, recordRestarted } from "./clock-stop-incidents.js";
import { clockConfirmations } from "./schema/clock-confirmations.js";

/** An unverified step this small is the clock's own drift, not a step worth an alert. */
const UNVERIFIED_STEP_FLOOR_MS = 1_000;

/** A request whose person does not match its source is a caller's bug, refused before any write. */
function assertPersonMatchesSource(input: ClockStepRequest): void {
  const { source, admin } = input;
  const matches =
    source === "authority"
      ? admin === undefined
      : source === "admin"
        ? admin !== undefined && admin.role === undefined
        : admin?.role === "staff" && admin.device !== undefined;
  if (!matches)
    throw new Error(`confirmClockStep: a ${source} step was given a person that does not match it`);
}

/** The check this step closes: during a stop, the stop's check at the before reading, opened then
 * if none is open (its closing is then `partial`); with no stop there, the open check if any. */
async function stepCheck(
  tx: Transaction,
  input: ClockStepRequest,
): Promise<{ check: OpenCheck; openedNow: boolean } | null> {
  const existing = await openCheck(tx);
  const opened = await openClockCheck(tx, {
    reading: input.before,
    boot: input.bootBefore,
    nodeId: input.nodeId,
  });
  if (opened === null) return existing === null ? null : { check: existing, openedNow: false };
  const openedNow = existing?.id !== opened.id;
  // The stop holds at the before reading, so the check just answered is open.
  return { check: openedNow ? (await openCheck(tx))! : existing!, openedNow };
}

/** Records a step of the box's clock from `before` to `after` (decision 7 of the 9b plan): a
 * verified step writes one `clock_confirmations` row, `confirmed_at` the after reading; for the
 * clock-behind stop it closes the stop's check, and names the latest record (a lift, with
 * `clock.behind_chain_restarted`) when the after reading is still more than a minute behind it.
 * An unusable clock's step names no check and no record. Every step records `clock.corrected`; an
 * unverified one writes no row, and nothing at all when the clock moved by a second or less. */
export async function confirmClockStep(
  tx: Transaction,
  input: ClockStepRequest,
): Promise<ClockStepRecorded> {
  assertPersonMatchesSource(input);
  const { admin, after, source } = input;
  const params: ErrorParams["clock.corrected"] = {
    confirmationId: null,
    source,
    person: admin?.personName ?? null,
    deviceId: admin?.device?.deviceId ?? null,
    device: admin?.device?.deviceLabel ?? null,
    before: input.before.instant.toISOString(),
    beforeOffsetMinutes: input.before.offsetMinutes,
    after: after.instant.toISOString(),
    afterOffsetMinutes: after.offsetMinutes,
    stepMs: input.stepMs,
    direction: input.stepMs < 0 ? "back" : "forward",
    verified: input.verified,
    unverified: !input.verified,
    byAdmin: source === "admin",
    byStaff: source === "staff",
  };
  if (!input.verified) {
    const corrected =
      Math.abs(input.stepMs) > UNVERIFIED_STEP_FLOOR_MS
        ? await recordCorrected(tx, { detectedAt: after.instant, params })
        : null;
    return { confirmation: null, corrected };
  }

  const stop = input.reason === "behind_chain" ? await stepCheck(tx, input) : null;
  const latest = stop === null ? undefined : await latestRecord(tx);
  const named =
    latest !== undefined && after.instant.getTime() < latest.at.getTime() - CLOCK_BEHIND_MARGIN_MS
      ? latest
      : null;
  const closing =
    stop === null
      ? null
      : closingProof(stop.check, after.instant, input.bootAfter, {
          unconfirmed: false,
          openedNow: stop.openedNow,
        });
  const personId = admin?.personId ?? null;
  const seq = await nextConfirmationSeq(tx);
  const [row] = await tx
    .insert(clockConfirmations)
    .values({
      seq,
      nodeId: input.nodeId as NodeId,
      boxClockAt: input.before.instant,
      confirmedAt: after.instant,
      stepMs: Math.round(input.stepMs),
      source,
      personId,
      reason: input.reason,
      proof: {
        ...storedWitnesses({
          authority: input.witnesses.find((witness) => witness.kind === "authority") ?? null,
          devices: input.witnesses.filter((witness) => witness.kind === "device"),
          admin: admin?.reading ?? null,
          ...(admin?.role === undefined ? {} : { role: admin.role }),
          ...(admin?.device === undefined
            ? {}
            : { device: { deviceId: admin.device.deviceId, address: admin.device.address } }),
        }),
        step: {
          beforeAt: input.before.instant.toISOString(),
          afterAt: after.instant.toISOString(),
          stepMs: input.stepMs,
          targetAt: input.targetAt,
        },
        ...(stop === null ? {} : { heads: await chainHeads(tx), closing }),
      },
      checkId: stop?.check.id ?? null,
      registroId: named?.id ?? null,
      recordAt: named?.at ?? null,
    })
    .returning({ id: clockConfirmations.id });
  const confirmationId = row!.id;
  if (named !== null)
    await recordRestarted(tx, {
      recordId: named.id,
      detectedAt: after.instant,
      params: {
        confirmationId,
        confirmedBy: source,
        person: params.person,
        clockAt: after.instant.toISOString(),
        lastRecordAt: named.at.toISOString(),
        ...(source === "staff" ? { byStaff: true as const } : {}),
        ...(admin?.device === undefined ? {} : { device: admin.device.deviceLabel }),
      },
    });
  if (stop !== null)
    await recordMisdated(tx, {
      confirmationId,
      check: stop.check,
      partial: closing!.partial,
      reading: after,
    });
  const corrected = await recordCorrected(tx, {
    detectedAt: after.instant,
    params: { ...params, confirmationId },
  });
  return {
    corrected,
    confirmation: {
      id: confirmationId,
      seq,
      source,
      personId,
      confirmedAt: after.instant.toISOString(),
      checkId: stop?.check.id ?? null,
      recordId: named?.id ?? null,
    },
  };
}
