import { sql } from "drizzle-orm";
import { withTransaction } from "@waitron/db";
import type { Database, Transaction } from "@waitron/db";
import { recordIncident } from "@waitron/core";
import type { IncidentSeverity } from "@waitron/core";
import { emptyDrainResult, type DrainResult } from "@waitron/fiscal";
import { AppError, isAppError } from "@waitron/shared";
import type { SaleId, TillId } from "@waitron/shared";
import { MAX_REGISTROS_POR_ENVIO, resolveEstadoEfectivo } from "@waitron/verifactu";
import type {
  Cabecera,
  EnvioRegistro,
  EstadoEfectivo,
  RespuestaConsulta,
  RespuestaLinea,
  VerifactuClient,
  RegistroAlta,
} from "@waitron/verifactu";
import { writeAck } from "./acks.js";
import { decodeRegistroRow, fromRegistroRow, toAeatDate } from "./registro-row.js";
import type { Entorno, RegistroRow } from "./registro-row.js";

/**
 * The fake AEAT's own default (`FakeAeatOptions.tiempoEsperaInicial`, `@waitron/verifactu`): the
 * wait `t` assumed until AEAT has supplied a non-zero one.
 */
export const TIEMPO_ESPERA_INICIAL_SEG = 60;

/**
 * How long a row may sit `enviando` before a later pass treats it as abandoned. The claim commits
 * before the network call, so a crash leaves a real `enviando` row behind. Five minutes is well
 * above one AEAT round trip and well inside art. 16.4's hourly duty. A crashed run's claims are
 * requeued by `resetInFlightClaims` before the next drain of a restarted filing node
 * (`resetBeforeFirstDrain`, `apps/server/src/restart-reset.ts`).
 */
export const RECUPERACION_ENVIANDO_MS = 5 * 60_000;

/**
 * How long after a SKIPPED pass `drain` reports work is due again. Reporting `now` would pin a
 * host sleeping on `nextDueAt` at its minimum tick for as long as a certificate is missing; five
 * minutes still gives twelve retries inside art. 16.4's hour.
 *
 * No production caller: `apps/server` passes `config.skipRetryMs`, whose default comes from
 * `@waitron/scheduler`'s `DEFAULTS.skipRetryMs`, so editing this constant changes nothing deployed.
 */
export const DEFAULT_SKIP_RETRY_MS = 5 * 60 * 1000;

/** The first retry's wait, and the per-attempt doubling unit `backoffMs` scales from. */
export const BACKOFF_BASE_MS = 60_000;
/** The retry ceiling: a batch that keeps failing retries hourly, as art. 16.4 requires. */
export const BACKOFF_MAX_MS = 3_600_000;

/**
 * Exponential backoff for the `intentos`-th attempt. `intentos` is 1-indexed — `claimBatch`
 * returns it already incremented — so the first failure waits `BACKOFF_BASE_MS`.
 */
export function backoffMs(intentos: number): number {
  return Math.min(BACKOFF_MAX_MS, BACKOFF_BASE_MS * 2 ** Math.max(0, intentos - 1));
}

export interface DrainDeps {
  db: Database;
  /**
   * The venue's AEAT transport. A FUNCTION, not a fixed client, so the certificate is decrypted
   * only when this pass actually has something to send.
   */
  resolveClient: () => Promise<VerifactuClient>;
  /** How long after a skipped pass to report work due again. Required, so a caller that forgets
   * is a compile error rather than a silent cadence. */
  skipRetryMs: number;
  /**
   * Which deployment THIS host is draining for, compared per claimed row against the row's own
   * `entorno`. `claimBatch` refuses a row that disagrees or carries none: submitting a
   * pre-production record to the real AEAT is unrecoverable.
   */
  environment: Entorno;
  /**
   * The batch cap — the most registros claimed, submitted, and counted as a full envío per chunk.
   * Defaults to `MAX_REGISTROS_POR_ENVIO`, the XSD's 1000-row limit; production never sets it.
   * A test seam, so a suite can exercise the over-the-cap split without seeding 1000+ rows.
   */
  maxRegistrosPorEnvio?: number;
}

/** A due `envios` row joined to enough of its registro to rebuild and order it. */
type DueRow = RegistroRow & { intentos: number };

