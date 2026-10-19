import { eq } from "drizzle-orm";
import { deployment, locations, readTenant } from "@waitron/db";
import type { ModuleBackupContribution } from "@waitron/module";
import { AppError } from "@waitron/shared";
import { currentSif } from "./registro-sif.js";
import { readHourHistory } from "./hour-history-reader.js";
import { projectHourHistory, type HourHistorySource, type HourScope } from "./hour-history.js";
import { renderRecoveryPdf } from "./recovery-pdf-node.js";
import "./errors.js";

export const FISCAL_RECOVERY_DOCUMENT: NonNullable<
  ModuleBackupContribution["recoveryDocument"]
> = async (tx, node, context) => {
  const refuse = (): never => {
    throw new AppError("sif.allocation_invalid", { reason: "history_invalid" });
  };
  const tenant = await readTenant(tx);
  const [stamp] = await tx
    .select({ environment: deployment.environment })
    .from(deployment)
    .where(eq(deployment.id, 1));
  const environment = stamp?.environment ?? null;
  const sif = await currentSif(tx, node.nodeId);
  const [venue] = await tx
    .select({ name: locations.name, timeZone: locations.timeZone })
    .from(locations)
    .where(eq(locations.id, node.locationId));
  if (
    tenant === null ||
    (environment !== "production" && environment !== "preproduction") ||
    venue === undefined ||
    sif.nif !== tenant.taxId ||
    context.nodeKey.nodeId !== node.nodeId
  )
    return refuse();
  const scope: HourScope = { taxpayerNif: tenant.taxId, environment };
  const sources = [
    await readHourHistory(tx, environment),
    ...(Object.values(context.evidence) as HourHistorySource[]),
  ];
  if (projectHourHistory({ scope, sources }).contradictions.length > 0) return refuse();
  return renderRecoveryPdf(
    {
      kind: "waitron-recovery-document",
      version: 1,
      scope: { ...scope, softwareId: sif.idSistemaInformatico },
      taxpayerName: tenant.legalName,
      venueName: venue.name,
      createdAt: context.createdAt,
      nodeKey: context.nodeKey,
      installationCodes: [sif.numeroInstalacion],
    },
    context.locale,
    venue.timeZone,
  );
};
