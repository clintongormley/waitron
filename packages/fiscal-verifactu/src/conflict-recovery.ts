import "./errors.js";
import { isDeepStrictEqual as equal } from "node:util";
import { eq } from "drizzle-orm";
import { invoiceSeries, type Transaction } from "@waitron/db";
import {
  type LiveModuleOperationScope,
  type OperationAuthority,
  type OperationBinding,
  type ProvisionedNode,
} from "@waitron/module";
import { AppError } from "@waitron/shared";
import { recoveryHourOperator } from "./hour-recovery-preparation.js";
import { readActiveConflicts } from "./conflict-evidence.js";
import type { RecoveryConflictRef as ConflictRef } from "./conflict-types.js";
import { conflictSourceId } from "./conflict-reference.js";
export { conflictSourceId } from "./conflict-reference.js";
import { verifactuSeriesConflicts } from "./schema/verifactu-series-conflicts.js";
import { verifactuIdentities } from "./schema/verifactu-identities.js";
import {
  parseConflictActivation,
  type ConflictAllocationInput,
} from "./conflict-recovery-contract.js";
import type { ActivationResult } from "./allocation-types.js";
import { allocationOf } from "./identity-allocation.js";
import { verifactuRecords } from "./schema/verifactu-records.js";
import { verifactuSubmissions } from "./schema/verifactu-submissions.js";
import { lookupConflict } from "./history.js";
import { withHourAdmission } from "./allocation-envelope.js";
import { activateModuleAllocation, readModuleAllocationSeries } from "./allocation-operation.js";
import { activatePreparedModuleAllocation } from "./allocation-preparation.js";

function refuse(reason: string): never {
  throw new AppError("sif.allocation_invalid", { reason });
}

function checkBinding(
  node: ProvisionedNode,
  binding: OperationBinding,
  conflict: ConflictRef,
  authority: OperationAuthority,
) {
  recoveryHourOperator(binding, authority);
  if (
    binding.action !== "conflict-switch" ||
    binding.targetNodeId !== node.nodeId ||
    binding.sourceId !== conflictSourceId(conflict)
  )
    refuse("event_mismatch");
}

async function checkOriginal(
  tx: Transaction,
  node: ProvisionedNode,
  conflict: ConflictRef,
): Promise<void> {
  if ("lookupId" in conflict) {
    const [lookup] = await tx
      .select({
        sifId: verifactuSeriesConflicts.sifId,
        nodeId: verifactuIdentities.nodeId,
        seriesNode: invoiceSeries.nodeId,
      })
      .from(verifactuSeriesConflicts)
      .innerJoin(verifactuIdentities, eq(verifactuIdentities.id, verifactuSeriesConflicts.sifId))
      .innerJoin(invoiceSeries, eq(invoiceSeries.id, verifactuSeriesConflicts.seriesId))
      .where(eq(verifactuSeriesConflicts.id, conflict.lookupId));
    if (
      lookup?.sifId !== conflict.sifId ||
      lookup.nodeId !== node.nodeId ||
      lookup.seriesNode !== node.nodeId
    )
      return refuse("event_mismatch");
    return;
  }
  const [original] = await tx
    .select()
    .from(verifactuRecords)
    .where(eq(verifactuRecords.id, conflict.registroId));
  const [reply] = await tx
    .select()
    .from(verifactuSubmissions)
    .where(eq(verifactuSubmissions.registroId, conflict.registroId));
  if (original?.nodeId !== node.nodeId || original.sifId !== conflict.sifId || !reply?.caseOpenedAt)
    return refuse("event_mismatch");
  const lookup = await lookupConflict(tx, conflict.registroId);
  if (reply.estado !== "rechazado" && lookup === null) return refuse("conflict_not_active");
}

async function checkActive(tx: Transaction, node: ProvisionedNode, conflict: ConflictRef) {
  await checkOriginal(tx, node, conflict);
  if (
    !(await readActiveConflicts(tx, node.nodeId)).some(
      (row) => conflictSourceId(row) === conflictSourceId(conflict),
    )
  )
    return refuse("conflict_not_active");
}

export async function readCommittedConflictSwitch(
  tx: Transaction,
  node: ProvisionedNode,
  binding: OperationBinding,
  conflict: ConflictRef,
  authority: OperationAuthority,
  input?: ConflictAllocationInput,
): Promise<ActivationResult | null> {
  checkBinding(node, binding, conflict, authority);
  const [identity] = await tx
    .select()
    .from(verifactuIdentities)
    .where(eq(verifactuIdentities.eventKey, binding.eventId));
  if (identity === undefined) return null;
  const prior = allocationOf(identity)!;
  await checkOriginal(tx, node, conflict);
  const result = parseConflictActivation(prior.result);
  if (
    result === null ||
    identity.nodeId !== node.nodeId ||
    prior.approval.sourceId !== binding.sourceId ||
    identity.id === conflict.sifId ||
    result.activationEventId !== binding.eventId ||
    result.sifId !== identity.id
  )
    return refuse("event_mismatch");
  const retained = { allocation: prior.allocation, approval: prior.approval };
  if (input !== undefined && !equal(retained, input)) return refuse("event_mismatch");
  const operation = { binding, authority, input: retained };
  return withHourAdmission(
    operation,
    { requiredBases: prior.bases, priorActivation: "committed" },
    async (evidence) => {
      const result = await activateModuleAllocation(tx, node, operation, evidence);
      await readModuleAllocationSeries(tx, node, prior.bases);
      return result;
    },
  );
}

export async function recoverActiveConflict(
  scope: LiveModuleOperationScope,
  request: { binding: OperationBinding; conflict: ConflictRef; input: ConflictAllocationInput },
): Promise<ActivationResult> {
  const held = structuredClone(request);
  if (!equal(held.binding, scope.binding)) return refuse("event_mismatch");
  checkBinding(scope.node, held.binding, held.conflict, scope.authority);
  const readCommitted = (tx: Transaction) =>
    readCommittedConflictSwitch(
      tx,
      scope.node,
      held.binding,
      held.conflict,
      scope.authority,
      held.input,
    );
  const committed = await scope.commit(async (tx) => {
    const prior = await readCommitted(tx);
    if (prior !== null) return prior;
    await checkActive(tx, scope.node, held.conflict);
    return null;
  });
  if (committed !== null) return committed;
  return scope.operations.prepare(
    { binding: held.binding, authority: scope.authority, input: held.input },
    (prepared) =>
      scope.commit(async (tx) => {
        const prior = await readCommitted(tx);
        if (prior !== null) return prior;
        await checkActive(tx, scope.node, held.conflict);
        checkBinding(scope.node, held.binding, held.conflict, scope.authority);
        return activatePreparedModuleAllocation(tx, scope.node, prepared);
      }),
  );
}
