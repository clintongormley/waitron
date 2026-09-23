// Side-effect only: registers this package's `chain.*` code on the shared `ErrorParams` registry
// by declaration merging. See ./errors.ts for the code and the reasoning, and
// ./errors.reachability.test.ts for the mechanical check that keeps errors.ts reachable from this
// package's own public barrel (index.ts). Mirrors ./registro-sif.ts's identical convention of
// importing from the file that documents the code a module throws.
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
 * What the retry is FOR narrowed when the engine changed. It used to cover the window in which two
 * writers race to create a chain head that does not exist yet and so cannot be locked; one write
 * transaction runs on the file at a time now, so there is no such race to cover. It is kept
 * because the chain's actual guarantee is the unique index on the position, not any lock, and that
 * index refuses a forked position whatever wrote it — including a writer that never went through
 * this file. Keeping the loop means such a collision is retried once or twice before it is
 * reported, rather than reaching a till screen on the first attempt.
 */
const MAX_APPEND_ATTEMPTS = 3;

/**
 * Inputs for one record, MINUS `Encadenamiento` — the huella depends on the predecessor, which is
 * unknown until the chain head is locked, so a fully-built `AltaInput`/`AnulacionInput` cannot
 * exist before `appendToChain` runs. `saleId` travels alongside rather than living inside `input`:
 * it is this package's own foreign key onto core's `sales`, not an AEAT field, and keeping it out
 * of the arm that becomes `buildAltaRecord`/`buildAnulacionRecord`'s parameter stops it from ever
 * being accidentally hashed. `saleId` and `tillId` are the BRANDED ids, not bare strings: every
 * caller already holds genuine branded values, so typing them here drops two unchecked casts at the
 * row insert. A brand is structurally still a string, so the never-inside-`input`, never-hashed
 * property above is untouched by it — the brand narrows what may be assigned in, nothing else.
 *
 * `tillId` travels the same way, and for the same reason it is a real column: the immutable
 * `registros_facturacion.till_id` is an informational SNAPSHOT of where the sale rang (node-id
 * rekey, 2026-08-03). The chain KEY is the node (`appendToChain`'s parameter); `till_id` is a fact
 * about the sale, so it rides on the `PendingRegistro` beside `saleId`, never inside `input` — it
 * is not an AEAT field and must never reach `computeHuella`.
 *
 * `entorno` travels the identical way, for the identical reason: which environment the caller
 * (`VerifactuBackend`) is generating this record for is this package's own metadata, never AEAT's,
 * so it lives beside `saleId` rather than inside `input` — the one arm that ever reaches
 * `buildAltaRecord`/`buildAnulacionRecord` and, from there, `computeHuella`.
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
 * This was `selectHeadForUpdate` and it took `for update` on the head row: the sequence number
 * read here decides the NEXT one several statements later, so a second append reading the same
 * head would compute the same position. There is no second append to overlap with — one write
 * transaction runs on the venue file at a time, and the pattern is stated once, with its
 * measurement and its control, on `assertExtraListForWrite`
 * (`packages/catalogue/src/extras.ts`). Drizzle's SQLite query builder has no `.for()` at all.
 * Renamed with the clause: a function named for a lock it does not take is a false claim.
 *
 * The lock was never the chain's safety. `registros_facturacion`'s unique index on the chain
 * position is, and it refuses a forked position whatever wrote it — which the `rejects a second
 * record claiming an occupied chain position` case in `chain.test.ts` proves by inserting the fork
 * WITHOUT going through this file.
 *
 * `packages/workforce/src/chain.ts` made the same change for the working-time chain, and its
 * `selectHead` is the sibling of this one.
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
 * the last two records in the SAME transaction — a verification that examines a predecessor
 * another writer is concurrently replacing has verified nothing. That requirement is unchanged;
 * what satisfies it is now the transaction itself rather than a row lock inside it, because one
 * write transaction runs on the venue file at a time ({@link selectHead}).
 *
 * `insert ... on conflict do nothing` then a re-select, not an upsert-returning. On PostgreSQL that
 * shape was about a concurrent uncommitted insert; here it is the plain read-back of whichever row
 * exists, and it is still two statements because a single `... returning` gives nothing back for a
 * conflicting row and would leave the caller with no head to act on.
 *
 * This was `lockChainHead` and it took no lock of its own — {@link selectHead} did, and that clause
 * is gone for the reason stated there. Renamed with it, the same way
 * `packages/workforce/src/chain.ts` renamed its own.
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
    // Unreachable in practice: the insert above either commits a fresh row or finds one already
    // there, and the re-select then reads whichever exists. Left in rather than asserted away
    // because a NOT NULL narrowing here
    // is cheaper than a `!` that would hide a real defect behind a TypeError instead of an
    // AppError if this invariant were ever wrong.
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
  // Chain identity is sif_id, resolved independently of `secuencia` — the two must never be
  // conflated (spec's own finding: secuencia is OUR outbox ordering aid, sif_id is which SIF
  // identity actually generated the record, and neither is derived from the other or from the
  // invoice counter).
  //
  // A caller that already fetched the SIF (recordSale/recordVoid) threads it in to avoid a second
  // currentSif round trip. It is stable across the append retry loop — SIF identity does not change
  // mid-append — so it is reused on every attempt. Guarded because a sif for a different node would
  // silently mis-attribute the record's sif_id: a programming error, so a plain Error.
  if (sif !== undefined && sif.nodeId !== nodeId) {
    throw new Error(`appendToChain: supplied SIF is for node ${sif.nodeId}, not ${nodeId}`);
  }
  const resolvedSif = sif ?? (await currentSif(tx, nodeId));
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
  // Error severity only REFUSES. `validate`'s two warnings are the amount cross-checks, which AEAT
  // accepts under its own ±10.00 tolerance (see validate.ts above CUOTA_TOTAL_MISMATCH); blocking a
  // sale for one would refuse a record the authority would have taken. They are not discarded
  // either — they are raised as an incident after the insert below, which is why `issues` is kept
  // whole here rather than filtered in place.
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
  // AFTER the insert, not before: a losing attempt never reaches this line, so a record that was
  // retried raises one incident rather than one per attempt. (Either placement would be discarded
  // with the savepoint on a rollback — that is the savepoint's doing, not this ordering's.) On the
  // caller's transaction, like every other `recordIncident` caller — an incident that committed
  // while its sale rolled back would report a failure for a sale that never existed.
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
      // The record's own generation instant (`RecordInputBase.generadoEn`) — never `new Date()`.
      // `backend.ts` fills it on all four call sites without ever reading a wall clock: one takes
      // its own injected clock directly (`recordVoid`'s `now.instant`) and the other three take the
      // caller's `sale.issuedAt`, which `packages/core` derived from ITS injected clock
      // (`record-sale.ts`'s `now.instant`). Every other `detectedAt:` in production code is fed a
      // clock the same way, and one wall-clock read here would stamp an incident at an instant
      // nothing else in the transaction shares.
      detectedAt: registro.input.generadoEn,
    });
  }

  return { id: inserted.id, secuencia, huella: row.huella };
}

/**
 * Appends one record to the node's chain, in the caller's transaction.
 *
 * Each attempt runs inside a nested `tx.transaction()`. A request reaches here with a transaction
 * already open on the connection — `withTransaction` runs inside the `begin immediate` that
 * `packages/store/src/write-queue.ts` took — so the adapter emits that nested call as
 * SAVEPOINT / RELEASE / ROLLBACK TO rather than as a BEGIN
 * (`packages/store/src/node-sqlite-adapter.ts`, which is also where the two halves are proven).
 *
 * The savepoint's REASON is not PostgreSQL's any more, and the difference matters to anyone
 * reading this loop. PostgreSQL aborted the whole enclosing transaction on a unique violation, so
 * the savepoint was what kept the transaction usable at all. SQLite backs out the refused
 * STATEMENT and leaves the transaction open — its own words about ABORT, its default conflict
 * resolution, quoted with a probe and a control in `bench/sqlite-failover/README.md` under "What
 * S5 measures, and the savepoint it does not need", and confirmed again here on node v26.7.0
 * against a transaction that committed the rows written either side of a refusal.
 *
 * What the savepoint still does is undo whatever a losing attempt wrote BEFORE the statement that
 * was refused, so the next attempt starts from the state the caller's transaction was in rather
 * than from a half-finished attempt. It no longer rescues a transaction that can only accept
 * ROLLBACK, because on this engine there is no such state to rescue.
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
