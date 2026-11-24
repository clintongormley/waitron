import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import {
  readDeploymentEnvironment,
  readTaxpayer,
  withTransaction,
  type Database,
  type Transaction,
} from "@waitron/db";
import type { IdentityChangeNote, SecondClock } from "@waitron/fiscal";
import { AppError, type NodeId } from "@waitron/shared";
import type { SistemaInformatico } from "@waitron/verifactu";
import { withHourAdmission } from "./allocation-envelope.js";
import {
  activatePreparedModuleAllocation,
  createAllocationPreparation,
} from "./allocation-preparation.js";
import { readChainHead } from "./chain.js";
import { boxClockSample, canSelectHour, clockRefusal, compareHourClocks } from "./hour-clock.js";
import { observeTimeServiceHourClock } from "./hour-clock-time-service.js";
import { readHourHistory } from "./hour-history-reader.js";
import { projectHourHistory } from "./hour-history.js";
import { encodeMinuteIdentity, EPOCH_MS, MINUTE_MS } from "./hour-identity.js";
import { readHourRelease } from "./hour-release.js";
import { withIdentityChangeAuthority } from "./identity-change-authority.js";
import { currentSif } from "./registro-sif.js";
import { liveSeriesBases } from "./reserved-series.js";
import { verifactuRecords } from "./schema/verifactu-records.js";
import { WAITRON_ID_SISTEMA } from "./software.js";
import { runningProducer, softwareVersion } from "./software-identity.js";
import "./errors.js";

export type IdentityChangePlan =
  | { kind: "nothing-to-open" | "not-named" }
  | { kind: "open"; minuteMs: number; sourceSifId: string };

function waiting(reason: string): never {
  throw new AppError("sif.identity_change_waiting", { reason });
}

const boxSample = () => boxClockSample(Date.now, () => performance.now());

async function readHead(tx: Transaction, nodeId: NodeId) {
  const { ultimoRegistroId } = await readChainHead(tx, nodeId);
  if (ultimoRegistroId === null) return null;
  const [record] = await tx
    .select({ software: verifactuRecords.sistemaInformatico })
    .from(verifactuRecords)
    .where(eq(verifactuRecords.id, ultimoRegistroId));
  return {
    nif: (record!.software as SistemaInformatico).NIF,
    sifId: (await currentSif(tx, nodeId)).id,
  };
}

/**
 * Whether `nodeId`'s open chain, filed under the producer `note` moves from, should open a new
 * installation for the running producer, and on which minute. Reads only; the head is read before
 * any clock so a box with nothing to open never waits on one.
 */
export async function planIdentityChange(
  db: Database,
  nodeId: NodeId,
  note: IdentityChangeNote,
  secondClock: SecondClock,
): Promise<IdentityChangePlan> {
  const producer = runningProducer();
  const producerTaxId = typeof producer === "object" && "nif" in producer ? producer.nif : null;
  if (note.release !== softwareVersion() || note.producerTaxId !== producerTaxId)
    return { kind: "not-named" };
  const environment = await readDeploymentEnvironment(db);
  if (environment !== "production") return { kind: "nothing-to-open" };

  const head = await withTransaction(db, (tx) => readHead(tx, nodeId));
  if (head === null || head.nif === producerTaxId) return { kind: "nothing-to-open" };
  if (head.nif !== note.fromProducerTaxId) return { kind: "not-named" };

  const releaseMs = readHourRelease()?.instantMs ?? null;
  let decision;
  if (secondClock.kind === "time-service") {
    const internet = await observeTimeServiceHourClock(secondClock.read);
    decision = compareHourClocks([internet, boxSample()], releaseMs);
  } else {
    if (!secondClock.standing()) waiting("confirmation_stale");
    decision = compareHourClocks([boxSample()], releaseMs, { boxClockAlone: true });
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
  return { kind: "open", minuteMs: EPOCH_MS + minute * MINUTE_MS, sourceSifId: head.sifId };
}

/**
 * Opens the installation `planIdentityChange` plans, on the planned minute, closing the open one
 * and its series. `mayOpen` is the host's check that this box alone serves as primary.
 */
export async function openIdentityChange(
  db: Database,
  nodeId: NodeId,
  note: IdentityChangeNote,
  secondClock: SecondClock,
  mayOpen: (tx: Transaction) => Promise<boolean>,
): Promise<"opened" | "nothing-to-open" | "not-named"> {
  const plan = await planIdentityChange(db, nodeId, note, secondClock);
  if (plan.kind !== "open") return plan.kind;
  // A commented decision (A993 decision 10): the plan reads the time service, which can take
  // seconds, outside the write lock; this transaction repeats its head read, and the activation's
  // used-name refusal catches a minute taken in between.
  await withTransaction(db, async (tx) => {
    if (!(await mayOpen(tx))) waiting("not_sole_primary");
    const head = await readHead(tx, nodeId);
    if (head?.sifId !== plan.sourceSifId || head.nif !== note.fromProducerTaxId)
      waiting("head_moved");
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
