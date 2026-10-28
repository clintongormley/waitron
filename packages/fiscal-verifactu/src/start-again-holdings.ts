import { sql } from "drizzle-orm";
import type { Database, DeploymentEnvironment } from "@waitron/db";
import type { InitialSetupContribution } from "@waitron/module";
import { hourHistorySource } from "./hour-history-reader.js";

/** Must equal the append-only tables a first-setup activation writes (A1131 Task 0's probe). */
export const FISCAL_START_AGAIN_DELETABLE: readonly string[] = ["fiscal_allocations"];

type Target = Pick<Database, "execute">;

async function count(db: Target, query: ReturnType<typeof sql>): Promise<number> {
  const { rows } = await db.execute<{ n: number }>(query);
  return Number(rows[0]!.n);
}

// A missing table throws "no such table" here, so a damaged database is never read as holding nothing.
export const startAgainHoldings: NonNullable<
  InitialSetupContribution["startAgainHoldings"]
> = async (db) => ({
  records: await count(db, sql`select count(*) as n from registros_facturacion`),
  accepted: await count(
    db,
    sql`select count(*) as n from envios where estado in ('aceptado', 'aceptado_con_errores')`,
  ),
});

// Drizzle's json columns parse on read; these are the same not-null text columns read raw.
function parsed(value: unknown): unknown {
  return JSON.parse(value as string);
}

async function rows<Row extends Record<string, unknown>>(
  db: Target,
  query: ReturnType<typeof sql>,
): Promise<Row[]> {
  return (await db.execute<Row>(query)).rows;
}

// The same tables and columns `readHourHistory` reads, without a transaction, so a read-only
// connection serves it; both hand their rows to `hourHistorySource`.
export const startAgainHistory: NonNullable<InitialSetupContribution["startAgainHistory"]> = async (
  db,
) => {
  // Unlike `readDeploymentEnvironment`, a missing `deployment` table throws: never read as empty.
  const [deployed] = await rows<{ environment: DeploymentEnvironment }>(
    db,
    sql`select environment from deployment where id = 1`,
  );
  const environment = deployed?.environment ?? null;
  const tenant = (await rows(db, sql`select 1 as present from tenants where id = 1`)).length > 0;
  const series = await rows<{
    id: string;
    nodeId: string;
    code: string;
    purpose: string;
    retiredAt: string | null;
  }>(
    db,
    sql`select id, node_id as "nodeId", code, purpose, retired_at as "retiredAt" from invoice_series`,
  );
  const sifs = await rows<{
    id: string;
    nodeId: string;
    nif: string;
    idSistemaInformatico: string;
    numeroInstalacion: string;
    registradoEn: string | null;
    revocadoEn: string | null;
  }>(
    db,
    sql`select id, node_id as "nodeId", nif, id_sistema_informatico as "idSistemaInformatico",
      numero_instalacion as "numeroInstalacion", registrado_en as "registradoEn",
      revocado_en as "revocadoEn" from registro_sif`,
  );
  const allocations = (
    await rows<{
      eventKey: string;
      allocationKey: string;
      nodeId: string;
      sifId: string;
      taxpayerNif: string;
      softwareId: string;
      environment: string;
      installationIdentity: string;
      allocation: unknown;
      approval: unknown;
      bases: unknown;
      result: unknown;
      activatedAt: string | null;
    }>(
      db,
      sql`select event_key as "eventKey", allocation_key as "allocationKey", node_id as "nodeId",
        sif_id as "sifId", taxpayer_nif as "taxpayerNif", software_id as "softwareId", environment,
        installation_identity as "installationIdentity", allocation, approval, bases, result,
        activated_at as "activatedAt" from fiscal_allocations`,
    )
  ).map((row) => ({
    ...row,
    allocation: parsed(row.allocation) as never,
    approval: parsed(row.approval) as never,
    bases: parsed(row.bases),
    result: parsed(row.result) as never,
  }));
  const reservations = (
    await rows<{
      eventKey: string;
      allocationKey: string;
      nodeId: string;
      sourceNodeId: string;
      taxpayerNif: string;
      softwareId: string;
      environment: string;
      installationIdentity: string;
      evidence: unknown;
      bases: unknown;
      establishedAt: string | null;
    }>(
      db,
      sql`select event_key as "eventKey", allocation_key as "allocationKey", node_id as "nodeId",
        source_node_id as "sourceNodeId", taxpayer_nif as "taxpayerNif", software_id as "softwareId",
        environment, installation_identity as "installationIdentity", evidence, bases,
        established_at as "establishedAt" from fiscal_reservations`,
    )
  ).map((row) => ({ ...row, evidence: parsed(row.evidence), bases: parsed(row.bases) }));
  return [hourHistorySource({ tenant, series, sifs, allocations, reservations }, environment)];
};
