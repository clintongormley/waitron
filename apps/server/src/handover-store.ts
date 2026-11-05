import { canonicalize, type CanonicalValue } from "@waitron/membership";
import { withNodeTransaction, type NodeDatabase, type NodeTransaction } from "@waitron/db";
import {
  bindingFingerprint,
  initialState,
  nextState,
  type HandoverBinding,
  type HandoverRole,
  type HandoverState,
  type SignedHandoverEnvelope,
} from "@waitron/handover";
import {
  advanceHandoverOperationTx,
  appendHandoverEventTx,
  beginHandoverOperationTx,
  readHandoverOperation,
} from "@waitron/node-db";
import { AppError, type ErrorCode } from "@waitron/shared";
import "./errors.js";

export interface HandoverStoreDeps {
  readonly node: NodeDatabase;
  readonly nodeId: string;
}

/** Why a source operation closed, and so what a repeat of its start request answers. */
export interface HandoverRefusal {
  readonly code: ErrorCode;
  readonly params: Readonly<Record<string, string>>;
}

function beginTx(
  tx: NodeTransaction,
  nodeId: string,
  binding: HandoverBinding,
  role: HandoverRole,
): Promise<"created" | "replayed"> {
  return beginHandoverOperationTx(tx, {
    nodeId,
    operationId: binding.operationId,
    role,
    scenario: binding.scenario,
    sourceNodeId: binding.sourceNodeId,
    destinationNodeId: binding.destinationNodeId,
    binding: binding as unknown as Readonly<Record<string, unknown>>,
    fingerprint: bindingFingerprint(binding),
    state: initialState(role, binding.scenario),
    waitingReason: null,
  });
}

export function beginHandover(
  deps: HandoverStoreDeps,
  binding: HandoverBinding,
  role: HandoverRole,
): Promise<"created" | "replayed"> {
  return withNodeTransaction(deps.node, (tx) => beginTx(tx, deps.nodeId, binding, role));
}

/** `beginHandover` that also records, in the same transaction, the offer the operation began with. */
export function beginHandoverFromOffer(
  deps: HandoverStoreDeps,
  binding: HandoverBinding,
  role: HandoverRole,
  offer: SignedHandoverEnvelope<unknown>,
): Promise<"created" | "replayed"> {
  return withNodeTransaction(deps.node, async (tx) => {
    const outcome = await beginTx(tx, deps.nodeId, binding, role);
    if (outcome === "created") {
      await appendHandoverEventTx(tx, {
        nodeId: deps.nodeId,
        operationId: binding.operationId,
        kind: "offer",
        detail: {},
        envelope: canonicalize(offer as unknown as CanonicalValue),
      });
    }
    return outcome;
  });
}

/** Writes node.db only, never venue.db. Moving to the state already held records nothing. */
export function advanceHandover(
  deps: HandoverStoreDeps,
  operationId: string,
  to: HandoverState,
  detail: CanonicalValue,
  envelope?: SignedHandoverEnvelope<unknown>,
): Promise<void> {
  return withNodeTransaction(deps.node, (tx) =>
    advanceHandoverTx(tx, deps.nodeId, operationId, to, detail, envelope),
  );
}

/** `advanceHandover` inside a node transaction the caller holds. */
export async function advanceHandoverTx(
  tx: NodeTransaction,
  nodeId: string,
  operationId: string,
  to: HandoverState,
  detail: CanonicalValue,
  envelope?: SignedHandoverEnvelope<unknown>,
): Promise<void> {
  const row = await readHandoverOperation(tx, nodeId, operationId);
  if (row === null) throw new AppError("handover.step_out_of_order", { from: null, to });
  if (row.state === to) return;
  nextState(row.role, row.scenario, row.state, to);
  await appendHandoverEventTx(tx, {
    nodeId,
    operationId,
    kind: to,
    detail: detail as Readonly<Record<string, unknown>>,
    envelope: envelope === undefined ? null : canonicalize(envelope as unknown as CanonicalValue),
  });
  await advanceHandoverOperationTx(tx, nodeId, operationId, to, null);
}

/** Closes a source operation that never stepped down, storing the refusal a repeat answers. */
export function abandonHandover(
  deps: HandoverStoreDeps,
  operationId: string,
  refusal: HandoverRefusal,
): Promise<void> {
  return advanceHandover(deps, operationId, "abandoned", {
    code: refusal.code,
    params: { ...refusal.params },
  });
}

/** The refusal `abandonHandover` stored as an event's detail. */
export function storedRefusal(detail: Readonly<Record<string, unknown>>): HandoverRefusal {
  const { code, params } = detail;
  // A fault in Waitron: `abandonHandover` is the only writer of a source's `abandoned`.
  if (typeof code !== "string" || typeof params !== "object" || params === null) {
    throw new Error("a stored handover refusal has no code or params");
  }
  return { code: code as ErrorCode, params: params as Record<string, string> };
}

/** Records why this box is waiting at its current step, or with `null` that it no longer is. */
export function waitHandover(
  deps: HandoverStoreDeps,
  operationId: string,
  reason: ErrorCode | null,
): Promise<void> {
  return withNodeTransaction(deps.node, (tx) =>
    waitHandoverTx(tx, deps.nodeId, operationId, reason),
  );
}

/** `waitHandover` inside a node transaction the caller holds. */
export async function waitHandoverTx(
  tx: NodeTransaction,
  nodeId: string,
  operationId: string,
  reason: ErrorCode | null,
): Promise<void> {
  const row = await readHandoverOperation(tx, nodeId, operationId);
  // A fault in Waitron: a box waits only at a step it has recorded.
  if (row === null) throw new Error(`no handover operation ${operationId} to wait on`);
  await advanceHandoverOperationTx(tx, nodeId, operationId, row.state, reason);
}
