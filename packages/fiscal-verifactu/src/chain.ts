// Side-effect only: registers this package's `chain.*` code on the shared `ErrorParams` registry
// by declaration merging. See ./errors.ts for the code and the reasoning, and
// ./errors.reachability.test.ts for the mechanical check that keeps errors.ts reachable from this
// package's own public barrel (index.ts). Mirrors ./registro-sif.ts's identical convention of
// importing from the file that documents the code a module throws.
import "./errors.js";
import { and, eq } from "drizzle-orm";
import { AppError } from "@waitron/shared";
import type { TenantId, TillId } from "@waitron/shared";
import type { Transaction } from "@waitron/db";
import type { AltaInput, AnulacionInput, Encadenamiento } from "@waitron/verifactu";
import { buildAltaRecord, buildAnulacionRecord } from "@waitron/verifactu";
import { currentSif } from "./registro-sif.js";
import type { SifRegistration } from "./registro-sif.js";
import { pointerTo, toRegistroRow } from "./registro-row.js";
import { cadenas } from "./schema/cadenas.js";
import { registrosFacturacion } from "./schema/registros.js";

const UNIQUE_VIOLATION = "23505";

/**
 * Three, not one and not ten. One is not a retry. Ten converts a genuine duplicate — a real bug,
 * or a second process writing the same position by some path that never takes the lock — into ten
 * pointless round trips before the same failure. The retry exists only for the narrow window in
 * which two writers race to CREATE a chain head that does not yet exist and therefore cannot be
 * locked (`lockChainHead`'s own doc comment); once that row exists, `FOR UPDATE` serialises
 * everything, so a further collision means something is wrong that retrying will not fix.
 */
const MAX_APPEND_ATTEMPTS = 3;

/**
 * Inputs for one record, MINUS `Encadenamiento` — the huella depends on the predecessor, which is
 * unknown until the chain head is locked, so a fully-built `AltaInput`/`AnulacionInput` cannot
 * exist before `appendToChain` runs. `saleId` travels alongside rather than living inside `input`:
 * it is this package's own foreign key onto core's `sales`, not an AEAT field, and keeping it out
 * of the arm that becomes `buildAltaRecord`/`buildAnulacionRecord`'s parameter stops it from ever
 * being accidentally hashed.
 *
 * `entorno` travels the identical way, for the identical reason: which environment the caller
 * (`VerifactuBackend`) is generating this record for is this package's own metadata, never AEAT's,
 * so it lives beside `saleId` rather than inside `input` — the one arm that ever reaches
 * `buildAltaRecord`/`buildAnulacionRecord` and, from there, `computeHuella`.
 */
export type PendingRegistro =
  | { tipo: "alta"; saleId: string; entorno: string; input: Omit<AltaInput, "Encadenamiento"> }
  | {
      tipo: "anulacion";
      saleId: string;
      entorno: string;
      input: Omit<AnulacionInput, "Encadenamiento">;
    };

export interface ChainHead {
  secuencia: number;
  ultimoRegistroId: string | null;
  ultimaHuella: string | null;
}

/**
 * Is this (or anything it wraps) a unique-constraint violation?
 *
 * Walks the cause chain because Drizzle wraps every failed query in a `DrizzleQueryError` whose
 * own `.code` is undefined — the real SQLSTATE lives on `.cause.code` (mirrors
 * `packages/db/src/testing/errors.ts`'s `pgErrorCode` unwrapping, reimplemented as a boolean
 * predicate here rather than imported, because this file needs a yes/no answer to decide whether
 * to retry, not the code string itself). Stops at a fixed depth so a self-referential `cause`
 * cannot spin forever. Checking only the top level would silently stop retrying and start
 * reporting the wrong error whenever a real unique violation arrives wrapped.
 */
export function isUniqueViolation(error: unknown): boolean {
  let current: unknown = error;
  for (let depth = 0; current != null && depth < 5; depth++) {
    if (
      typeof current === "object" &&
      "code" in current &&
      (current as { code?: unknown }).code === UNIQUE_VIOLATION
    ) {
      return true;
    }
    const next = (current as { cause?: unknown }).cause;
    if (next === current) return false;
    current = next;
  }
  return false;
}

