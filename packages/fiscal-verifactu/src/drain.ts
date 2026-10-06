import { sql, type SQL } from "drizzle-orm";
import { withTransaction } from "@waitron/db";
import type { Database, Transaction } from "@waitron/db";
import { recordIncident } from "@waitron/core";
import type { IncidentSeverity } from "@waitron/core";
import { emptyDrainResult, type DrainResult } from "@waitron/fiscal";
import { AppError, isAppError, jobOrigin } from "@waitron/shared";
import type { SaleId } from "@waitron/shared";
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
import { deleteAck, writeAck } from "./acks.js";
import { openFilingCase, type FilingCaseCause } from "./filing-cases.js";
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
const MAX_CONSULTA_PAGES = 10;

/** How many records immediately before a never-sent record on its chain must all be refused
 * with one code for `haltOpenChainClaims` to hold it. A record still awaiting its answer among
 * them breaks the run. The held chain's first record is sent hourly (`claimProbes`), and the hold
 * is lifted once that send breaks the run (`releaseSettledBrakeHolds`). */
export const SAME_CODE_REFUSAL_LIMIT = 3;

/** The first retry's wait, and the per-attempt doubling unit `backoffMs` scales from. */
export const BACKOFF_BASE_MS = 60_000;
/** The retry ceiling: a batch that keeps failing retries hourly, as art. 16.4 requires. */
export const BACKOFF_MAX_MS = 3_600_000;

/** How long after a brake-held chain's last send its first held record is sent again
 * (`claimProbes`). */
export const BRAKE_PROBE_INTERVAL_MS = BACKOFF_MAX_MS;

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

/** A due `envios` row joined to enough of its registro to rebuild and order it. `probe` marks a
 * brake-held record `claimProbes` sent while it stays `detenido`, with the code of the run that
 * holds it. */
type DueRow = RegistroRow & { intentos: number; probe?: { runCode: string } };

/** Anything `execute` reads on: a transaction, or the database outside one. */
type Reader = Pick<Transaction, "execute">;

/**
 * Is there anything to send, read before the drain opens its own transaction? Lone stale claims
 * count, so `drainDue` can recover them even with no pending row, and so does a brake hold
 * `drainDue` would release.
 *
 * - `proximo_intento_en <= now` is INCLUSIVE. A due successor can still wait for an earlier
 *   record's retry or in-flight answer.
 * - `enviado_en < now - RECUPERACION_ENVIANDO_MS` is STRICT, the same cutoff `recoverStaleClaims`
 *   computes, so a row this reports stale is a row that pass will recover.
 *
 * Timestamps are compared as TEXT, as everywhere in this file: the `ts` column writes
 * `Date.prototype.toISOString`, fixed-width UTC, so lexical order is chronological order.
 */