/**
 * Is there anything to send, read before the drain opens its own transaction? Lone stale claims
 * count, so `drainDue` can recover them even with no pending row.
 *
 * - `proximo_intento_en <= now` is INCLUSIVE, the same comparison `countDue` and `claimBatch`
 *   make, so this gate never opens on a row neither of them would claim.
 * - `enviado_en < now - RECUPERACION_ENVIANDO_MS` is STRICT, the same cutoff `recoverStaleClaims`
 *   computes, so a row this reports stale is a row that pass will recover.
 *
 * Timestamps are compared as TEXT, as everywhere in this file: the `ts` column writes
 * `Date.prototype.toISOString`, fixed-width UTC, so lexical order is chronological order.
 */
async function workIsDue(db: Database, now: Date): Promise<boolean> {
  const staleCutoff = new Date(now.getTime() - RECUPERACION_ENVIANDO_MS).toISOString();
  const rows = await db.execute<{ due: number }>(sql`
    select 1 as due from envios
    where (estado = 'pendiente' and proximo_intento_en <= ${now.toISOString()})
       or (estado = 'enviando' and enviado_en < ${staleCutoff})
    limit 1
  `);
  return rows.rows.length > 0;
}

export async function drain(deps: DrainDeps, now: Date): Promise<DrainResult> {
  const result = emptyDrainResult();
  // Out of range, the cap fails silently in SQL: `0` claims nothing, leaving work `pendiente`
  // forever, and a negative `limit` means no limit on this engine, building an envío over the
  // XSD's cap. A plain Error: this is caller misconfiguration, not a fiscal-domain outcome.
  if (deps.maxRegistrosPorEnvio !== undefined) {
    const cap = deps.maxRegistrosPorEnvio;
    if (!Number.isInteger(cap) || cap < 1 || cap > MAX_REGISTROS_POR_ENVIO) {
      throw new Error(
        `maxRegistrosPorEnvio must be an integer in 1..${MAX_REGISTROS_POR_ENVIO}, got ${cap}`,
      );
    }
  }
  const maxPorEnvio = deps.maxRegistrosPorEnvio ?? MAX_REGISTROS_POR_ENVIO;
  if (await workIsDue(deps.db, now)) {
    // Counted before `resolveClient`: a pass skipped for a missing certificate still had due work,
    // and the host's awaiting-certificate flag must tell that apart from a pass with none.
    result.tenantsWithWork += 1;
    try {
      const client = await deps.resolveClient();
      await drainDue(deps.db, client, deps.environment, now, result, maxPorEnvio);
    } catch (error) {
      // Contained: reported in `skipped` rather than thrown, so the host still schedules a retry.
      result.skipped.push({ errorCode: codeOf(error) });
    }
  }
  // A pass that failed before `drainDue` scheduled anything must still report a future instant,
  // or a long-running host stops polling while a `pendiente` row sits past its art. 16.4 hour.
  // Folded as a MINIMUM: `drainDue` may have folded an earlier instant (a backoff) before it
  // threw, and the retry instant must not delay it.
  if (result.skipped.length > 0) {
    bumpNextDue(result, new Date(now.getTime() + deps.skipRetryMs));
  }
  return result;
}

/**
 * Each chunk is claimed in its own short transaction (T1) that commits before the network call,
 * so the venue file's single writer slot is not held across `client.submit`. `client.submit` runs
 * outside any transaction; the response is persisted in a second short transaction (T2), or, if
 * `client.submit` or T2 throws, the batch is backed off in one instead. Route B's
 * `client.consultar` is the exception to the round-trip rule: it runs inside T2, so a failed
 * consulta rolls back the whole response and backs the batch off.
 *
 * AEAT's flow control: send when `TiempoEsperaEnvio` has elapsed since the last envío OR a full
 * envío has accumulated, whichever comes first.
 *
 *   - Gate (`envio_flujo.proximo_envio_en`) not yet elapsed AND fewer than `maxPorEnvio` rows due:
 *     nothing is sent; the backlog is deferred to the gate.
 *   - Otherwise the pass sends its first chunk, and keeps sending full chunks back to back while at
 *     least `maxPorEnvio` rows remain due. A sub-cap tail left after a chunk has gone is neither a
 *     full envío nor past the wait, so it is deferred to a later pass gated on `t`.
 */
