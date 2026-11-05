import { rename } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { KeyRing } from "@waitron/credentials";
import { withNodeTransaction, type Database, type NodeDatabase } from "@waitron/db";
import {
  bindingFingerprint,
  envelopeDigest,
  parseBinding,
  verifyEnvelope,
  type SignedHandoverEnvelope,
} from "@waitron/handover";
import { canonicalize, type CanonicalValue } from "@waitron/membership";
import { appendHandoverEventTx, type HandoverOperation } from "@waitron/node-db";
import { peerKeyOf, signAsThisBox } from "./handover-signing.js";
import { advanceHandoverTx, HANDOVER_EVENT, readHandoverEnvelope } from "./handover-store.js";
import { reachDisk } from "./sync-path.js";

export interface AcceptanceBody {
  readonly binding: CanonicalValue;
  readonly indicatorDigest: string;
  readonly acceptedAtMs: number;
}

export interface RelinquishmentBody {
  readonly binding: CanonicalValue;
  readonly indicatorDigest: string;
  readonly acceptanceDigest: string;
  readonly filingAssignedTo: string;
  readonly authorisedBy: string;
}

export interface AcceptanceDeps {
  readonly node: NodeDatabase;
  readonly ring: KeyRing;
  readonly nodeId: string;
  readonly stateDir: string;
}

export function acceptedCopyPath(stateDir: string, operationId: string): string {
  return join(stateDir, "handover", operationId, "accepted.db");
}

/**
 * Keeps a compared file as the accepted copy, then records `copy_accepted` with the signed
 * acceptance. The move comes first and reaches the disk first, so the file is there when the
 * acceptance is recorded; a crash between the two leaves `prepared`, and the old box still serves
 * the copy.
 */
export async function acceptFinalCopy(
  deps: AcceptanceDeps,
  operation: HandoverOperation,
  indicator: unknown,
  copyPath: string,
): Promise<void> {
  const { operationId } = operation;
  const accepted = acceptedCopyPath(deps.stateDir, operationId);
  const envelope = indicator as SignedHandoverEnvelope<unknown>;
  const acceptance = await signAsThisBox(deps, "acceptance", {
    binding: operation.binding as CanonicalValue,
    indicatorDigest: envelopeDigest(envelope),
    acceptedAtMs: Date.now(),
  } satisfies AcceptanceBody);
  await rename(copyPath, accepted);
  await reachDisk(dirname(accepted));
  await withNodeTransaction(deps.node, async (tx) => {
    // Placing the copy needs the indicator's digest and retained selections; the file holds neither.
    await appendHandoverEventTx(tx, {
      nodeId: deps.nodeId,
      operationId,
      kind: HANDOVER_EVENT.finalState,
      detail: {},
      envelope: canonicalize(envelope as unknown as CanonicalValue),
    });
    await advanceHandoverTx(tx, deps.nodeId, operationId, "copy_accepted", {}, acceptance);
  });
}

/** The acceptance as recorded, so every post of it carries the same bytes. */
export function readStoredAcceptance(
  deps: { node: NodeDatabase; nodeId: string },
  operationId: string,
): Promise<string> {
  return readHandoverEnvelope(deps, operationId, HANDOVER_EVENT.copyAccepted);
}

/** The person the old box's offer names as having started the handover. */
export async function offeredAuthoriser(
  deps: { node: NodeDatabase; nodeId: string },
  operationId: string,
): Promise<string> {
  const offer = await readHandoverEnvelope(deps, operationId, HANDOVER_EVENT.offer);
  return (JSON.parse(offer) as { body: { authorisedBy: string } }).body.authorisedBy;
}

export function isOperationsBinding(raw: unknown, operation: HandoverOperation): boolean {
  try {
    return bindingFingerprint(parseBinding(raw)) === operation.fingerprint;
  } catch {
    return false;
  }
}

/** `answer` as a relinquishment of exactly what `acceptanceText` accepted, or `null`. */
export async function verifiedRelinquishment(
  deps: { db: Database; node: NodeDatabase; ring: KeyRing; nodeId: string },
  operation: HandoverOperation,
  acceptanceText: string,
  answer: string,
): Promise<SignedHandoverEnvelope<RelinquishmentBody> | null> {
  let raw: unknown;
  try {
    raw = JSON.parse(answer);
  } catch {
    return null;
  }
  const verdict = verifyEnvelope<RelinquishmentBody | null>(
    raw,
    "relinquishment",
    await peerKeyOf(deps),
  );
  if (!verdict.valid || verdict.signerNodeId !== operation.sourceNodeId) return null;
  const { body } = verdict;
  const acceptance = JSON.parse(acceptanceText) as SignedHandoverEnvelope<AcceptanceBody>;
  return body !== null &&
    isOperationsBinding(body.binding, operation) &&
    body.indicatorDigest === acceptance.body.indicatorDigest &&
    body.acceptanceDigest === envelopeDigest(acceptance) &&
    body.filingAssignedTo === deps.nodeId &&
    body.authorisedBy === (await offeredAuthoriser(deps, operation.operationId))
    ? (raw as SignedHandoverEnvelope<RelinquishmentBody>)
    : null;
}
