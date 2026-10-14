import { readTenant, deployment } from "@waitron/db";
import { eq } from "drizzle-orm";
import type { ModuleBackupContribution } from "@waitron/module";
import { AppError } from "@waitron/shared";
import { currentSif } from "./registro-sif.js";
import { liveSeriesBases } from "./reserved-series.js";
import { verifyPaperBlockSnapshot } from "./paper-evidence.js";
import "./errors.js";

export const FISCAL_RECOVERY_PACK: NonNullable<ModuleBackupContribution["recoveryPack"]> = async (
  tx,
  node,
  input,
) => {
  const refuse = (reason: string): never => {
    throw new AppError("sif.allocation_invalid", { reason });
  };
  if (
    typeof input !== "object" ||
    input === null ||
    Array.isArray(input) ||
    Reflect.ownKeys(input).length !== 2 ||
    !Object.hasOwn(input, "block") ||
    !Object.hasOwn(input, "custodian")
  )
    return refuse("malformed");
  const supplied = input as { block: unknown; custodian: unknown };
  const tenant = await readTenant(tx);
  const [stamp] = await tx.select().from(deployment).where(eq(deployment.id, 1));
  const environment = stamp?.environment;
  const sif = await currentSif(tx, node.nodeId);
  if (tenant === null || environment === undefined || sif.nif !== tenant.taxId)
    return refuse("scope_mismatch");
  const snapshot = verifyPaperBlockSnapshot(supplied.block, supplied.custodian, {
    taxpayerNif: tenant.taxId,
    softwareId: sif.idSistemaInformatico,
    environment,
    recipientVenueId: node.venueId,
    requiredBases: await liveSeriesBases(tx, node),
  });
  if (!snapshot.ok) return refuse(snapshot.reason);
  return {
    version: 1,
    kind: "paper-register-snapshot",
    custodian: snapshot.custodian,
    block: snapshot.block,
  };
};
