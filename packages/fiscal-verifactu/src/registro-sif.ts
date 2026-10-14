// Side-effect only: registers this package's error codes on the shared `ErrorParams` registry.
import "./errors.js";
import { and, eq, isNull } from "drizzle-orm";
import { AppError } from "@waitron/shared";
import type { NodeId } from "@waitron/shared";
import { now } from "@waitron/db";
import type { Transaction } from "@waitron/db";
import { cadenas } from "./schema/cadenas.js";
import { registroSif } from "./schema/sif.js";

/**
 * AEAT caps `IdSistemaInformatico` at two characters (`@waitron/verifactu`'s `ID_SISTEMA_LENGTH`).
 *
 * `registro_sif` carries no CHECK on the column, so the bound is applied in code: `registerSif`
 * and `writeReservedSif` below each open with `assertUsableIdSistema`.
 */
export const ID_SISTEMA_MAX_LENGTH = 2;

/**
 * The database does not enforce this: `registro_sif` carries no CHECK on the column, and every
 * registro copies the value onto a record that can only be superseded by re-registering onto a
 * fresh chain. So it is checked HERE, before the registration writes anything.
 */
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
 * Reset a node's `cadenas` head to a fresh, empty chain — a distinct chain, never a resume of
 * anyone's (CLAUDE.md §5). Upserts the node's row to a both-null pointer
 * (`ultimoRegistroId`/`ultimaHuella`), so the next append is treated as the chain's first record.
 * `secuencia` is deliberately left OUT of the SET clause: it is OUR outbox ordering aid, never
 * AEAT's, and resetting it would collide with UNIQUE (node_id, secuencia) on the very next
 * append.
 *
 * Shared verbatim by `registerSif` (a new installation number is a new SIF identity, hence a new
 * chain) and `writeReservedSif` (a reserved node is brand-new, with no prior identity to retire).
 */
function resetChainHead(tx: Transaction, nodeId: NodeId): Promise<unknown> {
  return tx
    .insert(cadenas)
    .values({ nodeId })
    .onConflictDoUpdate({
      target: [cadenas.nodeId],
      set: { ultimoRegistroId: null, ultimaHuella: null, actualizadoEn: now() },
    });
}

/**
 * Persist a DORMANT reserved SIF on a standby's own database, keyed to the standby's
 * OWN nodeId with the number the PRIMARY allocated (`numeroInstalacion`) — NOT re-allocated here. It
 * is inert because no sale resolves this node (`config.till.nodeId` stays the primary's until a
 * promotion), and `currentSif` gates on the node. A fresh empty `cadenas` head (both-null
 * pointer) makes it a brand-new chain, never a resume of anyone's (CLAUDE.md §5). No prior identity to
 * retire — a reserved node is new. The `registro_sif_instalacion_uq` unique on
 * (nif, id_sistema_informatico, numero_instalacion) is the never-reuse backstop.
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
    .insert(registroSif)
    .values({
      nodeId: params.nodeId,
      nif: params.nif,
      idSistemaInformatico: params.idSistemaInformatico,
      numeroInstalacion: params.numeroInstalacion,
    })
    .returning({ id: registroSif.id });

  /* v8 ignore start */
  if (inserted === undefined) {
    throw new Error("registro_sif: reserved insert returned no row");
  }
  /* v8 ignore stop */

  await resetChainHead(tx, params.nodeId);

  return { id: inserted.id };
}

export async function registerSif(
  tx: Transaction,
  params: RegisterSifParams,
): Promise<SifRegistration> {
  assertUsableIdSistema(params.idSistemaInformatico);
  assertSuppliedInstallation(params.numeroInstalacion);

  // Retire any live identity for this node first, so the partial unique index
  // (registro_sif_activo_uq) has room for the new one. The old row is never updated beyond this
  // timestamp: its registros are immutable and must keep pointing at the identity that actually
  // generated them.
  await tx
    .update(registroSif)
    .set({ revocadoEn: now() })
    .where(and(eq(registroSif.nodeId, params.nodeId), isNull(registroSif.revocadoEn)));

  const numeroInstalacion = params.numeroInstalacion;

  const [inserted] = await tx
    .insert(registroSif)
    .values({
      nodeId: params.nodeId,
      nif: params.nif,
      idSistemaInformatico: params.idSistemaInformatico,
      numeroInstalacion,
    })
    .returning({ id: registroSif.id, registradoEn: registroSif.registradoEn });

  // INSERT VALUES returns one row on success; a failed constraint raises an error.
  /* v8 ignore start */
  if (inserted === undefined) {
    throw new Error("registro_sif: insert returned no row");
  }
  /* v8 ignore stop */

  // A new installation number is a new SIF identity, therefore a NEW CHAIN.
  await resetChainHead(tx, params.nodeId);

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
      id: registroSif.id,
      nif: registroSif.nif,
      idSistemaInformatico: registroSif.idSistemaInformatico,
      numeroInstalacion: registroSif.numeroInstalacion,
      registradoEn: registroSif.registradoEn,
      revocadoEn: registroSif.revocadoEn,
    })
    .from(registroSif)
    .where(and(eq(registroSif.nodeId, nodeId), isNull(registroSif.revocadoEn)))
    .limit(1);

  if (row === undefined) {
    throw new AppError("sif.not_registered", { nodeId });
  }

  return { ...row, nodeId };
}

/**
 * Whether the next record on this node's chain carries `PrimerRegistro="S"`.
 *
 * DERIVED from local state — the node's own chain being empty — never from a flag anyone sets.
 * AEAT returns a non-rejecting warning when it is claimed and records already exist for that
 * SIF+NIF; that warning is a useful re-provisioning signal only because this value reports what
 * the database holds rather than what a caller believes. No chain row at all is also a first
 * record — a node registered but never sold — and a chain row whose pointer was just reset by
 * `registerSif` reports the same thing, which is the point: re-registration begins a new chain.
 */
export async function esPrimerRegistro(tx: Transaction, nodeId: NodeId): Promise<boolean> {
  const [row] = await tx
    .select({ ultimaHuella: cadenas.ultimaHuella })
    .from(cadenas)
    .where(eq(cadenas.nodeId, nodeId))
    .limit(1);

  return (row?.ultimaHuella ?? null) === null;
}
