import "./errors.js";
import { desc, eq } from "drizzle-orm";
import type { Transaction } from "@waitron/db";
import { CLOCK_WITNESS_MARGIN_MS, judgeClockWitnesses } from "@waitron/fiscal";
import type {
  ClockAdminConfirm,
  ClockAdminReading,
  ClockConfirmation,
  ClockConfirmRequest,
  ClockProvedWrong,
  ClockStopState,
  ClockWitness,
} from "@waitron/fiscal";
import { AppError } from "@waitron/shared";
import type { NodeId } from "@waitron/shared";
import {
  CLOCK_BEHIND_MARGIN_MS,
  chainHeads,
  clockBehindChain,
  latestRecord,
  type LatestRecord,
} from "./clock-behind.js";
import {
  closingProof,
  judgeAfterStopEnded,
  nextConfirmationSeq,
  openCheck,
  openClockCheck,
  witnessProof,
  storedWitnesses,
  takenDuringStop,
  waitingCheck,
  writeClosing,
} from "./clock-checks.js";
import { recordDisproofs, recordMisdated, recordRestarted } from "./clock-stop-incidents.js";
import { isBeforeFirstIssueDate, refuseBeforeFirstIssueDate } from "./first-issue-date.js";
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
  const verdict = judgeClockWitnesses(takenDuringStop(witnesses, latest));
  // A witness taken after the reading may describe the clock before it stepped back.
  const taken = verdict.agreeing.filter(
    (witness) => Date.parse(witness.boxAt) <= reading.instant.getTime(),
  );
  const { agreeing, contrary } = witnessProof(taken, verdict);
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

function refuse(reason: "not_stopped" | "contrary_proof" | "differs"): never {
  throw new AppError("clock.confirm_refused", { reason });
}

function adminAgrees(reading: ClockAdminReading): boolean {
  if (!(reading.uncertaintyMs >= 0)) return false;
  const differenceMs = Math.abs(Date.parse(reading.witnessAt) - Date.parse(reading.boxAt));
  // An unreadable time compares false, so it does not agree.
  return differenceMs + reading.uncertaintyMs <= CLOCK_WITNESS_MARGIN_MS;
}

/** The administrator's confirmation of a check that waits: refused `not_stopped` with none,
 * `contrary_proof` when AEAT, or a group of devices from two addresses, taken after the stop ended
 * disagrees, and `differs` when the administrator's device does not agree with the box. */
async function closeWaitingAsAdmin(
  tx: Transaction,
  input: ClockConfirmRequest,
  admin: ClockAdminConfirm,
): Promise<{ confirmation: ClockConfirmation }> {
  const waiting = await waitingCheck(tx, input.reading);
  if (waiting === null) refuse("not_stopped");
  const { agreeing, contrary } = judgeAfterStopEnded(input.witnesses, waiting.latest);
  if (contrary.authority !== null || contrary.devices.length > 0) refuse("contrary_proof");
  if (!adminAgrees(admin.reading)) refuse("differs");
  const confirmation = await writeClosing(tx, {
    check: waiting.check,
    reading: input.reading,
    boot: input.boot,
    nodeId: input.nodeId,
    source: "admin",
    personId: admin.personId,
    witnesses: { ...agreeing, admin: admin.reading },
    unconfirmed: false,
  });
  return { confirmation };
}

/** Confirms the box's clock while the stop proper holds, writing one `clock_confirmations` row
 * naming the latest record and closing this stop's check, which lifts the stop, and records
 * `clock.behind_chain_restarted` and, through `recordMisdated`, `clock.records_misdated` beside it.
 * This stop's check is the one the watch's look answers: the open check, or one opened now (after
 * closing an open check whose stop came back), whose closing is then `partial`. With no `admin`, only
 * when the witnesses are ready; otherwise it writes nothing and answers null. With `admin`, on the
 * administrator's device, refused `contrary_proof` when AEAT, or a group of devices from two
 * addresses, taken during the stop disagrees, and `differs` when that device does not agree with
 * the box. A refusal throws `clock.confirm_refused`, and a reading before 28-10-2024
 * `clock.unusable`, writing nothing. With `admin` and no stop, it closes a check that waits instead. */
export async function confirmClockStop(
  tx: Transaction,
  input: ClockConfirmRequest,
): Promise<{ confirmation: ClockConfirmation | null }> {
  const { admin } = input;
  if (admin !== undefined) refuseBeforeFirstIssueDate(input.reading);
  const judged = await judge(tx, input.reading, input.witnesses);
  if (admin === undefined) {
    if (judged === null || judged.proof !== "ready") return { confirmation: null };
  } else {
    if (judged === null || !judged.stopped) return closeWaitingAsAdmin(tx, input, admin);
    if (judged.contrary.authority !== null || judged.contrary.devices.length > 0)
      refuse("contrary_proof");
    if (!adminAgrees(admin.reading)) refuse("differs");
  }
  const { latest, agreeing } = judged;
  const existing = await openCheck(tx);
  // Every closing needs an opening's heads to bound its list, and a check whose stop came back
  // while it waited is not this stop's: the watch's own look closes it and opens one.
  const opened = (await openClockCheck(tx, {
    reading: input.reading,
    boot: input.boot,
    nodeId: input.nodeId,
  }))!;
  const openedNow = existing?.id !== opened.id;
  // The stop proper holds, so the check just answered is open.
  const check = openedNow ? (await openCheck(tx))! : existing!;
  const closing = closingProof(check, input.reading.instant, input.boot, {
    unconfirmed: false,
    openedNow,
  });
  const source =
    admin !== undefined ? "admin" : agreeing.authority === null ? "devices" : "authority";
  const personId = admin?.personId ?? null;
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
      personId,
      reason: check.reason,
      proof: {
        ...storedWitnesses({
          ...agreeing,
          admin: admin === undefined ? null : admin.reading,
        }),
        heads: await chainHeads(tx),
        closing,
      },
      checkId: check.id,
      registroId: latest.id,
      recordAt: latest.at,
    })
    .returning({ id: clockConfirmations.id });
  await recordRestarted(tx, {
    recordId: latest.id,
    detectedAt: input.reading.instant,
    params: {
      confirmationId: row!.id,
      confirmedBy: source,
      person: admin?.personName ?? null,
      clockAt: input.reading.instant.toISOString(),
      lastRecordAt: latest.at.toISOString(),
    },
  });
  await recordMisdated(tx, {
    confirmationId: row!.id,
    check,
    partial: closing.partial,
    reading: input.reading,
  });
  return {
    confirmation: {
      id: row!.id,
      seq,
      source,
      personId,
      confirmedAt: input.reading.instant.toISOString(),
      checkId: check.id,
      recordId: latest.id,
    },
  };
}

/** The clock was proved wrong after `trustedUntil`: by a jump, or by AEAT disagreeing, noticed at
 * `observedAt`. Records one `clock.behind_chain_disproved` for each lift then in force that has
 * none yet; `recorded`, `unused` (no record written under it) and `held` (another open incident
 * holds its sale) list the lifts' confirmation ids. */
export async function noteClockProvedWrong(
  tx: Transaction,
  input: ClockProvedWrong,
): Promise<{ recorded: string[]; unused: string[]; held: string[] }> {
  return recordDisproofs(tx, input);
}
