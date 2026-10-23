import "./errors.js";
import { eq, sql } from "drizzle-orm";
import { newId } from "@waitron/db";
import type { Transaction } from "@waitron/db";
import { judgeClockWitnesses } from "@waitron/fiscal";
import type {
  ClockRestart,
  ClockRestartOffer,
  ClockRestartProofKind,
  ClockStopState,
  ClockWitness,
} from "@waitron/fiscal";
import { AppError } from "@waitron/shared";
import type { ErrorParams, NodeId } from "@waitron/shared";
import {
  CLOCK_BEHIND_MARGIN_MS,
  chainHeads,
  clockBehindChain,
  latestRecord,
  type LatestRecord,
} from "./clock-behind.js";
import { recordDisproofs, recordRestarted } from "./clock-stop-incidents.js";
import { isBeforeFirstIssueDate, refuseBeforeFirstIssueDate } from "./first-issue-date.js";
import { clockStopRestarts } from "./schema/clock-stop-restarts.js";

/** No restart is offered for a gap wider than this. */
const RESTART_MAX_GAP_MS = 86_400_000;

export interface ClockReading {
  instant: Date;
  offsetMinutes: number;
}

interface StoredRestart {
  id: string;
  personId: string;
  restartedAt: string;
  clockAt: string;
  recordAt: string;
  proof: string;
}

interface Judged {
  latest: LatestRecord;
  gapMs: number;
  stored: StoredRestart | undefined;
  offer: ClockRestartOffer;
  proof: ClockStopState["proof"];
  contrary: ClockStopState["contrary"];
}

/** Stored times are read as text, so an unreadable one is shown as stored rather than throwing. */
async function restartNaming(
  tx: Transaction,
  recordId: string,
): Promise<StoredRestart | undefined> {
  const [row] = await tx
    .select({
      id: clockStopRestarts.id,
      personId: clockStopRestarts.personId,
      restartedAt: sql<string>`${clockStopRestarts.restartedAt}`,
      clockAt: sql<string>`${clockStopRestarts.clockAt}`,
      recordAt: sql<string>`${clockStopRestarts.recordAt}`,
      proof: sql<string>`${clockStopRestarts.proof}`,
    })
    .from(clockStopRestarts)
    .where(eq(clockStopRestarts.registroId, recordId));
  return row;
}

/** Null while there is no stop: no records, or the reading is not behind the latest one. */
async function judge(
  tx: Transaction,
  reading: ClockReading,
  witnesses: readonly ClockWitness[],
): Promise<Judged | null> {
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
  const agreeing = verdict.agreeing.filter(
    (witness) => Date.parse(witness.boxAt) <= reading.instant.getTime(),
  );
  const agreeingDevices = agreeing.filter((witness) => witness.kind === "device");
  const proof = {
    authority: agreeing.find((witness) => witness.kind === "authority") ?? null,
    devices: agreeingDevices.length >= 2 ? [...agreeingDevices] : [],
  };
  const contrary = {
    authority: verdict.authorityDisagrees[0] ?? null,
    devices: [...verdict.devicesDisagreeing],
  };
  const stored = await restartNaming(tx, latest.id);
  let offer: ClockRestartOffer;
  if (stored !== undefined) {
    offer = (await clockBehindChain(tx, reading)) === null ? "restarted" : "stepped_back";
  } else if (gapMs > RESTART_MAX_GAP_MS) {
    offer = "too_far";
  } else if (contrary.authority !== null || contrary.devices.length > 0) {
    offer = "contrary_proof";
  } else if (proof.authority === null && proof.devices.length === 0) {
    offer = "no_proof";
  } else {
    offer = "offered";
  }
  return { latest, gapMs, stored, offer, proof, contrary };
}

/** What the Box status page's Clock row shows; null when there is no stop or the clock reads a date
 * before 28-10-2024, which `clock.unusable` reports instead. */
export async function clockStopState(
  tx: Transaction,
  reading: ClockReading,
  witnesses: readonly ClockWitness[],
): Promise<ClockStopState | null> {
  if (isBeforeFirstIssueDate(reading)) return null;
  const judged = await judge(tx, reading, witnesses);
  if (judged === null) return null;
  const { latest, stored } = judged;
  return {
    clockAt: reading.instant.toISOString(),
    offsetMinutes: reading.offsetMinutes,
    lastRecordAt: latest.at.toISOString(),
    lastRecordOffsetMinutes: latest.offsetMinutes,
    recordId: latest.id,
    gapMs: judged.gapMs,
    restart:
      stored === undefined
        ? null
        : { personId: stored.personId, restartedAt: stored.restartedAt, clockAt: stored.clockAt },
    offer: judged.offer,
    proof: judged.proof,
    contrary: judged.contrary,
  };
}

