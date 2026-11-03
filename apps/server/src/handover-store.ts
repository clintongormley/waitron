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

export function beginHandover(
  deps: HandoverStoreDeps,
  binding: HandoverBinding,
  role: HandoverRole,
): Promise<"created" | "replayed"> {
  const state = initialState(role, binding.scenario);
  return withNodeTransaction(deps.node, (tx) =>
    beginHandoverOperationTx(tx, {
      nodeId: deps.nodeId,
      operationId: binding.operationId,
      role,
      scenario: binding.scenario,
      sourceNodeId: binding.sourceNodeId,
      destinationNodeId: binding.destinationNodeId,
      binding: binding as unknown as Readonly<Record<string, unknown>>,
      fingerprint: bindingFingerprint(binding),
      state,
      waitingReason: null,
    }),
  );
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

/** Records why this box is waiting at its current step, beside the state it keeps. */
export function waitHandover(
  deps: HandoverStoreDeps,
  operationId: string,
  reason: ErrorCode,
): Promise<void> {
  return withNodeTransaction(deps.node, async (tx) => {
    const row = await readHandoverOperation(tx, deps.nodeId, operationId);
    // A fault in Waitron: a box waits only at a step it has recorded.
    if (row === null) throw new Error(`no handover operation ${operationId} to wait on`);
    await advanceHandoverOperationTx(tx, deps.nodeId, operationId, row.state, reason);
  });
}