async function drainDue(
  db: Database,
  client: VerifactuClient,
  environment: Entorno,
  now: Date,
  result: DrainResult,
  maxPorEnvio: number,
): Promise<void> {
  // Commits before anything else in this pass reads `envios`, so a recovered row is an ordinary
  // `pendiente` row to the later transactions.
  await withTransaction(db, (tx) => recoverStaleClaims(tx, now));

  const { flujo, dueCount0 } = await withTransaction(db, async (tx) => ({
    flujo: await readFlujo(tx),
    dueCount0: await countDue(tx, now),
  }));
  if (dueCount0 === 0) return;

  const gateOpen = flujo.proximoEnvioEn === null || flujo.proximoEnvioEn.getTime() <= now.getTime();
  if (!gateOpen && dueCount0 < maxPorEnvio) {
    bumpNextDue(result, flujo.proximoEnvioEn);
    return;
  }

  let t = flujo.tiempoEsperaSeg || TIEMPO_ESPERA_INICIAL_SEG;
  let dueCount = dueCount0;
  // Chains the environment guard refused anywhere in this pass, shared across every claim so a
  // later chunk does not re-discover (and re-incident) them. Fresh each pass, so a chain is
  // re-examined next time rather than assumed still blocked.
  const blockedSifIds = new Set<string>();
  while (dueCount > 0) {
    // Retried until something is sendable or nothing was claimed: a window can hold only rows of
    // chains the environment guard just blocked, and the growing `blockedSifIds` lets the next
    // SELECT reach past them. Bounded: each empty round either blocks a new chain or moves its rows
    // to `detenido` (`haltOpenChainClaims`), and the next SELECT sees neither.
    let claimed: { sendable: DueRow[]; rawCount: number };
    for (;;) {
      claimed = await withTransaction(db, async (tx) => {
        const c = await claimBatch(tx, now, environment, result, blockedSifIds, maxPorEnvio);
        const kept = await haltOpenChainClaims(tx, c.sendable, now, result);
        return { sendable: kept, rawCount: c.rawCount };
      });
      if (claimed.sendable.length > 0 || claimed.rawCount === 0) break;
    }
    const batch = claimed.sendable;
    // Only when the claim found nothing at all: the work `countDue` saw is gone by claim time.
    if (batch.length === 0) break;

    const cabecera = cabeceraFor(batch[0]!);
    const registros: EnvioRegistro[] = batch.map(toEnvioRegistro);
    try {
      const respuesta = await client.submit(cabecera, registros);

      dueCount = await withTransaction(db, async (tx) => {
        await persistResponse(tx, client, batch, respuesta, now, result);
        return countDue(tx, now);
      });
      t = respuesta.TiempoEsperaEnvio;
      if (dueCount < maxPorEnvio) break;
    } catch {
      // The claim is committed, so back the batch off rather than leave it stuck `enviando`, and
      // stop: each row's own `proximo_intento_en` schedules the retry.
      await withTransaction(db, (tx) => backoffBatch(tx, batch, now, result));
      break;
    }
  }

  const proximoEnvioEn = new Date(now.getTime() + t * 1000);
  await withTransaction(db, (tx) => upsertFlujo(tx, proximoEnvioEn, t));
  if (dueCount > 0) bumpNextDue(result, proximoEnvioEn);
}

/** Current flow-control state. No row yet means nothing was ever sent, so the gate reads open. */
async function readFlujo(
  tx: Transaction,
): Promise<{ proximoEnvioEn: Date | null; tiempoEsperaSeg: number }> {
  const rows = await tx.execute<{ proximo_envio_en: string; tiempo_espera_seg: number }>(sql`
    select proximo_envio_en, tiempo_espera_seg from envio_flujo
  `);
  const row = rows.rows[0];
  return row
    ? { proximoEnvioEn: new Date(row.proximo_envio_en), tiempoEsperaSeg: row.tiempo_espera_seg }
    : { proximoEnvioEn: null, tiempoEsperaSeg: 0 };
}

/** How many rows are due right now — the same predicate `claimBatch` runs. */
async function countDue(tx: Transaction, now: Date): Promise<number> {
  const rows = await tx.execute<{ count: number }>(sql`
    select count(*) as count from envios
    where estado = 'pendiente' and proximo_intento_en <= ${now.toISOString()}
  `);
  return rows.rows[0]!.count;
}

/** Upserts the one flow-control row: when the next envío may go, and the `t` that produced that
 * gate — persisted, never an in-memory timer. */
