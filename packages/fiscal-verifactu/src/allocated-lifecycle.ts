import "./errors.js";
import { readTenant, type Transaction } from "@waitron/db";
import type { ModuleOperationInput, NodeSeed, ProvisionedNode, RestoreHook } from "@waitron/module";
import { AppError, isAppError } from "@waitron/shared";
import { activatePreparedModuleAllocation } from "./allocation-preparation.js";
import { readModuleAllocationSeries } from "./allocation-operation.js";
import { currentSif } from "./registro-sif.js";

async function activate(
  tx: Transaction,
  node: ProvisionedNode,
  operation: ModuleOperationInput | undefined,
  actions: readonly string[],
): Promise<string> {
  if (operation === undefined)
    throw new AppError("sif.allocation_invalid", { reason: "reauthentication_required" });
  if (!actions.includes(operation.binding.action))
    throw new AppError("sif.allocation_invalid", { reason: "event_mismatch" });
  const result = await activatePreparedModuleAllocation(tx, node, operation);
  const sif = await currentSif(tx, node.nodeId);
  return `SIF ${result.sifId} (installation ${sif.numeroInstalacion}); series ${result.series.map((series) => series.code).join(", ")}`;
}

export const ALLOCATED_FISCAL_SEED: NodeSeed = {
  summary: "activate the supplied Veri*Factu SIF and invoice series",
  async run(tx, node, operation) {
    if ((await readTenant(tx)) === null)
      throw new Error("fiscal seed: tenants is empty, so there is no taxpayer to file under");
    return activate(tx, node, operation, ["setup", "re-register"]);
  },
  series: { resolve: readModuleAllocationSeries },
};

export const ALLOCATED_FISCAL_RESTORE: RestoreHook = async (tx, node, operation) => {
  try {
    await currentSif(tx, node.nodeId);
  } catch (error) {
    if (isAppError(error) && error.code === "sif.not_registered")
      return {
        report: `node ${node.nodeId} holds no live SIF; nothing re-registered, series unchanged`,
      };
    throw error;
  }
  // Activation owns all series writes; returning replacement codes would make the host repeat them.
  return { report: await activate(tx, node, operation, ["restore"]) };
};

export async function activatePreparedFiscalStandby(
  tx: Transaction,
  node: ProvisionedNode,
  operation?: ModuleOperationInput,
): Promise<void> {
  await activate(tx, node, operation, ["promote"]);
}
