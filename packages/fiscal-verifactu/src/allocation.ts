import "./errors.js";
import { isDeepStrictEqual } from "node:util";
import { AppError, isAppError } from "@waitron/shared";
import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import {
  deployment,
  invoiceSeries,
  newId,
  nodes,
  now,
  readTaxpayer,
  type Transaction,
} from "@waitron/db";
import { readOperationAuthority, type ProvisionedNode } from "@waitron/module";
import {
  validateAllocationEnvelope,
  validateAllocationReplay,
  type AllocationContext,
  type AllocationRefusal,
  type AllocationValidation,
} from "./allocation-envelope.js";
import { WAITRON_ID_SISTEMA } from "./software.js";
import { admitsAllocationAction } from "./identity-change-authority.js";
import { liveSeriesBases } from "./reserved-series.js";
import { verifactuIdentities } from "./schema/verifactu-identities.js";
import { currentSif } from "./registro-sif.js";
import type { ActivationResult } from "./allocation-types.js";
import { allocationOf } from "./identity-allocation.js";

export type ActivationRefusal =
  | AllocationRefusal
  | "node_mismatch"
  | "environment_unstamped"
  | "installation_used"
  | "series_collision";
export type ActivationValidation =
  | Exclude<AllocationValidation, { ok: false }>
  | { readonly ok: false; readonly reason: ActivationRefusal };

export async function validateAllocationForActivation(
  tx: Transaction,
  node: Pick<ProvisionedNode, "nodeId">,
  allocation: unknown,
  approval: unknown,
  context: AllocationContext,
): Promise<ActivationValidation> {
  return validateForActivation(tx, node, allocation, approval, context);
}

type SeriesBases = readonly { readonly code: string; readonly purpose: string }[];

async function validateForActivation(
  tx: Transaction,
  node: Pick<ProvisionedNode, "nodeId">,
  allocation: unknown,
  approval: unknown,
  context: AllocationContext,
  dormantBases?: SeriesBases,
): Promise<ActivationValidation> {
  const [storedNode] = await tx
    .select({ id: nodes.id })
    .from(nodes)
    .where(eq(nodes.id, node.nodeId));
  if (storedNode === undefined || context.targetNodeId !== node.nodeId)
    return { ok: false, reason: "node_mismatch" };
  const taxpayer = await readTaxpayer(tx);
  if (taxpayer === null) return { ok: false, reason: "taxpayer_mismatch" };
  const [stamp] = await tx
    .select({ environment: deployment.environment })
    .from(deployment)
    .where(eq(deployment.id, 1));
  const environment = stamp?.environment;
  if (environment !== "production" && environment !== "preproduction")
    return { ok: false, reason: "environment_unstamped" };
  const [liveSif] = await tx
    .select({ softwareId: verifactuIdentities.idSistemaInformatico })
    .from(verifactuIdentities)
    .where(
      and(eq(verifactuIdentities.nodeId, node.nodeId), isNull(verifactuIdentities.revocadoEn)),
    );
  const storedBases = dormantBases ?? (await liveSeriesBases(tx, node));
  if (storedBases.length === 0 && context.mode !== "initial-setup")
    return { ok: false, reason: "series_mismatch" };
  const validated = validateAllocationEnvelope(allocation, approval, {
    ...context,
    taxpayerNif: taxpayer.taxId,
    environment,
    softwareId: liveSif?.softwareId ?? WAITRON_ID_SISTEMA,
    requiredBases: storedBases.length > 0 ? storedBases : context.requiredBases,
  });
  if (!validated.ok) return validated;
  const [usedAllocation] = await tx
    .select({ id: verifactuIdentities.id })
    .from(verifactuIdentities)
    .where(eq(verifactuIdentities.allocationKey, validated.allocation.allocationId));
  if (usedAllocation !== undefined) return { ok: false, reason: "allocation_consumed" };
  const [usedIdentity] = await tx
    .select({ id: verifactuIdentities.id })
    .from(verifactuIdentities)
    .where(
      and(
        eq(verifactuIdentities.nif, validated.allocation.taxpayerNif),
        eq(verifactuIdentities.idSistemaInformatico, validated.allocation.softwareId),
        sql`${verifactuIdentities.numeroInstalacion} = ${validated.allocation.installationIdentity}`,
      ),
    )
    .limit(1);
  if (usedIdentity !== undefined) return { ok: false, reason: "installation_used" };
  const [usedSeries] = await tx
    .select({ id: invoiceSeries.id })
    .from(invoiceSeries)
    .where(
      inArray(
        invoiceSeries.code,
        validated.allocation.series.map((series) => series.code),
      ),
    )
    .limit(1);
  if (usedSeries !== undefined) return { ok: false, reason: "series_collision" };
  return validated;
}

