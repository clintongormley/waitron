// Side-effect only: registers this package's error codes on the shared `ErrorParams` registry.
import "./errors.js";
import { eq } from "drizzle-orm";
import { recordIncident } from "@waitron/core";
import { AppError } from "@waitron/shared";
import type { NodeId, SaleId, TillId } from "@waitron/shared";
import { isUniqueViolation, type Transaction } from "@waitron/db";
import type { AltaInput, AnulacionInput, Encadenamiento } from "@waitron/verifactu";
import { buildAltaRecord, buildAnulacionRecord, validate } from "@waitron/verifactu";
import { currentSif } from "./registro-sif.js";
import type { SifRegistration } from "./registro-sif.js";
import { pointerTo, toRegistroRow } from "./registro-row.js";
import type { Entorno } from "./registro-row.js";
import { cadenas } from "./schema/cadenas.js";
import { registrosFacturacion } from "./schema/registros.js";

/**
 * Three, not one and not ten. One is not a retry. Ten converts a genuine duplicate — a real bug,
 * or a second process writing the same position by some path that does not go through the venue
 * file's write queue — into ten pointless round trips before the same failure.
 *
 * The chain's guarantee is the unique index on the position, not any lock: it refuses a forked
 * position whatever wrote it, including a writer that never went through this file.
 */
const MAX_APPEND_ATTEMPTS = 3;

/**
 * Inputs for one record, MINUS `Encadenamiento` — the huella depends on the predecessor, which is
 * unknown until `appendToChain` reads the chain head.
 *
 * `saleId`, `tillId` and `entorno` are this package's own metadata, not AEAT fields, so they
 * travel beside `input`, never inside it: `input` is the one arm that reaches
 * `buildAltaRecord`/`buildAnulacionRecord` and, from there, `computeHuella`, and none of the three
 * may ever be hashed. The chain KEY is the node (`appendToChain`'s parameter); `till_id` is an
 * informational snapshot of where the sale rang.
 */
export type PendingRegistro =
  | {
      tipo: "alta";
      saleId: SaleId;
      tillId: TillId;
      entorno: Entorno;
      input: Omit<AltaInput, "Encadenamiento">;
    }
  | {
      tipo: "anulacion";
      saleId: SaleId;
      tillId: TillId;
      entorno: Entorno;
      input: Omit<AnulacionInput, "Encadenamiento">;
    };

export interface ChainHead {
  secuencia: number;
  ultimoRegistroId: string | null;
  ultimaHuella: string | null;
}

/**
 * This node's chain head, or `undefined` when it has none yet.
 *
 * No row lock: the sequence read here decides the next position several statements later, and
 * that is safe because one write transaction runs on the venue file at a time (the pattern is
 * stated on `assertExtraListForWrite`, `packages/catalogue/src/extras.ts`). What refuses a forked
 * position whatever wrote it is `registros_facturacion`'s unique index on the chain position.
 */
async function selectHead(tx: Transaction, nodeId: NodeId): Promise<ChainHead | undefined> {
  const [row] = await tx
    .select({
      secuencia: cadenas.secuencia,
      ultimoRegistroId: cadenas.ultimoRegistroId,
      ultimaHuella: cadenas.ultimaHuella,
    })
    .from(cadenas)
    .where(eq(cadenas.nodeId, nodeId));
  return row;
}

/**
 * This node's chain head, creating it if this is a fresh node.
 *
 * Exported separately from `appendToChain` because art. 7.i verification (`verifyChain`) must read
 * the last two records in the SAME transaction as the append — a verification that examines a
 * predecessor another writer is concurrently replacing has verified nothing.
 *
 * Insert-then-re-select, not one statement: `on conflict do nothing ... returning` gives nothing
 * back for a conflicting row.
 */
export async function readChainHead(tx: Transaction, nodeId: NodeId): Promise<ChainHead> {
  const existing = await selectHead(tx, nodeId);
  if (existing !== undefined) return existing;

  await tx
    .insert(cadenas)
    .values({ nodeId })
    .onConflictDoNothing({ target: [cadenas.nodeId] });

  const created = await selectHead(tx, nodeId);
  /* v8 ignore start */
  if (created === undefined) {
    // Unreachable: the insert either wrote the row or found one there. Thrown rather than a `!`
    // so a broken invariant surfaces as an AppError, not a TypeError.
    throw new AppError("chain.append_contention", { nodeId, attempts: 0 });
  }
  /* v8 ignore stop */
  return created;
}