async function selectHeadForUpdate(
  tx: Transaction,
  tenantId: TenantId,
  tillId: TillId,
): Promise<ChainHead | undefined> {
  const [row] = await tx
    .select({
      secuencia: cadenas.secuencia,
      ultimoRegistroId: cadenas.ultimoRegistroId,
      ultimaHuella: cadenas.ultimaHuella,
    })
    .from(cadenas)
    .where(and(eq(cadenas.tenantId, tenantId), eq(cadenas.tillId, tillId)))
    .for("update");
  return row;
}

/**
 * Takes the chain-head row lock, creating the head if this is a fresh till.
 *
 * Exported separately from `appendToChain` because art. 7.i verification (a future `verifyChain`,
 * Task 15) must read the last two records under the SAME lock, in the SAME transaction — a
 * verification that examines a predecessor another writer is concurrently replacing has verified
 * nothing. Re-acquiring the lock inside `appendToChain` afterwards is free: the transaction
 * already holds it, and Postgres row locks are reentrant within one transaction.
 *
 * `insert ... on conflict do nothing` followed by a re-select, not an upsert-returning: when a
 * concurrent transaction has inserted the head but not yet committed, Postgres makes THIS
 * transaction's speculative insert wait on that other transaction and then do nothing once it
 * sees the conflict, so the re-select below runs only after the other transaction's outcome is
 * decided and observes the COMMITTED row rather than a row that might still roll back invisibly.
 * That ordering is why this is two statements rather than a single `... returning` that would
 * return nothing for a conflicting row and leave the caller with no head to act on.
 */
export async function lockChainHead(
  tx: Transaction,
  tenantId: TenantId,
  tillId: TillId,
): Promise<ChainHead> {
  const existing = await selectHeadForUpdate(tx, tenantId, tillId);
  if (existing !== undefined) return existing;

  await tx
    .insert(cadenas)
    .values({ tenantId, tillId })
    .onConflictDoNothing({ target: [cadenas.tenantId, cadenas.tillId] });

  const created = await selectHeadForUpdate(tx, tenantId, tillId);
  /* v8 ignore start */
  if (created === undefined) {
    // Unreachable in practice: the insert above either commits a fresh row or a concurrent
    // transaction's insert wins the conflict and commits one, and the re-select then locks
    // whichever row exists. Left in rather than asserted away because a NOT NULL narrowing here
    // is cheaper than a `!` that would hide a real defect behind a TypeError instead of an
    // AppError if this invariant were ever wrong.
    throw new AppError("chain.append_contention", { tenantId, tillId, attempts: 0 });
  }
  /* v8 ignore stop */
  return created;
}

