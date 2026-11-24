import { now, withTransaction, type Database, type Transaction } from "@waitron/db";
import { AppError, type NodeId } from "@waitron/shared";
import { and, eq, isNull, sql } from "drizzle-orm";
import "../src/errors.js";
import type { SifRegistration } from "../src/registro-sif.js";
import { verifactuIdentities } from "../src/schema/verifactu-identities.js";

export function seedNamedFixtureSif(
  tx: Transaction,
  params: {
    nodeId: RegisterSifParams["nodeId"];
    taxpayerNif: string;
    softwareId: string;
    installationIdentity: string;
  },
) {
  return seedFixtureSif(tx, {
    nodeId: params.nodeId,
    nif: params.taxpayerNif,
    idSistemaInformatico: params.softwareId,
    numeroInstalacion: params.installationIdentity,
  });
}

export async function fixtureSifIdentities(tx: Transaction) {
  return tx.select({ identity: verifactuIdentities.numeroInstalacion }).from(verifactuIdentities);
}

export async function seedFixtureSif(
  tx: Transaction,
  params: Omit<RegisterSifParams, "numeroInstalacion"> & { numeroInstalacion?: string },
) {
  const rows = await tx
    .select({ id: verifactuIdentities.id })
    .from(verifactuIdentities)
    .where(
      and(
        eq(verifactuIdentities.nif, params.nif),
        eq(verifactuIdentities.idSistemaInformatico, params.idSistemaInformatico),
      ),
    );
  // Historical fixture identities keep record bytes independent of the allocation transport.
  return registerSif(tx, {
    ...params,
    numeroInstalacion: params.numeroInstalacion ?? String(rows.length + 1),
  });
}

export const ID_SISTEMA_MAX_LENGTH = 2;

function assertUsableIdSistema(value: string): void {
  if (value.length === 0 || value.length > ID_SISTEMA_MAX_LENGTH) {
    throw new AppError("sif.id_sistema_invalid", { value, maxLength: ID_SISTEMA_MAX_LENGTH });
  }
}

function assertSuppliedInstallation(value: unknown): asserts value is string {
  if (typeof value !== "string" || value.length === 0 || value.length > 30)
    throw new AppError("sif.allocation_invalid", { reason: "installation_invalid" });
}

export interface RegisterSifParams {
  nodeId: NodeId;
  /** The obligado tributario's NIF. Half of the SIF identity, with IdSIF and NºInstalación. */
  nif: string;
  idSistemaInformatico: string;
  numeroInstalacion: string;
}

/**
 * Persist a DORMANT reserved SIF on a standby's own database, keyed to the standby's
 * OWN nodeId with the number the PRIMARY allocated (`numeroInstalacion`) — NOT re-allocated here. It
 * is inert because no sale resolves this node, and `currentSif` gates on the node. A reserved
 * node has no prior identity to retire.
 * The `verifactu_identities_instalacion_uq` unique on (nif, id_sistema_informatico, numero_instalacion)
 * is the never-reuse backstop.
 */
export async function writeReservedSif(
  tx: Transaction,
  params: {
    nodeId: NodeId;
    nif: string;
    idSistemaInformatico: string;
    numeroInstalacion: string;
  },
): Promise<{ id: string }> {
  assertUsableIdSistema(params.idSistemaInformatico);
  assertSuppliedInstallation(params.numeroInstalacion);

  const [inserted] = await tx
    .insert(verifactuIdentities)
    .values({
      nodeId: params.nodeId,
      nif: params.nif,
      idSistemaInformatico: params.idSistemaInformatico,
      numeroInstalacion: params.numeroInstalacion,
    })
    .returning({ id: verifactuIdentities.id });

  /* v8 ignore start */
  if (inserted === undefined) {
    throw new Error("verifactu_identities: reserved insert returned no row");
  }
  /* v8 ignore stop */

  return { id: inserted.id };
}

export async function registerSif(
  tx: Transaction,
  params: RegisterSifParams,
): Promise<SifRegistration> {
  assertUsableIdSistema(params.idSistemaInformatico);
  assertSuppliedInstallation(params.numeroInstalacion);

  // Retire any live identity for this node first, so the partial unique index
  // (verifactu_identities_activo_uq) has room for the new one. The old row is never updated beyond this
  // timestamp: its registros are immutable and must keep pointing at the identity that actually
  // generated them.
  await tx
    .update(verifactuIdentities)
    .set({ revocadoEn: now() })
    .where(
      and(eq(verifactuIdentities.nodeId, params.nodeId), isNull(verifactuIdentities.revocadoEn)),
    );

  const numeroInstalacion = params.numeroInstalacion;

  const [inserted] = await tx
    .insert(verifactuIdentities)
    .values({
      nodeId: params.nodeId,
      nif: params.nif,
      idSistemaInformatico: params.idSistemaInformatico,
      numeroInstalacion,
    })
    .returning({ id: verifactuIdentities.id, registradoEn: verifactuIdentities.registradoEn });

  // INSERT VALUES returns one row on success; a failed constraint raises an error.
  /* v8 ignore start */
  if (inserted === undefined) {
    throw new Error("verifactu_identities: insert returned no row");
  }
  /* v8 ignore stop */

  return {
    id: inserted.id,
    nodeId: params.nodeId,
    nif: params.nif,
    idSistemaInformatico: params.idSistemaInformatico,
    numeroInstalacion,
    registradoEn: inserted.registradoEn,
    revocadoEn: null,
  };
}

export function withoutIdentityTriggers<T>(
  db: Database,
  run: (tx: Transaction) => Promise<T>,
): Promise<T> {
  return withTransaction(db, async (tx) => {
    const { rows: triggers } = await tx.execute<{ name: string; sql: string }>(sql`
      select name, sql from sqlite_schema
      where type = 'trigger' and tbl_name = 'verifactu_identities'
        and name in ('verifactu_identities_guard_update', 'verifactu_identities_no_delete')
      order by rowid`);
    if (triggers.length !== 2) throw new Error("expected both VeriFactu identity guards");
    for (const { name } of triggers) await tx.execute(sql`drop trigger ${sql.identifier(name)}`);
    const result = await run(tx);
    for (const trigger of triggers) await tx.execute(sql.raw(trigger.sql));
    return result;
  });
}