async function upsertFlujo(tx: Transaction, proximoEnvioEn: Date, t: number): Promise<void> {
  await tx.execute(sql`
    insert into envio_flujo (id, proximo_envio_en, tiempo_espera_seg)
    values (1, ${proximoEnvioEn.toISOString()}, ${t})
    on conflict (id) do update set
      proximo_envio_en = excluded.proximo_envio_en, tiempo_espera_seg = excluded.tiempo_espera_seg
  `);
}

/** Folds one instant into `result.nextDueAt` as a MINIMUM — the earliest instant `drain` needs
 * calling again. */
function bumpNextDue(result: DrainResult, at: Date | null): void {
  if (at === null) return;
  result.nextDueAt =
    result.nextDueAt === null ? at : new Date(Math.min(result.nextDueAt.getTime(), at.getTime()));
}

/**
 * Resets timed-out `enviando` rows back to `pendiente`, raising `incidencia` — the signal that this
 * record needed operator attention, even though it will most likely be resubmitted and accepted
 * within the same pass. Raises the flag only, never an `incidents` row.
 */
async function recoverStaleClaims(tx: Transaction, now: Date): Promise<void> {
  await requeueClaims(tx, now, new Date(now.getTime() - RECUPERACION_ENVIANDO_MS));
}

/**
 * The restart reset (topology design §5.2): every `enviando` row back to `pendiente`, due now, with
 * no staleness gate, raising `incidencia` as `recoverStaleClaims` does. Sound only before this
 * process's first drain pass and while no other process files from this database, so the host
 * calls it before that pass, and again only if that attempt failed. A resend of a record the
 * previous run had filed meets AEAT's duplicate check (error 3000): when AEAT reports its stored
 * copy `Correcta` or `AceptadaConErrores`, `resolveEstadoEfectivo` reads that as an accept and
 * `applyOutcome` marks the row `aceptado`, or `aceptado_con_errores` with a warning
 * `fiscal.aceptado_con_errores` incident, without comparing fingerprints; only an annulled or
 * unstated copy reaches `handleDuplicate`.
 */
export async function resetInFlightClaims(db: Database, now: Date): Promise<void> {
  await withTransaction(db, (tx) => requeueClaims(tx, now, null));
}

/** `enviando` rows back to `pendiente`, due `now`, with `incidencia` raised — only those claimed
 * before `claimedBefore` when one is given, every one when it is `null`. */
async function requeueClaims(
  tx: Transaction,
  now: Date,
  claimedBefore: Date | null,
): Promise<void> {
  const stale =
    claimedBefore === null ? sql.empty() : sql` and enviado_en < ${claimedBefore.toISOString()}`;
  await tx.execute(sql`
    update envios set estado = 'pendiente', incidencia = true, proximo_intento_en = ${now.toISOString()}
    where estado = 'enviando'${stale}
  `);
}

/**
 * Claim due pending rows → `enviando`, incrementing `intentos` and stamping `enviado_en` at claim
 * time — `enviado_en` is what `recoverStaleClaims` measures staleness from, and the returned
 * `intentos` is what `backoffBatch` computes this attempt's wait from.
 *
 * **What keeps a second drainer off these rows is THIS TRANSACTION, not a clause in the statement.**
 * `withTransaction` runs its body under `db.withWriteLock` (`packages/db/src/tenancy.ts`), whose
 * queue issues `begin immediate` (`packages/store/src/write-queue.ts`), so a second drainer does
 * not begin until the selection and its `enviando` stamp have committed together, and then matches
 * none of those rows. What that prevents is a DUPLICATE SUBMISSION of the same batch to AEAT, so
 * the SELECT and the stamp must stay inside one `withTransaction`, and the SELECT must stamp
 * nothing itself: most of the deployment-environment cases in `drain.test.ts` go red if it does.
 * A second PROCESS on this database is outside that: its restart reset, `resetInFlightClaims`,
 * assumes one process per venue database.
 *
 * **The deployment-environment guard.** Each row's own `entorno` is checked against this host's
 * `environment` before the stamp. A row that disagrees, or carries none, is left untouched and
 * `pendiente`, with an incident on this same transaction, and is never backed off: neither refusal
 * is a fact about AEAT's availability. `fiscal.environment_mismatch` releases when `WAITRON_ENV` is
 * corrected; `fiscal.environment_unknown` never does, because `registros_facturacion` is
 * append-only and a NULL `entorno` cannot be corrected in place — see `errors.ts`.
 *
 * `blockedSifIds` keeps chain order behind a refusal: a refused row's successors would otherwise
 * pass their own check and reach AEAT pointing at a huella AEAT never received. Once a row is
 * refused, every later row on its chain this pass is dropped with no second incident, and stays
 * `pendiente` rather than `detenido`, so a corrected `WAITRON_ENV` lets the next pass reclaim the
 * chain in order. The block lives only in this pass's memory, so another drainer cannot see it;
 * whether that gap is reachable on this engine is not established, and persisting the block is an
 * open design decision.
 *
 * The `sif_id not in (...)` exclusion stops a window filled by refused rows from coming back on
 * every retry, which would starve sendable work sorting behind it.
 */
