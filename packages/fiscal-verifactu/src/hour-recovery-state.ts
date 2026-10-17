import { readDeploymentEnvironment, readTenant, withTransaction } from "@waitron/db";
import type { ModuleOperationPreparation } from "@waitron/module";
import { AppError } from "@waitron/shared";
import { readHourHistory } from "./hour-history-reader.js";
import { liveSeriesBases } from "./reserved-series.js";
import { readModuleAllocationSeries } from "./allocation-operation.js";
import { assertFiscalRestoreCommitted } from "./restore-committed.js";
import "./errors.js";
import { createHash } from "node:crypto";

export const readHourRecoveryHistory: NonNullable<
  ModuleOperationPreparation["readRecoveryHistory"]
> = (db) =>
  withTransaction(db, async (tx) => {
    const history = await readHourHistory(tx, await readDeploymentEnvironment(db));
    // Distinct database snapshots can retain the same row with different retirement dates.
    const reference = `surviving-venue/${createHash("sha256").update(JSON.stringify(history)).digest("hex")}`;
    return [
      {
        ...history,
        reference,
        records: history.records.map((row) => ({
          ...(row as Record<string, unknown>),
          reference: `${reference}/${(row as { reference: string }).reference}`,
        })),
      },
    ];
  });

export const readHourRecoveryState: NonNullable<
  ModuleOperationPreparation["readRecoveryState"]
> = async (db, node, binding) => {
  const refuse = (): never => {
    throw new AppError("sif.allocation_invalid", { reason: "event_mismatch" });
  };
  if (
    binding.module !== "fiscal-verifactu" ||
    binding.action !== "restore" ||
    binding.targetNodeId !== node.nodeId
  )
    return refuse();
  return withTransaction(db, async (tx) => {
    const tenant = await readTenant(tx);
    const environment = await readDeploymentEnvironment(db);
    if (tenant === null || environment === null) return refuse();
    const bases = await liveSeriesBases(tx, node);
    await readModuleAllocationSeries(tx, node, bases);
    const history = await readHourHistory(tx, environment);
    const committed = history.records.some(
      (row) =>
        typeof row === "object" &&
        row !== null &&
        "reference" in row &&
        row.reference === `fiscal_allocations/${binding.eventId}`,
    );
    if (committed) await assertFiscalRestoreCommitted(tx, node, binding);
    return {
      country: tenant.country,
      taxId: tenant.taxId,
      environment,
      bases,
      history: [history],
      priorActivation: committed ? "committed" : "none",
    };
  });
};