async function attemptAppend(
  tx: Transaction,
  nodeId: NodeId,
  registro: PendingRegistro,
  sif?: SifRegistration,
): Promise<{ id: string; secuencia: number; huella: string }> {
  const head = await readChainHead(tx, nodeId);
  // Chain identity is sif_id, resolved independently of `secuencia`: secuencia is OUR outbox
  // ordering aid, sif_id is which SIF identity generated the record, and neither is derived from
  // the other or from the invoice counter.
  //
  // A SIF supplied by the caller is reused on every attempt. A SIF for a different node would
  // silently mis-attribute the record's sif_id: a programming error, so a plain Error.
  if (sif !== undefined && sif.nodeId !== nodeId) {
    throw new Error(`appendToChain: supplied SIF is for node ${sif.nodeId}, not ${nodeId}`);
  }
  const resolvedSif = sif ?? (await currentSif(tx, nodeId));
  const secuencia = head.secuencia + 1;

  let encadenamiento: Encadenamiento;
  if (head.ultimoRegistroId === null) {
    // Start of chain: the huella is computed as for every other record, over an EMPTY predecessor
    // huella.
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
      // Unreachable: the FK to registros_facturacion(id) and that table's append-only triggers
      // mean a non-null `cadenas.ultimo_registro_id` always resolves.
      throw new AppError("chain.append_contention", { nodeId, attempts: 0 });
    }
    /* v8 ignore stop */
    encadenamiento = { RegistroAnterior: pointerTo(previous) };
  }

  const record =
    registro.tipo === "alta"
      ? buildAltaRecord({ ...registro.input, Encadenamiento: encadenamiento })
      : buildAnulacionRecord({ ...registro.input, Encadenamiento: encadenamiento });

  // Refuse a record AEAT could not accept BEFORE it reaches the append-only table. This is the one
  // seam every record type passes through (alta and anulación, so sale, void, correction and
  // substitution alike), and the first moment the COMPLETE record exists — the chain pointer and
  // the huella are filled in above — so what is checked is what will be stored.
  //
  // Only error severity REFUSES. `validate`'s warnings are the amount cross-checks, which AEAT
  // accepts under its own ±10.00 tolerance; blocking a sale for one would refuse a record the
  // authority would have taken. They are raised as an incident after the insert below.
  const issues = validate(record);
  const blocking = issues.filter((issue) => issue.severity === "error");
  if (blocking.length > 0) {
    throw new AppError("fiscal.record_invalid", {
      fields: blocking.map((issue) => issue.field),
      codes: blocking.map((issue) => issue.code),
    });
  }

  const row = toRegistroRow(record, {
    tillId: registro.tillId,
    nodeId,
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
    .where(eq(cadenas.nodeId, nodeId));

  // A warning does not block: AEAT accepts these under its own tolerance. But our totals
  // disagreeing with our own VAT lines is a bug in the money while the venue keeps selling, so it
  // is raised where a human can find it rather than left in a log line.
  //
  // On the caller's transaction: an incident that committed while its sale rolled back would
  // report a failure for a sale that never existed.
  const warnings = issues.filter((issue) => issue.severity === "warning");
  if (warnings.length > 0) {
    await recordIncident(tx, {
      tillId: registro.tillId,
      saleId: registro.saleId,
      error: new AppError("fiscal.record_totals_disagree", {
        fields: warnings.map((issue) => issue.field),
        codes: warnings.map((issue) => issue.code),
      }),
      severity: "warning",
      // The record's own generation instant, never `new Date()`: a wall-clock read here would
      // stamp an incident at an instant nothing else in the transaction shares.
      detectedAt: registro.input.generadoEn,
    });
  }

  return { id: inserted.id, secuencia, huella: row.huella };
}

/**
 * Appends one record to the node's chain, in the caller's transaction.
 *
 * Each attempt runs inside a nested `tx.transaction()`, which the adapter emits as a savepoint
 * because a transaction is already open (`packages/store/src/node-sqlite-adapter.ts`). SQLite backs
 * out a refused STATEMENT and leaves the transaction open (`bench/sqlite-failover/README.md`), so
 * the savepoint is not there to rescue the transaction: it confines a losing attempt's own writes,
 * undoing whatever it wrote BEFORE the refused statement so the next attempt starts from the
 * caller's state.
 *
 * Exhaustion throws a structured `AppError`, never a bare string, so a till screen can translate it.
 */
export async function appendToChain(
  tx: Transaction,
  nodeId: NodeId,
  registro: PendingRegistro,
  sif?: SifRegistration,
): Promise<{ id: string; secuencia: number; huella: string }> {
  for (let attempt = 1; attempt <= MAX_APPEND_ATTEMPTS; attempt++) {
    try {
      return await tx.transaction((nested) => attemptAppend(nested, nodeId, registro, sif));
    } catch (error) {
      if (!isUniqueViolation(error)) throw error;
    }
  }
  throw new AppError("chain.append_contention", { nodeId, attempts: MAX_APPEND_ATTEMPTS });
}