async function claimBatch(
  tx: Transaction,
  now: Date,
  environment: Entorno,
  result: DrainResult,
  blockedSifIds: Set<string>,
  maxPorEnvio: number,
): Promise<{ sendable: DueRow[]; rawCount: number }> {
  const alreadyBlocked = blockedSifIds.size > 0 ? [...blockedSifIds] : null;
  const claimed = (
    await tx.execute<Record<string, unknown>>(sql`
    select r.*, e.intentos from envios e
    join registros_facturacion r on r.id = e.registro_id
    where e.estado = 'pendiente' and e.proximo_intento_en <= ${now.toISOString()}
      ${alreadyBlocked === null ? sql`` : sql`and r.sif_id not in ${alreadyBlocked}`}
    order by r.sif_id, r.secuencia
    limit ${maxPorEnvio}`)
  ).rows;
  // `r.*` reaches no drizzle column mapper, so the registro's JSON columns arrive as text and
  // `primer_registro` as `0`/`1` — see `decodeRegistroRow`. `e.intentos` is not this table's
  // column and passes through untouched.
  const rows = claimed.map((row) => decodeRegistroRow<DueRow>(row));

  const sendable: DueRow[] = [];
  for (const row of rows) {
    // A successor of a refusal found earlier in this same call; the SQL exclusion covers earlier
    // calls only.
    if (blockedSifIds.has(row.sif_id)) continue;

    const mismatch =
      row.entorno === null
        ? new AppError("fiscal.environment_unknown", {
            registroId: row.id,
            hostEnvironment: environment,
          })
        : row.entorno !== environment
          ? new AppError("fiscal.environment_mismatch", {
              registroId: row.id,
              recordEnvironment: row.entorno,
              hostEnvironment: environment,
            })
          : null;
    if (mismatch === null) {
      sendable.push(row);
    } else {
      blockedSifIds.add(row.sif_id);
      await raiseIncident(tx, row, "error", mismatch, now, result);
    }
  }

  if (sendable.length > 0) {
    const ids = sendable.map((r) => r.id);
    // drizzle expands an array parameter into an already-parenthesised list, so `in ${ids}` takes
    // no parentheses of its own.
    await tx.execute(sql`
      update envios set estado = 'enviando', enviado_en = ${now.toISOString()}, intentos = intentos + 1
      where registro_id in ${ids}
    `);
  }
  // The SELECT read `intentos` before the UPDATE incremented it. `rawCount` counts every row
  // claimed, so `drainDue` can tell "all refused, try past them" from "nothing left".
  return {
    sendable: sendable.map((r) => ({ ...r, intentos: r.intentos + 1 })),
    rawCount: rows.length,
  };
}

/**
 * A row `claimBatch` just claimed is redirected straight to `detenido` + `incidencia = true`, and
 * dropped from what is returned, if its own chain already carries an open `rechazado`/`detenido`
 * envío: submitting over that gap would submit out of chain order. Runs in the claim's own
 * transaction, so a row this catches never reaches `client.submit`.
 *
 * Successors pending at rejection time were already halted by `haltSuccessors`, so this catches
 * rows enqueued AFTER the rejection: AEAT's verdict never blocks a sale, so the chain keeps growing.
 *
 * No fresh `incidents` row: the rejection that opened the gap already raised one. A `halted` ack
 * is written per halted id, because this bulk UPDATE bypasses `setEstado`'s `writeAck`.
 */