export async function activateAllocation(
  tx: Transaction,
  node: Pick<ProvisionedNode, "nodeId">,
  allocation: unknown,
  approval: unknown,
  context: AllocationContext,
): Promise<ActivationResult> {
  return activate(tx, node, allocation, approval, context);
}

export async function activateAuthenticatedAllocation(
  tx: Transaction,
  node: Pick<ProvisionedNode, "nodeId">,
  allocation: unknown,
  approval: unknown,
  context: AllocationContext,
  authority: unknown,
  action: string,
): Promise<ActivationResult> {
  const authorised = authenticatedContext(context, authority, action);
  return activate(tx, node, allocation, approval, authorised.context, undefined, authorised.check);
}

function authenticatedContext(context: AllocationContext, authority: unknown, action: string) {
  const binding = {
    module: "fiscal-verifactu",
    action,
    eventId: context.eventId,
    sourceId: context.sourceId,
    targetNodeId: context.targetNodeId,
  };
  const operatorId =
    typeof context.operatorId === "string"
      ? context.operatorId
      : Object.freeze({ ...context.operatorId });
  const mode = context.mode;
  const authorise = (): void => {
    const verified = readOperationAuthority(authority, binding);
    if (
      !isDeepStrictEqual(verified?.operatorId, operatorId) ||
      !admitsAllocationAction(
        authority,
        action,
        mode === "initial-setup"
          ? ["setup"]
          : ["restore", "promote", "conflict-switch", "identity-change"],
      )
    )
      throw new AppError("sif.allocation_invalid", { reason: "reauthentication_required" });
  };
  authorise();
  return {
    context: {
      ...context,
      reauthentication: { operatorId, eventId: binding.eventId },
    },
    check: authorise,
  };
}

export async function activateAuthenticatedHourStandbyAllocation(
  tx: Transaction,
  node: Pick<ProvisionedNode, "nodeId">,
  allocation: unknown,
  approval: unknown,
  context: AllocationContext,
  authority: unknown,
): Promise<ActivationResult> {
  if (context.authority.kind !== "hour")
    throw new AppError("sif.allocation_invalid", { reason: "source_mismatch" });
  const target = { ...node };
  const authorised = authenticatedContext(
    {
      ...context,
      authority: { ...context.authority },
      requiredBases: structuredClone(context.requiredBases),
    },
    authority,
    "promote",
  );
  if (authorised.context.priorActivation !== "committed") {
    const liveSif = await currentSif(tx, target.nodeId).catch((error: unknown) => {
      if (isAppError(error) && error.code === "sif.not_registered") return null;
      throw error;
    });
    if (liveSif !== null || (await liveSeriesBases(tx, target)).length !== 0)
      throw new AppError("sif.allocation_invalid", { reason: "standby_already_active" });
  }
  return activate(
    tx,
    target,
    allocation,
    approval,
    authorised.context,
    authorised.context.requiredBases,
    authorised.check,
  );
}

