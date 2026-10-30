import { eq } from "drizzle-orm";
import { deployment, locations, readTenant, type Transaction } from "@waitron/db";
import type { ModuleBackupContribution, ProvisionedNode } from "@waitron/module";
import { AppError } from "@waitron/shared";
import { currentSif } from "./registro-sif.js";
import { readHourHistory } from "./hour-history-reader.js";
import { projectHourHistory, type HourHistorySource, type HourScope } from "./hour-history.js";
import {
  parseRecoveryDocument,
  parseRecoveryDocumentPublic,
  type RecoveryDocument,
} from "./recovery-document.js";
import { serverKeyPage } from "./server-key-page.js";
import "./errors.js";

/** The checks every recovery sheet and pack page passes before it names this node's key. */
async function recoveryScope(
  tx: Transaction,
  node: ProvisionedNode,
  keyNodeId: string,
  createdAt: string,
  evidence: Readonly<Record<string, unknown>>,
): Promise<{ document: Omit<RecoveryDocument, "nodeKey">; timeZone: string }> {
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
    keyNodeId !== node.nodeId
  )
    return refuse();
  const scope: HourScope = { taxpayerNif: tenant.taxId, environment };
  const sources = [
    await readHourHistory(tx, environment),
    ...(Object.values(evidence) as HourHistorySource[]),
  ];
  if (projectHourHistory({ scope, sources }).contradictions.length > 0) return refuse();
  return {
    document: {
      kind: "waitron-recovery-document",
      version: 1,
      scope: { ...scope, softwareId: sif.idSistemaInformatico },
      taxpayerName: tenant.legalName,
      venueName: venue.name,
      createdAt,
    },
    timeZone: venue.timeZone,
  };
}

export const FISCAL_RECOVERY_PACK_PAGE: NonNullable<
  ModuleBackupContribution["recoveryPackPage"]
> = async (tx, node, context) => {
  const { document, timeZone } = await recoveryScope(
    tx,
    node,
    context.keyInForce.nodeId,
    context.createdAt,
    context.evidence,
  );
  const options = { locale: context.locale, timeZone };
  if (context.newKey === undefined)
    return {
      page: serverKeyPage(
        parseRecoveryDocumentPublic({ ...document, nodeKey: context.keyInForce }),
        options,
      ),
    };
  const keyFile = await parseRecoveryDocument({
    ...document,
    nodeKey: { nodeId: node.nodeId, name: context.newKey.name, secret: context.newKey.secret },
  });
  return { page: serverKeyPage(keyFile, options), keyFile };
};