async function haltOpenChainClaims(
  tx: Transaction,
  claimed: DueRow[],
  now: Date,
  result: DrainResult,
): Promise<DueRow[]> {
  if (claimed.length === 0) return claimed;
  const sifIds = [...new Set(claimed.map((row) => row.sif_id))];
  const open = await tx.execute<{ sif_id: string }>(sql`
    select distinct r.sif_id from envios e
    join registros_facturacion r on r.id = e.registro_id
    where r.sif_id in ${sifIds} and e.estado in ('rechazado', 'detenido')
  `);
  if (open.rows.length === 0) return claimed;
  const openSifIds = new Set(open.rows.map((row) => row.sif_id));

  const kept: DueRow[] = [];
  const haltedIds: string[] = [];
  for (const row of claimed) {
    if (openSifIds.has(row.sif_id)) {
      haltedIds.push(row.id);
    } else {
      kept.push(row);
    }
  }
  if (haltedIds.length > 0) {
    await tx.execute(sql`
      update envios set estado = 'detenido', incidencia = true where registro_id in ${haltedIds}
    `);
    for (const id of haltedIds) await writeAck(tx, id, now);
    result.recordsHalted += haltedIds.length;
  }
  return kept;
}

/**
 * Backs a failed batch off: `enviando` -> `pendiente`, `incidencia = true`, and each row's own
 * `proximo_intento_en` pushed out by `backoffMs(row.intentos)`. The whole batch is treated as
 * "retry later": there is no persisted response to read per-line outcomes from.
 */
async function backoffBatch(
  tx: Transaction,
  batch: DueRow[],
  now: Date,
  result: DrainResult,
): Promise<void> {
  for (const row of batch) {
    const next = new Date(now.getTime() + backoffMs(row.intentos));
    await tx.execute(sql`
      update envios set estado = 'pendiente', incidencia = true, proximo_intento_en = ${next.toISOString()}
      where registro_id = ${row.id}
    `);
    bumpNextDue(result, next);
  }
}

function toEnvioRegistro(row: RegistroRow): EnvioRegistro {
  const record = fromRegistroRow(row);
  // RefExterna is our registro id. Not a huella input, so safe to attach after hashing.
  if (row.tipo_registro === "anulacion") {
    return { RegistroAnulacion: { ...record, RefExterna: row.id } as never };
  }
  return { RegistroAlta: { ...(record as RegistroAlta), RefExterna: row.id } };
}

/** The obligado emisor is on every stored row (`nombre_razon_emisor`/`id_emisor_factura`). */
function cabeceraFor(row: RegistroRow): Cabecera {
  return { ObligadoEmision: { NombreRazon: row.nombre_razon_emisor, NIF: row.id_emisor_factura } };
}

/**
 * Resolves each response line via `resolveEstadoEfectivo` and matches it to its claimed row by
 * `RefExterna`.
 *
 * `halted` holds ids halted as a SUCCESSOR earlier in this same response. Lines are applied in
 * the order AEAT returned them, and AEAT's per-line verdict is chain-blind: a line reporting
 * "Correcto" for a successor of a record rejected in the same envío must not overwrite the halt
 * back to `aceptado`.
 */
async function persistResponse(
  tx: Transaction,
  client: VerifactuClient,
  batch: DueRow[],
  respuesta: Awaited<ReturnType<VerifactuClient["submit"]>>,
  now: Date,
  result: DrainResult,
): Promise<void> {
  result.batchesSent += 1;
  result.recordsSubmitted += batch.length;
  const csv = respuesta.CSV ?? null;
  const byId = new Map(batch.map((row) => [row.id, row]));
  const halted = new Set<string>();

  for (const linea of respuesta.RespuestaLinea) {
    // Skipped rather than thrown: one unmatched line must not roll back every other line of this
    // response. The skipped row stays `enviando` until `recoverStaleClaims` or a restart requeues it.
    const row = linea.RefExterna !== undefined ? byId.get(linea.RefExterna) : undefined;
    if (row === undefined) continue;
    if (halted.has(row.id)) continue;
    const efectivo = resolveEstadoEfectivo(linea);
    await applyOutcome(tx, client, row, efectivo, linea, csv, now, result, halted);
  }
}

/** Routes one resolved line to its estado transition + side effects. `halted` collects any
 * successor ids this call halts. */