async function workIsDue(db: Database, now: Date, environment: Entorno): Promise<boolean> {
  const staleCutoff = new Date(now.getTime() - RECUPERACION_ENVIANDO_MS).toISOString();
  const rows = await db.execute<{ due: number }>(sql`
    select (exists (
      select 1 from envios
      where (estado = 'pendiente' and proximo_intento_en <= ${now.toISOString()})
         or (estado = 'enviando' and enviado_en < ${staleCutoff})
    ) or exists (${dueProbes(now, environment)}) or exists (${releasableHeads()})) as due
  `);
  return rows.rows[0]!.due === 1;
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
  if (await workIsDue(deps.db, now, deps.environment)) {
    // Counted before `resolveClient`: a pass skipped for a missing certificate still had due work,
    // and the host's awaiting-certificate flag must tell that apart from a pass with none.
    result.tenantsWithWork += 1;
    try {
      const client = await deps.resolveClient();
      await drainDue(deps.db, client, deps.environment, now, result, maxPorEnvio, deps.skipRetryMs);
      bumpNextDue(result, await nextProbeAt(deps.db, now, deps.environment));
    } catch (error) {
      // Contained: reported in `skipped` rather than thrown, so the host still schedules a retry.
      result.skipped.push({ errorCode: codeOf(error) });
    }
  } else {
    bumpNextDue(result, await nextProbeAt(deps.db, now, deps.environment));
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
 * so the venue file's single writer slot is not held across an AEAT round trip. `client.submit`
 * and Route B's `client.consultar` lookups run outside any transaction; the response is persisted
 * in a second short transaction (T2), or, if `client.submit` or T2 throws, the batch is backed off
 * in one instead.
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
  skipRetryMs: number,
): Promise<void> {
  // Commits before anything else in this pass reads `envios`, so a recovered row is an ordinary
  // `pendiente` row to the later transactions.
  await withTransaction(db, async (tx) => {
    await recoverStaleClaims(tx, now);
    await releaseSettledBrakeHolds(tx, now);
  });

  const { flujo, dueCount0 } = await withTransaction(db, async (tx) => ({
    flujo: await readFlujo(tx),
    dueCount0: await countDue(tx, now, environment),
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
      claimed = await countOnCommit(db, result, async (tx, counts) => {
        const c = await claimBatch(tx, now, environment, counts, blockedSifIds, maxPorEnvio);
        const kept = await haltOpenChainClaims(tx, c.sendable, now, counts);
        const probes = await claimProbes(tx, now, environment, maxPorEnvio - kept.length);
        return { sendable: [...kept, ...probes], rawCount: c.rawCount };
      });
      if (claimed.sendable.length > 0 || claimed.rawCount === 0) break;
    }
    const batch = claimed.sendable;
    // Due work can wait for an earlier retry or an unresolved original invoice.
    if (batch.length === 0) {
      const next = await withTransaction(db, (tx) => nextClaimOpportunity(tx, now, environment));
      bumpNextDue(result, next ?? new Date(now.getTime() + skipRetryMs));
      if (result.batchesSent === 0) return;
      break;
    }

    const cabecera = cabeceraFor(batch[0]!);
    const registros: EnvioRegistro[] = batch.map(toEnvioRegistro);
    try {
      const respuesta = await client.submit(cabecera, registros);
      // Counted as soon as AEAT has answered: the envío was sent whether or not its reply is kept.
      result.batchesSent += 1;
      result.recordsSubmitted += batch.length;
      const lines = await resolveLines(client, batch, respuesta);

      dueCount = await countOnCommit(db, result, async (tx, counts) => {
        await persistResponse(tx, batch, lines, respuesta.CSV ?? null, now, counts);
        return countDue(tx, now, environment);
      });
      // `@waitron/verifactu` leaves the wait undefined when AEAT's reply has no usable one. The
      // reply above is saved either way; nothing more is sent this pass, and the gate keeps the
      // last wait AEAT did give, or `TIEMPO_ESPERA_INICIAL_SEG` when none is stored or the stored
      // one is 0.
      if (respuesta.TiempoEsperaEnvio === undefined) break;
      t = respuesta.TiempoEsperaEnvio;
      if (dueCount < maxPorEnvio) break;
    } catch {
      // The claim is committed, so back the batch off rather than leave it stuck `enviando`, and
      // stop: each row's own `proximo_intento_en` schedules the retry.
      await countOnCommit(db, result, (tx, counts) => backoffBatch(tx, batch, now, counts));
      break;
    }
  }

  const proximoEnvioEn = new Date(now.getTime() + t * 1000);
  await withTransaction(db, (tx) => upsertFlujo(tx, proximoEnvioEn, t));
  if (dueCount > 0) bumpNextDue(result, proximoEnvioEn);
}

/** Exactly the fields `countOnCommit` copies back: a body cannot write one it would drop. */
type CommittedCounts = Pick<
  DrainResult,
  "recordsAccepted" | "recordsHalted" | "incidentsRaised" | "nextDueAt"
>;

/**
 * Runs `body` in its own transaction against a scratch result, and adds the scratch's outcome
 * counts and next-due instant to `result` only once that transaction has committed, so a pass
 * whose transaction rolled back does not report as kept an outcome, hold or incident it wrote.
 */
async function countOnCommit<T>(
  db: Database,
  result: DrainResult,
  body: (tx: Transaction, counts: CommittedCounts) => Promise<T>,
): Promise<T> {
  const counts: CommittedCounts = emptyDrainResult();
  const value = await withTransaction(db, (tx) => body(tx, counts));
  result.recordsAccepted += counts.recordsAccepted;
  result.recordsHalted += counts.recordsHalted;
  result.incidentsRaised += counts.incidentsRaised;
  bumpNextDue(result, counts.nextDueAt);
  return value;
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

/** How many rows are due now, including successors held behind an earlier retry, and the probes
 * due now. */
async function countDue(tx: Transaction, now: Date, environment: Entorno): Promise<number> {
  const rows = await tx.execute<{ count: number }>(sql`
    select (
      select count(*) from envios
      where estado = 'pendiente' and proximo_intento_en <= ${now.toISOString()}
    ) + (select count(*) from (${dueProbes(now, environment)})) as count
  `);
  return rows.rows[0]!.count;
}

async function nextClaimOpportunity(
  tx: Transaction,
  now: Date,
  environment: Entorno,
): Promise<Date | null> {
  const rows = await tx.execute<{ next_retry: string | null; oldest_claim: string | null }>(sql`
    select
      min(case when estado = 'pendiente' and proximo_intento_en > ${now.toISOString()}
        then proximo_intento_en end) as next_retry,
      min(case when estado = 'enviando' then enviado_en end) as oldest_claim
    from envios
  `);
  const row = rows.rows[0];
  const candidates = [
    row?.next_retry ? new Date(row.next_retry).getTime() : null,
    row?.oldest_claim ? new Date(row.oldest_claim).getTime() + RECUPERACION_ENVIANDO_MS + 1 : null,
    (await nextProbeAt(tx, now, environment))?.getTime() ?? null,
  ].filter((value): value is number => value !== null);
  return candidates.length > 0 ? new Date(Math.min(...candidates)) : null;
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
function bumpNextDue(result: CommittedCounts, at: Date | null): void {
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
 * previous run had filed meets AEAT's duplicate check (error 3000); the drainer checks the stored
 * fingerprint before treating that reply as confirmation of our record.
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
  result: CommittedCounts,
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
      -- A cancellation can alter the authority's row under this invoice key before our original's
      -- duplicate reply reveals that the row belongs to someone else.
      and (r.tipo_registro != 'anulacion' or exists (
        select 1 from registros_facturacion original
        join envios original_envio on original_envio.registro_id = original.id
        where original.tipo_registro = 'alta'
          and original.sif_id = r.sif_id
          and original.id_emisor_factura = r.id_emisor_factura
          and original.num_serie_factura = r.num_serie_factura
          and original.fecha_expedicion_factura = r.fecha_expedicion_factura
          and original_envio.estado in ('aceptado', 'aceptado_con_errores', 'rechazado', 'detenido')
      ))
      and not exists (
        select 1 from envios earlier
        join registros_facturacion prior on prior.id = earlier.registro_id
        where prior.sif_id = r.sif_id and prior.secuencia < r.secuencia
          and (earlier.estado = 'enviando'
            or (earlier.estado = 'pendiente' and (
              earlier.proximo_intento_en > ${now.toISOString()}
              or (prior.tipo_registro = 'anulacion' and not exists (
                select 1 from registros_facturacion prior_original
                join envios prior_original_envio on prior_original_envio.registro_id = prior_original.id
                where prior_original.tipo_registro = 'alta'
                  and prior_original.sif_id = prior.sif_id
                  and prior_original.id_emisor_factura = prior.id_emisor_factura
                  and prior_original.num_serie_factura = prior.num_serie_factura
                  and prior_original.fecha_expedicion_factura = prior.fecha_expedicion_factura
                  and prior_original_envio.estado in ('aceptado', 'aceptado_con_errores', 'rechazado', 'detenido')
              )))))
      )
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
 * Holds a row `claimBatch` just claimed, in the claim's own transaction so it never reaches
 * `client.submit`, when an earlier row of its chain is `detenido`, when it is a cancellation
 * whose original (same chain, same invoice identity) is `rechazado`, or when this is its first
 * claim and the `SAME_CODE_REFUSAL_LIMIT` rows immediately before it on its chain are all
 * `rechazado` with one and the same code. A held row becomes `detenido` with `incidencia`, so
 * every later claimed row of its chain is held with it.
 *
 * A row still awaiting its answer (`pendiente` or `enviando`) breaks a run. So when the row right
 * after a run was sent and its answer is unreadable or missing, the run rule does not hold the rows
 * added after it: they are sent with its retry, and a later row is held only once the refusals
 * immediately before it make a run of the limit.
 *
 * A cancellation whose original, on the same chain, is `detenido` is held by the first rule: that
 * original is an earlier row of the chain. For a record of a conflict's own envío, see
 * `haltSuccessors`.
 *
 * Short of such a run, a `rechazado` row holds nothing behind it (design §7.1,
 * docs/superpowers/specs/2026-10-04-fiscal-prevention-and-offline-recovery-design.md). A cancellation of a
 * rejected original is held because nothing in this repository sets `SinRegistroPrevio`.
 *
 * The run rule holds only a row claimed for the first time: `claimBatch` has incremented
 * `intentos` in this transaction, so a first claim reads 1 here. A row with `intentos` above 1
 * was claimed before, which includes an envío whose submit failed in transport; it may have
 * reached AEAT, so it is sent again rather than held, or its outcome there would stay unknown.
 * `secuencia` is unique per node (`registros_tenant_node_secuencia_uq`), not per chain, so
 * "immediately before" is the highest positions below this row's on its chain. A chain's rows are
 * all on its node (`appendToChain`, ./chain.ts), and naming the node lets
 * `registros_node_secuencia_idx` serve that walk.
 *
 * No incident and no case of its own: `heldRecords` (./filing-cases.ts) lists each held record
 * beside the case that holds it. A `halted` ack is written per held id, because this
 * bulk UPDATE bypasses `setEstado`'s `writeAck`.
 *
 * Of these holds, only the run's is lifted by the drain: `claimProbes` sends its first held record
 * hourly and `releaseSettledBrakeHolds` releases the chain once that send breaks the run.
 */
async function haltOpenChainClaims(
  tx: Transaction,
  claimed: DueRow[],
  now: Date,
  result: CommittedCounts,
): Promise<DueRow[]> {
  if (claimed.length === 0) return claimed;
  const ids = claimed.map((row) => row.id);
  const blocked = await tx.execute<{ id: string }>(sql`
    select r.id from registros_facturacion r
    where r.id in ${ids}
      and (exists (
        select 1 from envios held_envio
        join registros_facturacion held on held.id = held_envio.registro_id
        where held.sif_id = r.sif_id and held.secuencia < r.secuencia
          and held_envio.estado = 'detenido'
      ) or (r.tipo_registro = 'anulacion' and exists (
        select 1 from registros_facturacion original
        join envios original_envio on original_envio.registro_id = original.id
        where original.tipo_registro = 'alta'
          and original.sif_id = r.sif_id
          and original.id_emisor_factura = r.id_emisor_factura
          and original.num_serie_factura = r.num_serie_factura
          and original.fecha_expedicion_factura = r.fecha_expedicion_factura
          and original_envio.estado = 'rechazado'
      )) or (exists (
        select 1 from envios own where own.registro_id = r.id and own.intentos = 1
      ) and (
        select count(run.codigo_error) = ${SAME_CODE_REFUSAL_LIMIT}
          and count(distinct run.codigo_error) = 1
          and sum(run.estado = 'rechazado') = ${SAME_CODE_REFUSAL_LIMIT}
        from (
          select preceding_envio.estado, preceding_envio.codigo_error
          from registros_facturacion preceding
          left join envios preceding_envio on preceding_envio.registro_id = preceding.id
          where preceding.node_id = r.node_id and preceding.sif_id = r.sif_id
            and preceding.secuencia < r.secuencia
          order by preceding.secuencia desc
          limit ${SAME_CODE_REFUSAL_LIMIT}
        ) run
      )))
  `);
  if (blocked.rows.length === 0) return claimed;
  const blockedIds = new Set(blocked.rows.map((row) => row.id));

  // `claimed` is in `claimBatch`'s chain order, so a chain is held from its first held row on.
  const heldChains = new Set<string>();
  const kept: DueRow[] = [];
  const haltedIds: string[] = [];
  for (const row of claimed) {
    if (blockedIds.has(row.id) || heldChains.has(row.sif_id)) {
      heldChains.add(row.sif_id);
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
 * True when the `SAME_CODE_REFUSAL_LIMIT` records immediately before `record` on its chain are all
 * `rechazado` with one and the same code — the run clause of `haltOpenChainClaims`, for the alias
 * `record` names in the enclosing query.
 */
function sameCodeRunBefore(record: "d" | "p"): SQL {
  const alias = sql.raw(record);
  return sql`(
    select count(run.codigo_error) = ${SAME_CODE_REFUSAL_LIMIT}
      and count(distinct run.codigo_error) = 1
      and sum(run.estado = 'rechazado') = ${SAME_CODE_REFUSAL_LIMIT}
    from (
      select preceding_envio.estado, preceding_envio.codigo_error
      from registros_facturacion preceding
      left join envios preceding_envio on preceding_envio.registro_id = preceding.id
      where preceding.node_id = ${alias}.node_id and preceding.sif_id = ${alias}.sif_id
        and preceding.secuencia < ${alias}.secuencia
      order by preceding.secuencia desc
      limit ${SAME_CODE_REFUSAL_LIMIT}
    ) run
  )`;
}

/**
 * Each chain's earliest `detenido` record `d`, with its envío `de`, the record immediately before
 * it `p` and that record's envío `p_envio`, where `d` has no case of its own and is not a
 * cancellation whose original (same chain, same invoice identity) is `rechazado`.
 */
const HELD_HEADS = sql`
  from envios de
  join registros_facturacion d on d.id = de.registro_id
  join registros_facturacion p on p.id = (
    select previous.id from registros_facturacion previous
    where previous.node_id = d.node_id and previous.sif_id = d.sif_id
      and previous.secuencia < d.secuencia
    order by previous.secuencia desc
    limit 1
  )
  join envios p_envio on p_envio.registro_id = p.id
  where de.estado = 'detenido'
    and not exists (
      select 1 from envios earlier_envio
      join registros_facturacion earlier on earlier.id = earlier_envio.registro_id
      where earlier.sif_id = d.sif_id and earlier.secuencia < d.secuencia
        and earlier_envio.estado = 'detenido'
    )
    and not exists (select 1 from filing_cases own where own.registro_id = d.id)
    and not (d.tipo_registro = 'anulacion' and exists (
      select 1 from registros_facturacion original
      join envios original_envio on original_envio.registro_id = original.id
      where original.tipo_registro = 'alta'
        and original.sif_id = d.sif_id
        and original.id_emisor_factura = d.id_emisor_factura
        and original.num_serie_factura = d.num_serie_factura
        and original.fecha_expedicion_factura = d.fecha_expedicion_factura
        and original_envio.estado = 'rechazado'
    ))
`;

/**
 * The first held record of each chain the same-code run still holds, for this host's environment,
 * with the instant of the chain's last send: when it was held or last probed, or when the record
 * before it was sent, whichever is later. After a refused probe, the record before it is that probe.
 */
function brakeHeldHeads(environment: Entorno): SQL {
  return sql`
    select d.id, max(de.enviado_en, p_envio.enviado_en) as last_sent,
      p_envio.codigo_error as run_code
    ${HELD_HEADS}
      and d.entorno = ${environment}
      and ${sameCodeRunBefore("d")}
  `;
}

/** The brake-held heads due a probe at `now`: the chain's last send is at least
 * `BRAKE_PROBE_INTERVAL_MS` ago. */
function dueProbes(now: Date, environment: Entorno): SQL {
  const cutoff = new Date(now.getTime() - BRAKE_PROBE_INTERVAL_MS).toISOString();
  return sql`
    select heads.id, heads.run_code from (${brakeHeldHeads(environment)}) heads
    where heads.last_sent <= ${cutoff}
  `;
}

/** When the next probe falls due after `now`, or null when none does. */
async function nextProbeAt(reader: Reader, now: Date, environment: Entorno): Promise<Date | null> {
  const cutoff = new Date(now.getTime() - BRAKE_PROBE_INTERVAL_MS).toISOString();
  const { rows } = await reader.execute<{ last_sent: string | null }>(sql`
    select min(heads.last_sent) as last_sent from (${brakeHeldHeads(environment)}) heads
    where heads.last_sent > ${cutoff}
  `);
  const lastSent = rows[0]?.last_sent;
  return lastSent ? new Date(new Date(lastSent).getTime() + BRAKE_PROBE_INTERVAL_MS) : null;
}

/**
 * Claims the due probes, at most `room`, in the claim's own transaction: each stays `detenido`,
 * with `enviado_en` stamped and `intentos` incremented, so a restart's reset (which touches only
 * `enviando`) never resends it and its next probe is `BRAKE_PROBE_INTERVAL_MS` after this one.
 * A probe whose record's `entorno` is not this host's environment is never selected, and raises no
 * incident of its own.
 */
async function claimProbes(
  tx: Transaction,
  now: Date,
  environment: Entorno,
  room: number,
): Promise<DueRow[]> {
  const { rows } = await tx.execute<Record<string, unknown>>(sql`
    select r.*, e.intentos, due.run_code as probe_run_code
    from (${dueProbes(now, environment)}) due
    join registros_facturacion r on r.id = due.id
    join envios e on e.registro_id = r.id
    order by r.sif_id
    limit ${room}
  `);
  if (rows.length === 0) return [];
  const probes = rows.map(({ probe_run_code, ...row }) => ({
    ...decodeRegistroRow<DueRow>(row),
    probe: { runCode: probe_run_code as string },
  }));
  const ids = probes.map((row) => row.id);
  await tx.execute(sql`
    update envios set enviado_en = ${now.toISOString()}, intentos = intentos + 1
    where registro_id in ${ids}
  `);
  return probes.map((row) => ({ ...row, intentos: row.intentos + 1 }));
}

/**
 * The held heads where the record before them is settled, the `SAME_CODE_REFUSAL_LIMIT` records
 * before THAT record are a same-code run, and the ones before the head are not.
 */
function releasableHeads(): SQL {
  return sql`
    select d.id, d.node_id, d.sif_id, d.secuencia
    ${HELD_HEADS}
      and p_envio.estado in ('aceptado', 'aceptado_con_errores', 'rechazado')
      and ${sameCodeRunBefore("p")}
      and not ${sameCodeRunBefore("d")}
  `;
}

/**
 * Releases each `releasableHeads` chain: its head and the `detenido` records after it go back to
 * `pendiente`, due `now`, up to the first `detenido` record with a case of its own. Each one's
 * claim is given back (`intentos - 1`), so a first claim after the release still reads 1 in
 * `haltOpenChainClaims`. Its ack is deleted, as `pendiente` carries none.
 */
async function releaseSettledBrakeHolds(tx: Transaction, now: Date): Promise<void> {
  const heads = await tx.execute<{
    id: string;
    node_id: string;
    sif_id: string;
    secuencia: number;
  }>(releasableHeads());
  for (const head of heads.rows) {
    const released = await tx.execute<{ registro_id: string }>(sql`
      update envios set estado = 'pendiente', proximo_intento_en = ${now.toISOString()},
        intentos = max(intentos - 1, 0)
      where estado = 'detenido' and registro_id in (
        select r.id from registros_facturacion r
        where r.node_id = ${head.node_id} and r.sif_id = ${head.sif_id}
          and r.secuencia >= ${head.secuencia}
          and not exists (
            select 1 from registros_facturacion stop
            join envios stop_envio on stop_envio.registro_id = stop.id
            join filing_cases stop_case on stop_case.registro_id = stop.id
            where stop.node_id = r.node_id and stop.sif_id = r.sif_id
              and stop.secuencia > ${head.secuencia} and stop.secuencia <= r.secuencia
              and stop_envio.estado = 'detenido'
          )
      )
      returning registro_id
    `);
    for (const { registro_id } of released.rows) await deleteAck(tx, registro_id);
  }
}

/**
 * Backs a failed batch off: `enviando` -> `pendiente`, `incidencia = true`, and each row's own
 * `proximo_intento_en` pushed out by `backoffMs(row.intentos)`. The whole batch is treated as
 * "retry later": there is no persisted response to read per-line outcomes from. A probe stays
 * `detenido`: its stamped `enviado_en` schedules the next one.
 */
async function backoffBatch(
  tx: Transaction,
  batch: DueRow[],
  now: Date,
  result: CommittedCounts,
): Promise<void> {
  for (const row of batch) {
    if (row.probe !== undefined) continue;
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

/** A missing fingerprint or invoice leaves the duplicate unresolved. */
type Lookup = { matched: boolean | null } | { failed: unknown };

/** A reply line matched to its claimed row. */
interface ResolvedLine {
  row: DueRow;
  linea: RespuestaLinea;
  efectivo: EstadoEfectivo;
  lookup: Lookup | null;
  duplicateAcceptedWithErrors: boolean;
}

/**
 * Matches each response line to its claimed row by `RefExterna`, in AEAT's order, and makes Route
 * B's lookups one at a time. A lookup's failure is kept rather than thrown, so it leaves only its
 * own record unknown (`handleDuplicate`).
 */
async function resolveLines(
  client: VerifactuClient,
  batch: DueRow[],
  respuesta: Awaited<ReturnType<VerifactuClient["submit"]>>,
): Promise<ResolvedLine[]> {
  const byId = new Map(batch.map((row) => [row.id, row]));
  const lines: ResolvedLine[] = [];
  for (const linea of respuesta.RespuestaLinea) {
    // Skipped rather than thrown: one unmatched line must not back the whole batch off and discard
    // every other line of this response. The skipped row stays `enviando` until
    // `recoverStaleClaims` or a restart requeues it.
    const row = linea.RefExterna !== undefined ? byId.get(linea.RefExterna) : undefined;
    if (row === undefined) continue;
    const resolved = resolveEstadoEfectivo(linea);
    const efectivo =
      linea.CodigoErrorRegistro === 3000 &&
      (resolved === "accepted" || resolved === "accepted_with_errors")
        ? "duplicate_unknown"
        : resolved;
    const routeBCovers =
      efectivo === "duplicate_unknown" ||
      (efectivo === "duplicate_annulled" && row.tipo_registro === "anulacion");
    lines.push({
      row,
      linea,
      efectivo,
      lookup: routeBCovers ? await lookUp(client, row) : null,
      duplicateAcceptedWithErrors:
        linea.CodigoErrorRegistro === 3000 && resolved === "accepted_with_errors",
    });
  }
  return lines;
}

async function lookUp(client: VerifactuClient, row: DueRow): Promise<Lookup> {
  try {
    return { matched: await routeB(client, row) };
  } catch (failed) {
    return { failed };
  }
}

/**
 * Applies every line with its own outcome, whatever an earlier line of the same reply did (design
 * §7.1, docs/superpowers/specs/2026-10-04-fiscal-prevention-and-offline-recovery-design.md). This reply is
 * never returned again.
 */
async function persistResponse(
  tx: Transaction,
  batch: DueRow[],
  lines: ResolvedLine[],
  csv: string | null,
  now: Date,
  result: CommittedCounts,
): Promise<void> {
  const sentIds = batch.map((row) => row.id);

  for (const line of lines) {
    await applyOutcome(tx, line, csv, now, result, sentIds);
  }
  await releaseSettledBrakeHolds(tx, now);
}

/** Routes one resolved line to its estado transition + side effects. `sentIds` is the envío's
 * batch (see `haltSuccessors`). */
async function applyOutcome(
  tx: Transaction,
  { row, linea, efectivo, lookup, duplicateAcceptedWithErrors }: ResolvedLine,
  csv: string | null,
  now: Date,
  result: CommittedCounts,
  sentIds: string[],
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
      // A probe refused with its run's code lengthens the run that `fiscal.refusals_repeated`
      // already reports; an incident would add a new alert for each such refusal.
      if (row.probe === undefined || String(codigo) !== row.probe.runCode) {
        await raiseIncident(
          tx,
          row,
          "error",
          new AppError("fiscal.registro_rechazado", { registroId: row.id, codigo, mensaje }),
          now,
          result,
        );
      }
      await openCase(tx, row, "fiscal.registro_rechazado", linea, csv, now);
      result.recordsHalted += 1;
      return;
    }
    case "status_unknown":
      await awaitReadableAnswer(tx, row, linea, csv, now, result);
      return;
    // duplicate_annulled / duplicate_unknown — error 3000; see `handleDuplicate`.
    default:
      await handleDuplicate(
        tx,
        row,
        linea,
        efectivo,
        lookup,
        duplicateAcceptedWithErrors,
        csv,
        now,
        result,
        sentIds,
      );
  }
}

/** The case a person decides, opened in the same transaction as the outcome and its incident. */
async function openCase(
  tx: Transaction,
  row: DueRow,
  cause: FilingCaseCause,
  linea: RespuestaLinea,
  csv: string | null,
  now: Date,
): Promise<void> {
  await openFilingCase(tx, {
    registroId: row.id,
    cause,
    evidence: {
      codigo: linea.CodigoErrorRegistro ?? null,
      mensaje: linea.DescripcionErrorRegistro ?? null,
      csv,
    },
    now,
  });
}

/**
 * An unreadable reply, or a duplicate lookup that failed or did not settle whose record AEAT holds,
 * stays pending for a later send; a probe stays `detenido` for its next probe instead. The incident
 * keeps the envío's CSV, which AEAT never returns again. `lookupFailed` is given only when a
 * duplicate lookup ran.
 */
async function awaitReadableAnswer(
  tx: Transaction,
  row: DueRow,
  linea: RespuestaLinea,
  csv: string | null,
  now: Date,
  result: CommittedCounts,
  lookupFailed?: boolean,
): Promise<void> {
  if (row.probe === undefined) {
    const next = new Date(now.getTime() + backoffMs(row.intentos));
    await tx.execute(sql`
      update envios set estado = 'pendiente', incidencia = true, proximo_intento_en = ${next.toISOString()}
      where registro_id = ${row.id}
    `);
    bumpNextDue(result, next);
  }
  await raiseIncident(
    tx,
    row,
    "warning",
    new AppError("fiscal.estado_desconocido", {
      registroId: row.id,
      estado: linea.EstadoRegistro ?? null,
      codigo: linea.CodigoErrorRegistro ?? null,
      mensaje: linea.DescripcionErrorRegistro ?? null,
      csv,
      ...(lookupFailed === undefined ? {} : { lookupFailed }),
    }),
    now,
    result,
  );
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
 * Holds a conflict's still-`pendiente`/`enviando` successors on its chain (same `sif_id`, higher
 * `secuencia`) as `detenido`, flagging `incidencia`, except the records of this envío: those were
 * sent, and each keeps its own line's outcome here. One whose outcome stays unknown is held at its
 * next claim instead (`haltOpenChainClaims`). Writes a `halted` ack for each, because this bulk
 * UPDATE bypasses `setEstado`.
 *
 * A subquery rather than `UPDATE ... FROM`, which this engine refused with an alias on the target
 * table.
 */
async function haltSuccessors(
  tx: Transaction,
  row: DueRow,
  sentIds: string[],
  now: Date,
): Promise<string[]> {
  const halted = await tx.execute<{ registro_id: string }>(sql`
    update envios set estado = 'detenido', incidencia = true
    where estado in ('pendiente', 'enviando')
      and registro_id not in ${sentIds}
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
  result: CommittedCounts,
): Promise<void> {
  await recordIncident(tx, {
    origin: jobOrigin("fiscal_filing"),
    saleId: row.sale_id as SaleId,
    error,
    severity,
    detectedAt: now,
  });
  result.incidentsRaised += 1;
}

/**
 * A targeted consulta compares the stored fingerprint and installation identity before a duplicate
 * can confirm our record. An absent record or fingerprint leaves the answer unresolved; when the
 * fingerprint matches, missing installation identity also leaves it unresolved.
 *
 * `Ejercicio`/`Periodo` come from `fecha_expedicion_factura`: our records never carry a separate
 * `FechaOperacion`, so the operation month is the expedition month.
 */
async function routeB(client: VerifactuClient, row: DueRow): Promise<boolean | null> {
  const [ejercicio, periodo] = row.fecha_expedicion_factura.split("-");
  const fecha = toAeatDate(row.fecha_expedicion_factura);
  let page: RespuestaConsulta["ClavePaginacion"];
  const seenPages = new Set<string>();
  // Rotating page keys must not keep a claimed record inside one network pass forever.
  for (let pagesRead = 0; pagesRead < MAX_CONSULTA_PAGES; pagesRead += 1) {
    const respuesta: RespuestaConsulta = await client.consultar(
      { ObligadoEmision: { NombreRazon: row.nombre_razon_emisor, NIF: row.id_emisor_factura } },
      {
        Ejercicio: ejercicio,
        Periodo: periodo,
        NumSerieFactura: row.num_serie_factura,
        FechaExpedicionFactura: fecha,
        DatosAdicionalesRespuesta: { MostrarSistemaInformatico: "S" },
        ...(page === undefined ? {} : { ClavePaginacion: page }),
      },
    );
    const stored = respuesta.registros.find(
      (r) =>
        r.IDFactura.IDEmisorFactura === row.id_emisor_factura &&
        r.IDFactura.NumSerieFactura === row.num_serie_factura &&
        r.IDFactura.FechaExpedicionFactura === fecha,
    );
    const huella = stored?.DatosRegistroFacturacion.Huella;
    if (huella !== undefined) {
      if (huella !== row.huella) return false;
      const sistema = stored?.DatosRegistroFacturacion.SistemaInformatico;
      if (typeof sistema !== "object" || sistema === null) return null;
      const original = fromRegistroRow(row).SistemaInformatico;
      return (
        "NIF" in sistema &&
        sistema.NIF === original.NIF &&
        "IdSistemaInformatico" in sistema &&
        sistema.IdSistemaInformatico === original.IdSistemaInformatico &&
        "NumeroInstalacion" in sistema &&
        sistema.NumeroInstalacion === original.NumeroInstalacion
      );
    }
    const next = respuesta.ClavePaginacion;
    if (respuesta.IndicadorPaginacion !== "S" || next === undefined) return null;
    const key = JSON.stringify(next);
    if (seenPages.has(key)) return null;
    seenPages.add(key);
    page = next;
  }
  return null;
}

/**
 * The error-3000 duplicate cases:
 *
 *   - Route A (`duplicate_annulled` on an alta): AEAT's own copy of this identity is `Anulada`. This
 *     record can never become a confirmed accept under this identity, so it halts with
 *     `fiscal.duplicado_anulado` rather than retrying forever.
 *   - Route B (all other duplicates): a consulta reads the record AEAT holds under this identity.
 *     A matching fingerprint and installation confirm our record. A mismatch halts; missing
 *     evidence leaves the row pending. An anulación belongs here because `Anulada` on a resent anulación
 *     is most likely AEAT holding that very anulación: the verifactu library's live preproduction
 *     check asserts that the final consulta "reports the invoice as `Anulado` with the cancellation
 *     record's hash" (`sources/README.md`; the "final cancelled-record consulta" stage in
 *     `scripts/live-aeat.mjs`), no recorded run of it is cited here, and the library's fake does the
 *     same.
 *
 * `resolveLines` makes Route B's consulta before this transaction opens; a failed one leaves this
 * record unknown, as missing evidence does.
 *
 * A conflict opens a case and holds this chain's records not yet sent (`haltSuccessors`): no live
 * AEAT test has sent a successor after one (design §5, "Implemented, 2026-10-06"). Design:
 * docs/superpowers/specs/2026-10-04-fiscal-prevention-and-offline-recovery-design.md.
 */
async function handleDuplicate(
  tx: Transaction,
  row: DueRow,
  linea: RespuestaLinea,
  efectivo: EstadoEfectivo,
  lookup: Lookup | null,
  duplicateAcceptedWithErrors: boolean,
  csv: string | null,
  now: Date,
  result: CommittedCounts,
  sentIds: string[],
): Promise<void> {
  const annulled = efectivo === "duplicate_annulled";
  if (lookup !== null) {
    if ("failed" in lookup) {
      await awaitReadableAnswer(tx, row, linea, csv, now, result, true);
      return;
    }
    if (lookup.matched) {
      await setEstado(
        tx,
        row.id,
        duplicateAcceptedWithErrors ? "aceptado_con_errores" : "aceptado",
        now,
        { csv, confirmadoEn: now },
      );
      if (duplicateAcceptedWithErrors) {
        await raiseIncident(
          tx,
          row,
          "warning",
          new AppError("fiscal.aceptado_con_errores", {
            registroId: row.id,
            codigo: linea.CodigoErrorRegistro ?? null,
            mensaje: linea.DescripcionErrorRegistro ?? null,
          }),
          now,
          result,
        );
      }
      result.recordsAccepted += 1;
      return;
    }
    if (lookup.matched === null) {
      await awaitReadableAnswer(tx, row, linea, csv, now, result, false);
      return;
    }
  }
  const cause = annulled ? "fiscal.duplicado_anulado" : "fiscal.huella_divergente";
  await setEstado(tx, row.id, "detenido", now, { csv, incidencia: true });
  await raiseIncident(tx, row, "error", new AppError(cause, { registroId: row.id }), now, result);
  await openCase(tx, row, cause, linea, csv, now);
  const haltedIds = await haltSuccessors(tx, row, sentIds, now);
  result.recordsHalted += 1 + haltedIds.length;
}

/** A structured code, never prose: the AppError's own code, or the literal "unknown". The same
 * convention `@waitron/scheduler`'s `run.ts` and `reconcilePayments`'s `remediate()` both use. */
function codeOf(error: unknown): string {
  return isAppError(error) ? error.code : "unknown";
}
