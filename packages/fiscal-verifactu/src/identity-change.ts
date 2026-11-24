import { randomUUID } from "node:crypto";
import { readTaxpayer, withTransaction, type Database, type Transaction } from "@waitron/db";
import type { IdentityChangeNote, IdentityChangeOutcome, SecondClock } from "@waitron/fiscal";
import { AppError, type NodeId } from "@waitron/shared";
import { withHourAdmission } from "./allocation-envelope.js";
import {
  activatePreparedModuleAllocation,
  createAllocationPreparation,
} from "./allocation-preparation.js";
import {
  boxClockSample,
  canSelectHour,
  clockRefusal,
  compareHourClocks,
  wallClockStepped,
} from "./hour-clock.js";
import { observeTimeServiceHourClock } from "./hour-clock-time-service.js";
import { readHourHistory } from "./hour-history-reader.js";
import { projectHourHistory } from "./hour-history.js";
import { encodeMinuteIdentity, EPOCH_MS, MINUTE_MS } from "./hour-identity.js";
import { readHourRelease } from "./hour-release.js";
import { withIdentityChangeAuthority } from "./identity-change-authority.js";
import { notedForRunning, readHeadProducer } from "./producer-change.js";
import { liveSeriesBases } from "./reserved-series.js";
import { WAITRON_ID_SISTEMA } from "./software.js";
import { PRODUCER_PENDING, type SoftwareIdentity } from "./software-identity.js";
import "./errors.js";

/** The producer and environment a backend files under. */
interface Filing {
  identity: SoftwareIdentity;
  environment: string;
}

type IdentityChangePlan =
  | { kind: "nothing-to-open" | "not-named" }
  | {
      kind: "open";
      minuteMs: number;
      sourceSifId: string;
      /** The box's clock reading the minute was taken from. */
      sampledAt: { wallMs: number; monotonicMs: number };
    };

function waiting(reason: string): never {
  throw new AppError("sif.identity_change_waiting", { reason });
}

/**
 * Whether `nodeId`'s open chain, filed under the producer `note` moves from, should open a new
 * installation for the producer `filing` names, and on which minute. The head is read before any
 * clock so a box with nothing to open never waits on one.
 */
export async function planIdentityChange(
  db: Database,
  filing: Filing,
  nodeId: NodeId,
  note: IdentityChangeNote,
  secondClock: SecondClock,
): Promise<IdentityChangePlan> {
  const producer = filing.identity.producer;
  if (typeof producer === "object" && "invalid" in producer) throw producer.invalid;
  if (producer === PRODUCER_PENDING || !notedForRunning(note, producer.nif))
    return { kind: "not-named" };
  const { environment } = filing;
  if (environment !== "production") return { kind: "nothing-to-open" };

  const head = await withTransaction(db, (tx) => readHeadProducer(tx, nodeId));
  if (head === null || head.nif === producer.nif) return { kind: "nothing-to-open" };
  if (head.nif !== note.fromProducerTaxId) return { kind: "not-named" };

  const releaseMs = readHourRelease()?.instantMs ?? null;
  let decision;
  let box;
  if (secondClock.kind === "time-service") {
    const internet = await observeTimeServiceHourClock(secondClock.read);
    box = boxClockSample();
    decision = compareHourClocks([internet, box], releaseMs);
  } else {
    if (!secondClock.standing()) waiting("confirmation_stale");
    box = boxClockSample();
    decision = compareHourClocks([box], releaseMs, { boxClockAlone: true });
  }
  if (!canSelectHour(decision)) waiting(clockRefusal(decision));
  const nowMs = decision.usable.find((sample) => sample.source === "box")!.lowerMs;

  const history = await withTransaction(db, async (tx) =>
    projectHourHistory({
      scope: { taxpayerNif: (await readTaxpayer(tx))?.taxId, environment },
      sources: [await readHourHistory(tx, environment)],
    }),
  );
  if (history.contradictions.length > 0) waiting("history_invalid");
  const minute = Math.floor((nowMs - EPOCH_MS) / MINUTE_MS);
  if (history.usedMinutes.includes(minute)) waiting("minute_in_use");
  return {
    kind: "open",
    minuteMs: EPOCH_MS + minute * MINUTE_MS,
    sourceSifId: head.sifId,
    sampledAt: { wallMs: box.wallFinishedMs, monotonicMs: box.monotonicFinishedMs },
  };
}

/**
 * Opens the installation `planIdentityChange` plans, on the planned minute, closing the open one
 * and its series. `mayOpen` is the host's check that this box alone serves as primary.
 */
export async function openIdentityChange(
  db: Database,
  filing: Filing,
  nodeId: NodeId,
  note: IdentityChangeNote,
  secondClock: SecondClock,
  mayOpen: (tx: Transaction) => Promise<boolean>,
): Promise<IdentityChangeOutcome> {
  const plan = await planIdentityChange(db, filing, nodeId, note, secondClock);
  if (plan.kind !== "open") return plan.kind;
  // A commented decision (A993 decision 10): the plan reads the time service, which can take
  // seconds, outside the write lock. This transaction asks `mayOpen`, then checks that a confirmed
  // start's time still stands, that the box's clock has not stepped since the plan read it, and
  // that the open installation is still the plan's; the activation refuses a name already in
  // `verifactu_identities`.
  await withTransaction(db, async (tx) => {
    if (!(await mayOpen(tx))) waiting("not_sole_primary");
    if (secondClock.kind === "confirmed-start" && !secondClock.standing())
      waiting("confirmation_stale");
    const box = boxClockSample();
    if (
      wallClockStepped(plan.sampledAt, {
        wallMs: box.wallFinishedMs,
        monotonicMs: box.monotonicFinishedMs,
      })
    )
      waiting("clock_corrected");
    const head = await readHeadProducer(tx, nodeId);
    if (head?.sifId !== plan.sourceSifId) waiting("head_moved");
    const identity = encodeMinuteIdentity(plan.minuteMs);
    const issuedAt = new Date(plan.minuteMs).toISOString();
    const bases = await liveSeriesBases(tx, { nodeId });
    const eventId = randomUUID();
    const binding = {
      module: "fiscal-verifactu",
      action: "identity-change",
      eventId,
      sourceId: plan.sourceSifId,
      targetNodeId: nodeId,
    };
    await withIdentityChangeAuthority(binding, note.release, async (authority) => {
      const operation = {
        binding,
        authority,
        input: {
          allocation: {
            version: 1,
            allocationId: `identity-change/${eventId}`,
            taxpayerNif: (await readTaxpayer(tx))?.taxId,
            softwareId: WAITRON_ID_SISTEMA,
            environment: "production",
            installationIdentity: identity,
            series: bases.map(({ code, purpose }) => ({ code: `${code}-${identity}`, purpose })),
            source: "hour",
            reservationEvidence: null,
            issuedAt,
          },
          approval: {
            version: 2,
            eventId,
            operatorId: `identity-change:${note.release}`,
            sourceId: plan.sourceSifId,
            targetNodeId: nodeId,
            oldMachineOffline: false,
            oldMachineAbsent: false,
            oldMachineRelinquished: true,
            noParallelRecovery: true,
            confirmedAt: issuedAt,
            incidentEvidence: `identity-change/${eventId}`,
          },
        },
      };
      return withHourAdmission(
        operation,
        { requiredBases: bases, priorActivation: "none", oldMachineRelinquished: true },
        (evidence) =>
          createAllocationPreparation(async (scope) => ({ ...scope, evidence })).prepare(
            operation,
            (prepared) => activatePreparedModuleAllocation(tx, { nodeId }, prepared),
          ),
      );
    });
  });
  return "opened";
}
