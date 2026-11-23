import "./errors.js";
import { and, eq, sql } from "drizzle-orm";
import { incidents } from "@waitron/db";
import type { Transaction } from "@waitron/db";
import type {
  ClockAdminConfirm,
  ClockAdminReading,
  ClockStep,
  ClockStepRecorded,
  ClockStepRequest,
  ClockWitness,
} from "@waitron/fiscal";
import type { ErrorParams, NodeId } from "@waitron/shared";
import { recordCorrected } from "./clock-corrected-incident.js";
import { appendHistory } from "./history.js";

/** An unverified step this small is the clock's own drift, not a step worth an alert. */
const UNVERIFIED_STEP_FLOOR_MS = 1_000;

/** A request whose person does not match its source is a caller's bug, refused before any write;
 * a `setup` step matches no person here, since the regime never records one. */
function assertPersonMatchesSource(
  input: ClockStepRequest,
): asserts input is ClockStepRequest & { source: "admin" | "staff"; admin: ClockAdminConfirm } {
  const { source, admin } = input;
  const matches =
    source === "admin"
      ? admin !== undefined && admin.role === undefined
      : source === "staff"
        ? admin?.role === "staff" && admin.device !== undefined
        : false;
  if (!matches)
    throw new Error(`confirmClockStep: a ${source} step was given a person that does not match it`);
}

interface StepWitnesses {
  devices: readonly ClockWitness[];
  /** The person's device's reading: an administrator's, or with `role: "staff"` a staff member's. */
  admin: ClockAdminReading | null;
  role?: "staff";
  device?: { deviceId: string; address: string | null };
}

/** The witnesses as a confirmation's `proof` stores them. A staff member's reading is stored under
 * `staff`, with the till's id and address and no `admin` key; an administrator's on a till gets a
 * `device` key, naming the till, beside `admin`. */
function storedWitnesses(witnesses: StepWitnesses) {
  const { admin, device } = witnesses;
  const person =
    admin === null
      ? null
      : { boxAt: admin.boxAt, witnessAt: admin.witnessAt, uncertaintyMs: admin.uncertaintyMs };
  const stored = {
    devices: witnesses.devices.map((witness) => ({
      deviceId: witness.id,
      address: witness.address,
      boxAt: witness.boxAt,
      witnessAt: witness.witnessAt,
    })),
  };
  if (witnesses.role === "staff")
    return {
      ...stored,
      staff: { deviceId: device?.deviceId ?? null, address: device?.address ?? null, ...person },
    };
  return {
    ...stored,
    admin: person,
    ...(device === undefined
      ? {}
      : { device: { deviceId: device.deviceId, address: device.address } }),
  };
}

export async function confirmClockStep(
  tx: Transaction,
  input: ClockStepRequest,
): Promise<ClockStepRecorded> {
  assertPersonMatchesSource(input);
  const { admin, after, source } = input;
  const params: ErrorParams["clock.corrected"] = {
    confirmationId: null,
    source,
    person: admin.personName,
    deviceId: admin.device?.deviceId ?? null,
    device: admin.device?.deviceLabel ?? null,
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

  const personId = admin.personId;
  const confirmedAt = after.instant.toISOString();
  const { id: confirmationId, seq } = await appendHistory(tx, {
    kind: "clock.confirmed",
    nodeId: input.nodeId as NodeId,
    personId,
    at: input.before.instant,
    data: {
      confirmedAt,
      stepMs: Math.round(input.stepMs),
      source,
      reason: input.reason,
      proof: {
        ...storedWitnesses({
          devices: input.witnesses,
          admin: admin.reading,
          ...(admin.role === undefined ? {} : { role: admin.role }),
          ...(admin.device === undefined
            ? {}
            : { device: { deviceId: admin.device.deviceId, address: admin.device.address } }),
        }),
        step: {
          beforeAt: input.before.instant.toISOString(),
          afterAt: confirmedAt,
          stepMs: input.stepMs,
          targetAt: input.targetAt,
        },
      },
    },
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
      confirmedAt,
      checkId: null,
      recordId: null,
    },
  };
}

/** The latest step the box made to its clock, from the `clock.corrected` that every step over a
 * second records in its own transaction, verified or not (only a verified one writes a row). By
 * `rowid`, the order they were written: the clock is what is in doubt,
 * so no date can order them. */
export async function latestClockStep(tx: Transaction): Promise<ClockStep | null> {
  const [row] = await tx
    .select({ params: incidents.params })
    .from(incidents)
    .where(
      and(
        eq(incidents.code, "clock.corrected"),
        sql`json_extract(${incidents.params}, '$.stepMs') <> 0`,
      ),
    )
    .orderBy(sql`${incidents}.rowid desc`)
    .limit(1);
  if (row === undefined) return null;
  const { after, stepMs } = row.params as ErrorParams["clock.corrected"];
  return { confirmedAt: after, stepMs };
}
