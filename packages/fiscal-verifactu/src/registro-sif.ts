// Side-effect only: registers this package's error codes on the shared `ErrorParams` registry.
import "./errors.js";
import { and, eq, isNull } from "drizzle-orm";
import { AppError } from "@waitron/shared";
import type { NodeId } from "@waitron/shared";
import { now } from "@waitron/db";
import type { Transaction } from "@waitron/db";
import { verifactuIdentities } from "./schema/verifactu-identities.js";

/**
 * AEAT caps `IdSistemaInformatico` at two characters (`@waitron/verifactu`'s `ID_SISTEMA_LENGTH`).
 *
 * `verifactu_identities` carries no CHECK on the column, so the bound is applied in code: `registerSif`
 * and `writeReservedSif` below each open with `assertUsableIdSistema`.
 */
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

export interface SifRegistration {
  id: string;
  nodeId: NodeId;
  nif: string;
  idSistemaInformatico: string;
  numeroInstalacion: string;
  registradoEn: Date;
  revocadoEn: Date | null;
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

export async function currentSif(tx: Transaction, nodeId: NodeId): Promise<SifRegistration> {
  const [row] = await tx
    .select({
      id: verifactuIdentities.id,
      nif: verifactuIdentities.nif,
      idSistemaInformatico: verifactuIdentities.idSistemaInformatico,
      numeroInstalacion: verifactuIdentities.numeroInstalacion,
      registradoEn: verifactuIdentities.registradoEn,
      revocadoEn: verifactuIdentities.revocadoEn,
    })
    .from(verifactuIdentities)
    .where(and(eq(verifactuIdentities.nodeId, nodeId), isNull(verifactuIdentities.revocadoEn)))
    .limit(1);

  if (row === undefined) {
    throw new AppError("sif.not_registered", { nodeId });
  }

  return { ...row, nodeId };
}
