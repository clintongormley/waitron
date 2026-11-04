import "./errors.js";
import { isDeepStrictEqual as equal } from "node:util";
import { and, eq } from "drizzle-orm";
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
import { fiscalSeriesConflicts } from "./schema/series-conflicts.js";
import { registroSif } from "./schema/sif.js";
import {
  parseConflictActivation,
  type ConflictAllocationInput,
} from "./conflict-recovery-contract.js";
import { fiscalAllocations, type ActivationResult } from "./schema/allocations.js";
import { registrosFacturacion } from "./schema/registros.js";
import { filingCases } from "./schema/filing-cases.js";
import { envios } from "./schema/envios.js";
import { fiscalLookupConflicts } from "./schema/lookup-conflicts.js";
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
        sifId: fiscalSeriesConflicts.sifId,
        nodeId: registroSif.nodeId,
        seriesNode: invoiceSeries.nodeId,
      })
      .from(fiscalSeriesConflicts)
      .innerJoin(registroSif, eq(registroSif.id, fiscalSeriesConflicts.sifId))
      .innerJoin(invoiceSeries, eq(invoiceSeries.id, fiscalSeriesConflicts.seriesId))
      .where(eq(fiscalSeriesConflicts.id, conflict.lookupId));
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
    .from(registrosFacturacion)
    .where(eq(registrosFacturacion.id, conflict.registroId));
  const [incident] = await tx.select().from(filingCases).where(eq(filingCases.id, conflict.caseId));
  if (
    original?.nodeId !== node.nodeId ||
    original.sifId !== conflict.sifId ||
    incident?.registroId !== conflict.registroId
  )
    return refuse("event_mismatch");
  const [reply] = await tx.select().from(envios).where(eq(envios.registroId, conflict.registroId));
  const [lookup] = await tx
    .select()
    .from(fiscalLookupConflicts)
    .where(
      and(
        eq(fiscalLookupConflicts.registroId, conflict.registroId),
        eq(fiscalLookupConflicts.caseId, conflict.caseId),
      ),
    );
  if (reply?.estado !== "rechazado" && lookup === undefined) return refuse("conflict_not_active");
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
  const [prior] = await tx
    .select()
    .from(fiscalAllocations)
    .where(eq(fiscalAllocations.eventKey, binding.eventId));
  if (prior === undefined) return null;
  await checkOriginal(tx, node, conflict);
  const result = parseConflictActivation(prior.result);
  if (
    result === null ||
    prior.nodeId !== node.nodeId ||
    prior.approval.sourceId !== binding.sourceId ||
    prior.sifId === conflict.sifId ||
    result.activationEventId !== binding.eventId ||
    result.sifId !== prior.sifId
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