function kindOf(proof: { authority: unknown; devices: readonly unknown[] }): ClockRestartProofKind {
  if (proof.authority === null) return "devices";
  return proof.devices.length > 0 ? "authority_and_devices" : "authority";
}

/** The kind a stored proof names. Only read for a restart that covers, whose proof parsed. */
function storedKind(text: string): ClockRestartProofKind {
  const proof = JSON.parse(text) as { authority?: unknown; devices?: unknown };
  return kindOf({
    authority: typeof proof.authority === "object" ? proof.authority : null,
    devices: Array.isArray(proof.devices) ? proof.devices : [],
  });
}

function refuse(params: ErrorParams["clock.restart_refused"]): never {
  throw new AppError("clock.restart_refused", params);
}

/** A manager's restart of payments while the clock reads behind the latest record. Refuses
 * `clock.unusable` for a reading before 28-10-2024, else `clock.restart_refused` unless the Clock
 * row would offer it; a press on a record a restart already names and covers answers that
 * restart. A new restart records its `clock.behind_chain_restarted` alert in `tx`. */
export async function restartAfterClockStop(
  tx: Transaction,
  input: {
    reading: ClockReading;
    witnesses: readonly ClockWitness[];
    personId: string;
    // For the alert's words; `clock_stop_restarts` keeps only the id.
    personName: string;
    nodeId: string;
    recordId: string;
  },
): Promise<{ restart: ClockRestart; replayed: boolean }> {
  refuseBeforeFirstIssueDate(input.reading);
  const judged = await judge(tx, input.reading, input.witnesses);
  if (judged === null) refuse({ reason: "not_stopped" });
  const { latest, stored, offer, proof } = judged;
  if (input.recordId !== latest.id) refuse({ reason: "record_changed" });
  if (stored !== undefined) {
    if (offer !== "restarted") {
      refuse({
        reason: "stepped_back",
        personId: stored.personId,
        restartedAt: stored.restartedAt,
      });
    }
    return {
      restart: {
        id: stored.id,
        personId: stored.personId,
        restartedAt: stored.restartedAt,
        clockAt: stored.clockAt,
        lastRecordAt: stored.recordAt,
        proofKind: storedKind(stored.proof),
      },
      replayed: true,
    };
  }
  if (offer !== "offered") refuse({ reason: offer as "too_far" | "contrary_proof" | "no_proof" });
  const id = newId();
  await tx.insert(clockStopRestarts).values({
    id,
    nodeId: input.nodeId as NodeId,
    personId: input.personId,
    restartedAt: input.reading.instant,
    clockAt: input.reading.instant,
    registroId: latest.id,
    recordAt: latest.at,
    proof: {
      authority:
        proof.authority === null
          ? null
          : {
              boxAt: proof.authority.boxAt,
              witnessAt: proof.authority.witnessAt,
              uncertaintyMs: proof.authority.uncertaintyMs,
            },
      devices: proof.devices.map((witness) => ({
        deviceId: witness.id,
        boxAt: witness.boxAt,
        witnessAt: witness.witnessAt,
      })),
      heads: await chainHeads(tx),
    },
  });
  const restart: ClockRestart = {
    id,
    personId: input.personId,
    restartedAt: input.reading.instant.toISOString(),
    clockAt: input.reading.instant.toISOString(),
    lastRecordAt: latest.at.toISOString(),
    proofKind: kindOf(proof),
  };
  await recordRestarted(tx, {
    recordId: latest.id,
    detectedAt: input.reading.instant,
    params: {
      restartId: id,
      person: input.personName,
      clockAt: restart.clockAt,
      lastRecordAt: restart.lastRecordAt,
      proof: restart.proofKind,
    },
  });
  return { restart, replayed: false };
}

/** The clock was proved wrong after `trustedUntil`: by a jump, or by AEAT disagreeing, noticed at
 * `observedAt`. Records one `clock.behind_chain_disproved` for each restart then in force that has
 * none yet; `recorded`, `unused` (no record written under it) and `held` (another open incident
 * holds its sale) list restart ids. */
export async function noteClockProvedWrong(
  tx: Transaction,
  input: { trustedUntil: Date; observedAt: Date; reason: "jump" | "authority" },
): Promise<{ recorded: string[]; unused: string[]; held: string[] }> {
  return recordDisproofs(tx, input);
}