async function attemptAppend(
  tx: Transaction,
  tenantId: TenantId,
  tillId: TillId,
  registro: PendingRegistro,
  sif?: SifRegistration,
): Promise<{ id: string; secuencia: number; huella: string }> {
  const head = await lockChainHead(tx, tenantId, tillId);
  // Chain identity is sif_id, resolved independently of `secuencia` — the two must never be
  // conflated (spec's own finding: secuencia is OUR outbox ordering aid, sif_id is which SIF
  // identity actually generated the record, and neither is derived from the other or from the
  // invoice counter).
  //
  // A caller that already fetched the SIF (recordSale/recordVoid) threads it in to avoid a second
  // currentSif round trip. It is stable across the append retry loop — SIF identity does not change
  // mid-append — so it is reused on every attempt. Guarded because a sif for a different (tenant,
  // till) would silently mis-attribute the record's sif_id: a programming error, so a plain Error.
  if (sif !== undefined && (sif.tenantId !== tenantId || sif.tillId !== tillId)) {
    throw new Error(
      `appendToChain: supplied SIF is for (${sif.tenantId}, ${sif.tillId}), not (${tenantId}, ${tillId})`,
    );
  }
  const resolvedSif = sif ?? (await currentSif(tx, tenantId, tillId));
  const secuencia = head.secuencia + 1;

  let encadenamiento: Encadenamiento;
  if (head.ultimoRegistroId === null) {
    // Start of chain. Both start-of-chain states are NORMAL: the huella is computed and stored
    // here exactly as it is for every other record, over an EMPTY predecessor huella.
    encadenamiento = { PrimerRegistro: "S" };
  } else {
    const [previous] = await tx
      .select({
        idEmisorFactura: registrosFacturacion.idEmisorFactura,
        numSerieFactura: registrosFacturacion.numSerieFactura,
        fechaExpedicionFactura: registrosFacturacion.fechaExpedicionFactura,
        huella: registrosFacturacion.huella,
      })
      .from(registrosFacturacion)
      .where(eq(registrosFacturacion.id, head.ultimoRegistroId));
    /* v8 ignore start */
    if (previous === undefined) {
      // Unreachable while `cadenas.ultimo_registro_id` only ever points at a row this same
      // package wrote: the FK to registros_facturacion(id) and that table's own immutability
      // (no DELETE, no UPDATE — Task 12) together guarantee a non-null pointer always resolves.
      throw new AppError("chain.append_contention", { tenantId, tillId, attempts: 0 });
    }
    /* v8 ignore stop */
    encadenamiento = { RegistroAnterior: pointerTo(previous) };
  }

  const record =
    registro.tipo === "alta"
      ? buildAltaRecord({ ...registro.input, Encadenamiento: encadenamiento })
      : buildAnulacionRecord({ ...registro.input, Encadenamiento: encadenamiento });

  const row = toRegistroRow(record, {
    tenantId,
    tillId,
    sifId: resolvedSif.id,
    saleId: registro.saleId,
    secuencia,
    offsetMinutes: registro.input.offsetMinutes,
    entorno: registro.entorno,
  });

  const [inserted] = await tx
    .insert(registrosFacturacion)
    .values(row)
    .returning({ id: registrosFacturacion.id });
  /* v8 ignore start */
  if (inserted === undefined) {
    throw new Error("registros_facturacion: insert returned no row");
  }
  /* v8 ignore stop */

  await tx
    .update(cadenas)
    .set({ secuencia, ultimoRegistroId: inserted.id, ultimaHuella: row.huella })
    .where(and(eq(cadenas.tenantId, tenantId), eq(cadenas.tillId, tillId)));

  return { id: inserted.id, secuencia, huella: row.huella };
}

/**
 * Appends one record to the (tenant, till) chain, in the caller's transaction.
 *
 * Each attempt runs inside a nested `tx.transaction()`, which Drizzle emits as
 * SAVEPOINT / RELEASE / ROLLBACK TO SAVEPOINT. That is not decoration: in Postgres a unique
 * violation aborts the WHOLE enclosing transaction, so without a savepoint the "retry" would
 * issue its next statement against a transaction that can only accept ROLLBACK — destroying the
 * sale already written alongside it in that same outer transaction. The savepoint confines the
 * abort to the failed attempt; the outer transaction, and whatever the caller already did in it,
 * survive to try again.
 *
 * Exhaustion throws the structured `AppError` declared in ./errors.ts, never a bare string — the
 * Global Constraint's requirement (spec §9) that anything reaching a till screen be translatable,
 * applied to exactly the failure a human most needs explained: a race that could not be resolved.
 *
 * Returns the inserted registro's own row `id` alongside `secuencia`/`huella` — added for
 * `VerifactuBackend.recordSale` (Task 16), which needs it for `FiscalRecordRef.recordId` and for
 * the `envios` sidecar row's `registro_id` foreign key. Backward compatible: every existing
 * caller in this package destructures only `{ secuencia }`/`{ huella }` off this return value, so
 * the extra field is additive.
 */
export async function appendToChain(
  tx: Transaction,
  tenantId: TenantId,
  tillId: TillId,
  registro: PendingRegistro,
  sif?: SifRegistration,
): Promise<{ id: string; secuencia: number; huella: string }> {
  for (let attempt = 1; attempt <= MAX_APPEND_ATTEMPTS; attempt++) {
    try {
      return await tx.transaction((nested) =>
        attemptAppend(nested, tenantId, tillId, registro, sif),
      );
    } catch (error) {
      if (!isUniqueViolation(error)) throw error;
    }
  }
  throw new AppError("chain.append_contention", {
    tenantId,
    tillId,
    attempts: MAX_APPEND_ATTEMPTS,
  });
}