async function applyOutcome(
  tx: Transaction,
  client: VerifactuClient,
  row: DueRow,
  efectivo: EstadoEfectivo,
  linea: RespuestaLinea,
  csv: string | null,
  now: Date,
  result: DrainResult,
  halted: Set<string>,
): Promise<void> {
  switch (efectivo) {
    case "accepted":
      // CSV is written in the SAME transaction as the response: AEAT never returns it again.
      // drain.test.ts's TEETH test fails if this write is dropped.
      await setEstado(tx, row.id, "aceptado", now, { csv, confirmadoEn: now });
      result.recordsAccepted += 1;
      return;
    case "accepted_with_errors": {
      // Still an accept: AEAT stored the record, and only a warning incident marks the difference.
      await setEstado(tx, row.id, "aceptado_con_errores", now, { csv, confirmadoEn: now });
      const codigo = linea.CodigoErrorRegistro ?? null;
      const mensaje = linea.DescripcionErrorRegistro ?? null;
      await raiseIncident(
        tx,
        row,
        "warning",
        new AppError("fiscal.aceptado_con_errores", { registroId: row.id, codigo, mensaje }),
        now,
        result,
      );
      result.recordsAccepted += 1;
      return;
    }
    case "rejected": {
      const codigo = linea.CodigoErrorRegistro ?? null;
      const mensaje = linea.DescripcionErrorRegistro ?? null;
      await setEstado(tx, row.id, "rechazado", now, {
        csv,
        codigoError: codigo,
        mensajeError: mensaje,
        incidencia: true,
      });
      await raiseIncident(
        tx,
        row,
        "error",
        new AppError("fiscal.registro_rechazado", { registroId: row.id, codigo, mensaje }),
        now,
        result,
      );
      const haltedIds = await haltSuccessors(tx, row, now);
      for (const id of haltedIds) halted.add(id);
      result.recordsHalted += 1 + haltedIds.length;
      return;
    }
    // duplicate_annulled / duplicate_unknown — error 3000; see `handleDuplicate`.
    default:
      await handleDuplicate(tx, client, row, efectivo, csv, now, result, halted);
  }
}

/**
 * Writes one row's estado transition. `csv` is REQUIRED: every branch has the envío's own CSV in
 * hand, since AEAT's CSV is per submission, not per line. `codigoError` is converted to text here
 * because `codigo_error` is a text column.
 */
async function setEstado(
  tx: Transaction,
  registroId: string,
  estado: string,
  now: Date,
  opts: {
    csv: string | null;
    confirmadoEn?: Date;
    codigoError?: number | null;
    mensajeError?: string | null;
    incidencia?: boolean;
  },
): Promise<void> {
  const codigoError =
    opts.codigoError !== undefined && opts.codigoError !== null ? String(opts.codigoError) : null;
  await tx.execute(sql`
    update envios set
      estado = ${estado},
      csv = ${opts.csv},
      confirmado_en = ${opts.confirmadoEn ? opts.confirmadoEn.toISOString() : null},
      codigo_error = ${codigoError},
      mensaje_error = ${opts.mensajeError ?? null},
      incidencia = ${opts.incidencia ? 1 : 0} or incidencia
    where registro_id = ${registroId}
  `);
  // The ack is written in the same transaction as the estado it reflects, so the two never
  // disagree. The bulk halt paths write their own.
  await writeAck(tx, registroId, now);
}

/**
 * Halts still-`pendiente`/`enviando` successors in the SAME chain (same `sif_id`, higher
 * `secuencia`) to `detenido`, flagging `incidencia`, so nothing later submits over the gap this
 * rejection opened. Returns the halted ids so `persistResponse` can skip their own lines in this
 * response. Writes a `halted` ack for each, because this bulk UPDATE bypasses `setEstado`.
 *
 * A subquery rather than `UPDATE ... FROM`, which this engine refused with an alias on the target
 * table.
 */
async function haltSuccessors(tx: Transaction, row: DueRow, now: Date): Promise<string[]> {
  const halted = await tx.execute<{ registro_id: string }>(sql`
    update envios set estado = 'detenido', incidencia = true
    where estado in ('pendiente', 'enviando')
      and registro_id in (
        select id from registros_facturacion
        where sif_id = ${row.sif_id} and secuencia > ${row.secuencia}
      )
    returning registro_id
  `);
  const haltedIds = halted.rows.map((r) => r.registro_id);
  for (const id of haltedIds) await writeAck(tx, id, now);
  return haltedIds;
}