async function activate(
  tx: Transaction,
  node: Pick<ProvisionedNode, "nodeId">,
  allocation: unknown,
  approval: unknown,
  context: AllocationContext,
  dormantBases?: SeriesBases,
  authorise?: () => void,
): Promise<ActivationResult> {
  const refuse = (reason: string): never => {
    throw new AppError("sif.allocation_invalid", { reason });
  };
  const [priorIdentity] = await tx
    .select()
    .from(verifactuIdentities)
    .where(eq(verifactuIdentities.eventKey, context.eventId));
  if (priorIdentity !== undefined) {
    const prior = allocationOf(priorIdentity)!;
    if (context.priorActivation !== "committed")
      return refuse(
        context.priorActivation === "uncertain"
          ? "uncertain_prior_activation"
          : "outside_confirmation_missing",
      );
    const taxpayer = await readTaxpayer(tx);
    const [stamp] = await tx.select().from(deployment).where(eq(deployment.id, 1));
    const [storedNode] = await tx
      .select({ id: nodes.id })
      .from(nodes)
      .where(eq(nodes.id, node.nodeId));
    if (
      storedNode === undefined ||
      priorIdentity.nodeId !== node.nodeId ||
      context.targetNodeId !== node.nodeId
    )
      return refuse("node_mismatch");
    if (taxpayer?.taxId !== priorIdentity.nif) return refuse("taxpayer_mismatch");
    if (stamp?.environment !== "production" && stamp?.environment !== "preproduction")
      return refuse("environment_unstamped");
    if (stamp.environment !== prior.environment) return refuse("environment_mismatch");
    const validated = validateAllocationReplay(
      allocation,
      approval,
      {
        ...context,
        taxpayerNif: priorIdentity.nif,
        softwareId: priorIdentity.idSistemaInformatico,
        environment: stamp.environment,
        requiredBases: prior.bases,
      },
      prior,
    );
    if (!validated.ok) return refuse(validated.reason);
    const [activeSif] = await tx
      .select({ id: verifactuIdentities.id })
      .from(verifactuIdentities)
      .where(
        and(eq(verifactuIdentities.nodeId, node.nodeId), isNull(verifactuIdentities.revocadoEn)),
      );
    const live = await tx
      .select({ id: invoiceSeries.id, code: invoiceSeries.code, purpose: invoiceSeries.purpose })
      .from(invoiceSeries)
      .where(and(eq(invoiceSeries.nodeId, node.nodeId), isNull(invoiceSeries.retiredAt)))
      .orderBy(invoiceSeries.code);
    if (activeSif?.id !== priorIdentity.id || !isDeepStrictEqual(live, prior.result.series))
      return refuse("activation_superseded");
    authorise?.();
    return prior.result;
  }
  const validated = await validateForActivation(
    tx,
    node,
    allocation,
    approval,
    context,
    dormantBases,
  );
  if (!validated.ok) return refuse(validated.reason);
  const bases = dormantBases ?? (await liveSeriesBases(tx, node));
  authorise?.();
  const retiredAt = now();
  const sifId = newId();
  await tx
    .update(verifactuIdentities)
    .set({ revocadoEn: retiredAt })
    .where(
      and(eq(verifactuIdentities.nodeId, node.nodeId), isNull(verifactuIdentities.revocadoEn)),
    );
  await tx
    .update(invoiceSeries)
    .set({ retiredAt })
    .where(and(eq(invoiceSeries.nodeId, node.nodeId), isNull(invoiceSeries.retiredAt)));
  const series = [...validated.allocation.series]
    .sort((a, b) => (a.code < b.code ? -1 : a.code > b.code ? 1 : 0))
    .map((s) => ({ id: newId(), ...s }));
  for (const entry of series)
    await tx.insert(invoiceSeries).values({ ...entry, nodeId: node.nodeId });
  const result: ActivationResult = { activationEventId: validated.approval.eventId, sifId, series };
  await tx.insert(verifactuIdentities).values({
    id: sifId,
    nodeId: node.nodeId,
    nif: validated.allocation.taxpayerNif,
    idSistemaInformatico: validated.allocation.softwareId,
    numeroInstalacion: validated.allocation.installationIdentity,
    eventKey: result.activationEventId,
    allocationKey: validated.allocation.allocationId,
    environment: validated.allocation.environment,
    allocation: validated.allocation,
    approval: validated.approval,
    bases: bases.length > 0 ? bases : context.requiredBases,
    result,
  });
  return result;
}
