import "./errors.js";
import { desc, eq } from "drizzle-orm";
import type { Transaction } from "@waitron/db";
import { agreeingDeviceGroup, judgeClockWitnesses } from "@waitron/fiscal";
import type {
  ClockConfirmation,
  ClockConfirmRequest,
  ClockProvedWrong,
  ClockStopState,
  ClockWitness,
} from "@waitron/fiscal";
import type { NodeId } from "@waitron/shared";
import {
  CLOCK_BEHIND_MARGIN_MS,
  chainHeads,
  clockBehindChain,
  latestRecord,
  type LatestRecord,
} from "./clock-behind.js";
import { nextConfirmationSeq, openCheck } from "./clock-checks.js";
import { recordDisproofs } from "./clock-stop-incidents.js";
import { isBeforeFirstIssueDate } from "./first-issue-date.js";
import { clockConfirmations } from "./schema/clock-confirmations.js";

export interface ClockReading {
  instant: Date;
  offsetMinutes: number;
}

interface Judged {
  latest: LatestRecord;
  gapMs: number;
  /** The stop proper holds: no confirmation covers the reading. */
  stopped: boolean;
  proof: ClockStopState["proof"];
  agreeing: ClockStopState["agreeing"];
  contrary: ClockStopState["contrary"];
}

/** Null while there is no stop: a reading before 28-10-2024, no records, or a reading not behind
 * the latest record. */
async function judge(
  tx: Transaction,
  reading: ClockReading,
  witnesses: readonly ClockWitness[],
): Promise<Judged | null> {
  if (isBeforeFirstIssueDate(reading)) return null;
  const latest = await latestRecord(tx);
  if (
    latest === undefined ||
    reading.instant.getTime() >= latest.at.getTime() - CLOCK_BEHIND_MARGIN_MS
  )
    return null;
  const gapMs = latest.at.getTime() - reading.instant.getTime();
  // Taken during this stop: the box's own clock already read more than a minute behind the latest
  // record when the witness was taken. An unreadable boxAt compares false and is left out.
  const stopBeganBeforeMs = latest.at.getTime() - CLOCK_BEHIND_MARGIN_MS;
  const verdict = judgeClockWitnesses(
    witnesses.filter((witness) => Date.parse(witness.boxAt) < stopBeganBeforeMs),
  );
  // A witness taken after the reading may describe the clock before it stepped back.
  const taken = verdict.agreeing.filter(
    (witness) => Date.parse(witness.boxAt) <= reading.instant.getTime(),
  );
  const group = new Set(agreeingDeviceGroup(taken));
  const agreeing = {
    authority: taken.find((witness) => witness.kind === "authority") ?? null,
    devices: taken.filter((witness) => group.has(witness)),
  };
  const contrary = {
    authority: verdict.authorityDisagrees[0] ?? null,
    devices: [...verdict.devicesDisagreeing],
  };
  const stopped = (await clockBehindChain(tx, reading)) !== null;
  let proof: ClockStopState["proof"];
  if (!stopped) proof = "confirmed";
  else if (contrary.authority !== null) proof = "contrary";
  else if (agreeing.authority !== null) proof = "ready";
  else if (contrary.devices.length > 0) proof = "contrary";
  else proof = agreeing.devices.length > 0 ? "ready" : "none";
  return { latest, gapMs, stopped, proof, agreeing, contrary };
}

/** The latest confirmation naming `recordId`; only read while one covers the reading, so its
 * stored time is readable. */
async function coveringConfirmation(
  tx: Transaction,
  recordId: string,
): Promise<ClockStopState["confirmation"]> {
  const [row] = await tx
    .select({
      id: clockConfirmations.id,
      source: clockConfirmations.source,
      personId: clockConfirmations.personId,
      confirmedAt: clockConfirmations.confirmedAt,
    })
    .from(clockConfirmations)
    .where(eq(clockConfirmations.registroId, recordId))
    .orderBy(desc(clockConfirmations.seq))
    .limit(1);
  return { ...row!, confirmedAt: row!.confirmedAt.toISOString() };
}

/** What the Box status page's Clock row shows; null when there is no stop or the clock reads a date
 * before 28-10-2024, which `clock.unusable` reports instead. */
export async function clockStopState(
  tx: Transaction,
  reading: ClockReading,
  witnesses: readonly ClockWitness[],
): Promise<ClockStopState | null> {
  const judged = await judge(tx, reading, witnesses);
  if (judged === null) return null;
  const { latest } = judged;
  return {
    clockAt: reading.instant.toISOString(),
    offsetMinutes: reading.offsetMinutes,
    lastRecordAt: latest.at.toISOString(),
    lastRecordOffsetMinutes: latest.offsetMinutes,
    recordId: latest.id,
    gapMs: judged.gapMs,
    proof: judged.proof,
    agreeing: judged.agreeing,
    contrary: judged.contrary,
    confirmation: judged.stopped ? null : await coveringConfirmation(tx, latest.id),
  };
}

/** The box's own confirmation of its clock while the stop proper holds and the witnesses are
 * ready: writes one `clock_confirmations` row naming the latest record and closing the open check,
 * which lifts the stop. Otherwise writes nothing and answers null. */
export async function confirmClockStop(
  tx: Transaction,
  input: ClockConfirmRequest,
): Promise<{ confirmation: ClockConfirmation | null }> {
  const judged = await judge(tx, input.reading, input.witnesses);
  if (judged === null || judged.proof !== "ready") return { confirmation: null };
  const { latest, agreeing } = judged;
  const check = await openCheck(tx);
  const source = agreeing.authority === null ? "devices" : "authority";
  const seq = await nextConfirmationSeq(tx);
  const [row] = await tx
    .insert(clockConfirmations)
    .values({
      seq,
      nodeId: input.nodeId as NodeId,
      boxClockAt: input.reading.instant,
      confirmedAt: input.reading.instant,
      stepMs: 0,
      source,
      personId: null,
      reason: check?.reason ?? "behind_chain",
      proof: {
        authority:
          agreeing.authority === null
            ? null
            : {
                boxAt: agreeing.authority.boxAt,
                witnessAt: agreeing.authority.witnessAt,
                uncertaintyMs: agreeing.authority.uncertaintyMs,
              },
        devices: agreeing.devices.map((witness) => ({
          deviceId: witness.id,
          address: witness.address,
          boxAt: witness.boxAt,
          witnessAt: witness.witnessAt,
        })),
        admin: null,
        heads: await chainHeads(tx),
      },
      checkId: check?.id ?? null,
      registroId: latest.id,
      recordAt: latest.at,
    })
    .returning({ id: clockConfirmations.id });
  return {
    confirmation: {
      id: row!.id,
      seq,
      source,
      personId: null,
      confirmedAt: input.reading.instant.toISOString(),
      checkId: check?.id ?? null,
      recordId: latest.id,
    },
  };
}

/** The clock was proved wrong after `trustedUntil`: by a jump, or by AEAT disagreeing, noticed at
 * `observedAt`. Records one `clock.behind_chain_disproved` for each restart then in force that has
 * none yet; `recorded`, `unused` (no record written under it) and `held` (another open incident
 * holds its sale) list restart ids. */
export async function noteClockProvedWrong(
  tx: Transaction,
  input: ClockProvedWrong,
): Promise<{ recorded: string[]; unused: string[]; held: string[] }> {
  return recordDisproofs(tx, input);
}
