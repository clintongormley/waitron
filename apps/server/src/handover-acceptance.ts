import { open, rename } from "node:fs/promises";
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
import { appendHandoverEventTx, readHandoverEvent, type HandoverOperation } from "@waitron/node-db";
import { FINAL_STATE_EVENT } from "./handover-capture.js";
import { peerKeyOf, signAsThisBox } from "./handover-signing.js";
import { advanceHandoverTx } from "./handover-store.js";

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
 * acceptance. The move comes first and reaches the disk first, so a recorded acceptance always has
 * its file; a crash between the two leaves `prepared`, and the old box still serves the copy.
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
  const folder = await open(dirname(accepted), "r");
  try {
    await folder.sync();
  } finally {
    await folder.close();
  }
  await withNodeTransaction(deps.node, async (tx) => {
    // Placing the copy needs the indicator's digest and retained selections; the file holds neither.
    await appendHandoverEventTx(tx, {
      nodeId: deps.nodeId,
      operationId,
      kind: FINAL_STATE_EVENT,
      detail: {},
      envelope: canonicalize(envelope as unknown as CanonicalValue),
    });
    await advanceHandoverTx(tx, deps.nodeId, operationId, "copy_accepted", {}, acceptance);
  });
}

/** The acceptance as recorded, so every post of it carries the same bytes. */
export async function readStoredAcceptance(
  deps: { node: NodeDatabase; nodeId: string },
  operationId: string,
): Promise<string> {
  const row = await readHandoverEvent(deps.node, deps.nodeId, operationId, "copy_accepted");
  // A fault in Waitron: `acceptFinalCopy` records the state and its acceptance together.
  if (row?.envelope == null) throw new Error(`the acceptance of ${operationId} is not stored`);
  return row.envelope;
}

/** The person the old box's offer names as having started the handover. */
export async function offeredAuthoriser(
  deps: { node: NodeDatabase; nodeId: string },
  operationId: string,
): Promise<string> {
  const offer = await readHandoverEvent(deps.node, deps.nodeId, operationId, "offer");
  // A fault in Waitron: the offer route stores the offer in the transaction that begins the row.
  if (offer?.envelope == null) throw new Error(`the offer of ${operationId} is not stored`);
  return (JSON.parse(offer.envelope) as { body: { authorisedBy: string } }).body.authorisedBy;
}

function isOperationsBinding(raw: unknown, operation: HandoverOperation): boolean {
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