/**
 * Raises a structured fiscal incident on THIS transaction, so an incident can never commit while
 * the estado update it describes rolls back.
 */
async function raiseIncident(
  tx: Transaction,
  row: DueRow,
  severity: IncidentSeverity,
  error: AppError,
  now: Date,
  result: DrainResult,
): Promise<void> {
  await recordIncident(tx, {
    tillId: row.till_id as TillId,
    saleId: row.sale_id as SaleId,
    error,
    severity,
    detectedAt: now,
  });
  result.incidentsRaised += 1;
}

/**
 * Route B (error 3000, `duplicate_unknown`): AEAT reported a duplicate without saying what it
 * holds, so a targeted consulta for this one record resolves it. Only the `Huella` is compared:
 * it already summarises every hashed field.
 *
 * `Ejercicio`/`Periodo` come from `fecha_expedicion_factura`: our records never carry a separate
 * `FechaOperacion`, so the operation month is the expedition month.
 */
async function routeB(client: VerifactuClient, row: DueRow): Promise<boolean> {
  const [ejercicio, periodo] = row.fecha_expedicion_factura.split("-");
  const respuesta: RespuestaConsulta = await client.consultar(
    { ObligadoEmision: { NombreRazon: row.nombre_razon_emisor, NIF: row.id_emisor_factura } },
    {
      Ejercicio: ejercicio,
      Periodo: periodo,
      NumSerieFactura: row.num_serie_factura,
      FechaExpedicionFactura: toAeatDate(row.fecha_expedicion_factura),
    },
  );
  const stored = respuesta.registros.find(
    (r) => r.IDFactura.NumSerieFactura === row.num_serie_factura,
  );
  return stored?.DatosRegistroFacturacion.Huella === row.huella;
}

/**
 * The two error-3000 duplicate cases:
 *
 *   - Route A (`duplicate_annulled`): AEAT's own copy of this identity is `Anulada`. This record
 *     can never become a confirmed accept under this identity, so it halts with its own incident
 *     rather than retrying forever.
 *   - Route B (`duplicate_unknown`): a matching huella means AEAT already holds OUR record, so it
 *     resolves to `aceptado`; reading it as a rejection would be wrong. A differing huella means
 *     the identity collided with something that is not our record, and it halts.
 *
 * Both halting outcomes also halt this chain's successors, as a rejection does: AEAT has not
 * confirmed the huella their `RegistroAnterior` points at.
 */
async function handleDuplicate(
  tx: Transaction,
  client: VerifactuClient,
  row: DueRow,
  efectivo: EstadoEfectivo,
  csv: string | null,
  now: Date,
  result: DrainResult,
  halted: Set<string>,
): Promise<void> {
  if (efectivo === "duplicate_annulled") {
    await setEstado(tx, row.id, "detenido", now, { csv, incidencia: true });
    await raiseIncident(
      tx,
      row,
      "error",
      new AppError("fiscal.duplicado_anulado", { registroId: row.id }),
      now,
      result,
    );
    const haltedIds = await haltSuccessors(tx, row, now);
    for (const id of haltedIds) halted.add(id);
    result.recordsHalted += 1 + haltedIds.length;
    return;
  }

  // duplicate_unknown -> Route B: consult, compare huella.
  const matched = await routeB(client, row);
  if (matched) {
    await setEstado(tx, row.id, "aceptado", now, { csv, confirmadoEn: now });
    result.recordsAccepted += 1;
    return;
  }
  await setEstado(tx, row.id, "detenido", now, { csv, incidencia: true });
  await raiseIncident(
    tx,
    row,
    "error",
    new AppError("fiscal.huella_divergente", { registroId: row.id }),
    now,
    result,
  );
  const haltedIds = await haltSuccessors(tx, row, now);
  for (const id of haltedIds) halted.add(id);
  result.recordsHalted += 1 + haltedIds.length;
}

/** A structured code, never prose: the AppError's own code, or the literal "unknown". The same
 * convention `@waitron/scheduler`'s `run.ts` and `reconcilePayments`'s `remediate()` both use. */
function codeOf(error: unknown): string {
  return isAppError(error) ? error.code : "unknown";
}
