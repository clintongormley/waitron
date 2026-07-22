import { sql } from "drizzle-orm";
import { withTenant } from "@waitron/db";
import type { Database, Transaction } from "@waitron/db";
import { recordIncident } from "@waitron/core";
import type { IncidentSeverity } from "@waitron/core";
import type { DrainResult } from "@waitron/fiscal";
import { AppError } from "@waitron/shared";
import type { SaleId, TenantId, TillId } from "@waitron/shared";
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
import { fromRegistroRow, toAeatDate } from "./registro-row.js";
import type { RegistroRow } from "./registro-row.js";

/**
 * The fake AEAT's own default (`FakeAeatOptions.tiempoEsperaInicial`,
 * `@waitron/verifactu/src/testing/fake-aeat.ts`) — the wait a tenant with no `envio_flujo` row
 * yet (never sent, so `readFlujo` reports `tiempoEsperaSeg: 0`) should assume before its first
 * envío. `drainTenant`'s own `let t = flujo.tiempoEsperaSeg || TIEMPO_ESPERA_INICIAL_SEG` is the
 * one call site — kept as a named constant, not a bare literal, so this file's one guess at "what
 * to wait before we've ever heard from AEAT" is stated once rather than duplicated.
 */
export const TIEMPO_ESPERA_INICIAL_SEG = 60;

/**
 * How long a row may sit `enviando` before a LATER `drain()` pass treats it as abandoned rather
 * than genuinely in flight. The T1/T2 split (Task 6, spec §7.2) is what makes this meaningful: T1
 * commits `estado = 'enviando'` BEFORE the network call, so a process that crashes between T1 and
 * T2 leaves a real, committed `enviando` row behind — not an uncommitted claim that simply
 * vanishes with the process. Five minutes is comfortably longer than one AEAT round trip (a normal
 * in-flight submission never approaches it) but short enough that a genuine crash does not leave a
 * record stuck for art. 16.4's hourly duty to notice.
 */
export const RECUPERACION_ENVIANDO_MS = 5 * 60_000;

/** The first retry's wait, and the per-attempt doubling unit `backoffMs` scales from. */
export const BACKOFF_BASE_MS = 60_000;
/** The retry ceiling: no transiently-failed batch waits longer than one hour before its next
 * attempt, however many times it has already failed. */
export const BACKOFF_MAX_MS = 3_600_000;

/**
 * Exponential backoff for the `intentos`-th attempt (1-indexed: `intentos` already reflects the
 * increment `claimBatch` applies at claim time, so the FIRST failed attempt calls this with `1`
 * and waits `BACKOFF_BASE_MS` once, not `BACKOFF_BASE_MS * 2`). Capped at `BACKOFF_MAX_MS` — a
 * row that keeps failing settles at retrying hourly rather than waiting arbitrarily longer.
 * `Math.max(0, intentos - 1)` guards a defensive floor only: `claimBatch` never returns a row with
 * `intentos < 1`, so the exponent is never negative in practice.
 */
export function backoffMs(intentos: number): number {
  return Math.min(BACKOFF_MAX_MS, BACKOFF_BASE_MS * 2 ** Math.max(0, intentos - 1));
}

export interface DrainDeps {
  db: Database;
  client: VerifactuClient;
}

/** A due `envios` row joined to enough of its registro to rebuild and order it. */
type DueRow = RegistroRow & { intentos: number };

/**
 * Enumerate tenants with due work. Runs on the system connection (not inside `withTenant`) because
 * it must see EVERY tenant's due rows to decide which ones to drain, not just one already-scoped
 * tenant's — a deliberately cross-tenant read of a table (`envios`) under FORCE ROW LEVEL SECURITY.
 *
 * That crossing goes through `envios_tenants_with_work` (fiscal migration 0004), a SECURITY DEFINER
 * function OWNED by the dedicated NOLOGIN `envios_drainer` role, which alone carries a permissive
 * `USING (true)` SELECT policy on `envios`. Inside the function `current_user` is `envios_drainer`,
 * so its `SELECT DISTINCT tenant_id` sees rows through that role-scoped policy — ORed with
 * `envios_tenant_isolation` — regardless of `app.tenant_id`. Without it, the old raw
 * `select distinct tenant_id from envios` returned ZERO rows under the non-superuser `app_user`
 * deployment role (`current_tenant_id()` is NULL with no GUC set, so the tenant-isolation policy
 * fails closed), and the whole drainer was a silent no-op in production (spec §7.1/§11). PGlite's
 * superuser connection would have bypassed RLS and hidden that, which is exactly why the seam is
 * proven under the real `app_user` role on real Postgres (`drain.concurrency.test.ts`), never on
 * PGlite. The function returns ONLY the tenant-id list — no wider `envios` column leaks to
 * `app_user` — and app_user holds EXECUTE on it and nothing else new.
 *
 * The predicate the function runs is kept in lockstep with the two conditions below; see 0004's own
 * comment on the `interval '300000 milliseconds'` ↔ `RECUPERACION_ENVIANDO_MS` (5 * 60_000 ms)
 * coupling. It also matches a tenant whose ONLY due work is a stale `enviando` row (past
 * `RECUPERACION_ENVIANDO_MS`) with NO `pendiente` row alongside it. This is not optional: a tenant
 * with a lone stuck `enviando` row has zero `pendiente` rows by definition, so a `pendiente`-only
 * predicate would never select it, `drainTenant` would never run for it, and `recoverStaleClaims` —
 * which only runs INSIDE `drainTenant`, per tenant — would never get the chance to recover it.
 * Confirmed live while implementing Task 8: without this OR clause, the "recovers a stale enviando
 * row" unit test's tenant is silently skipped by the top-level sweep and the row is left `enviando`
 * forever, incidencia never raised.
 */
async function tenantsWithWork(db: Database, now: Date): Promise<string[]> {
  const rows = await db.execute<{ tenant_id: string }>(sql`
    select tenant_id from envios_tenants_with_work(${now.toISOString()}::timestamptz) as t(tenant_id)
  `);
  return rows.rows.map((r) => r.tenant_id);
}

export async function drain(deps: DrainDeps, now: Date): Promise<DrainResult> {
  const result: DrainResult = {
    nextDueAt: null,
    batchesSent: 0,
    recordsSubmitted: 0,
    recordsAccepted: 0,
    recordsHalted: 0,
    incidentsRaised: 0,
  };
  for (const tenantId of await tenantsWithWork(deps.db, now)) {
    await drainTenant(deps.db, deps.client, tenantId, now, result);
  }
  return result;
}

/**
 * T1/T2 split (spec §7.2): claim due rows in their own short transaction (T1), which commits
 * before the network call — so no row lock or connection is held across the AEAT round-trip while
 * `claimBatch`'s `FOR UPDATE SKIP LOCKED` (Task 8) is in effect, and `recoverStaleClaims` (Task 8,
 * called at the top of this function) has real committed `enviando` rows to recover after a crash.
 * `client.submit` then runs OUTSIDE any transaction. Each response is persisted in its own short
 * transaction (T2) — or, if `client.submit` throws, the claimed batch is backed off in a T2 of its
 * own instead (`backoffBatch`, Task 8) — one pair of T1/T2 per ≤1000-row chunk this tenant's due
 * backlog is split into (spec §7.2's flow-control race, art. 16.4):
 *
 *   - If `envio_flujo.proximo_envio_en` (the "gate") has not yet elapsed AND fewer than
 *     `MAX_REGISTROS_POR_ENVIO` rows are currently due, nothing is sent this pass — the tenant is
 *     deferred to the gate (`bumpNextDue`), matching AEAT's own rule that a software system must
 *     otherwise wait `TiempoEsperaEnvio` seconds between envíos.
 *   - Otherwise (gate open, OR ≥1000 already accumulated), the pass is authorised: the loop below
 *     claims/submits/persists ≤1000-row chunks BACK TO BACK while ≥1000 rows remain due (the
 *     "1000 accumulated" exception) — but STOPS the moment fewer than 1000 remain after a chunk
 *     has been sent this pass. That remaining tail is neither a full batch nor `t`-elapsed, so it
 *     is deferred to a LATER `drain()` call gated on `t` (`bumpNextDue` below), not flushed
 *     back-to-back in the same pass.
 *
 * Concretely: a 1001-row backlog on an open gate sends its first 1000-row chunk, sees 1 row left
 * (< 1000), and stops — `batchesSent: 1`, `recordsSubmitted: 1000` from THIS `drain()` call, with
 * the last row deferred until `nextDueAt` (`drain.test.ts`'s two-pass 1001 test). The pass's
 * FIRST envío still always goes once authorised — a standalone <1000 backlog on an open gate
 * sends now, per the top-of-function gate check — only a tail that FOLLOWS a sent chunk within
 * the same pass is deferred. `dueCount` therefore stays > 0 after the loop either via this
 * intentional break (a deferred tail) or the defensive `batch.length === 0` guard below (a
 * countDue/claimBatch race) — either way `bumpNextDue` below picks it up.
 */
async function drainTenant(
  db: Database,
  client: VerifactuClient,
  tenantId: string,
  now: Date,
  result: DrainResult,
): Promise<void> {
  // Recovery gets its OWN short tx, ahead of (and separate from) the flujo/dueCount0 read below —
  // it must COMMIT before anything else in this pass reads `envios`, so that a row it just
  // recovered is visible to countDue/claimBatch's own, later transactions as an ordinary
  // `pendiente` row rather than something they need to special-case.
  await withTenant(db, tenantId, (tx) => recoverStaleClaims(tx, tenantId, now));

  // Read flow state + the current due count in one short tx — mirrors T1's own claim tx: short-
  // lived, no network call inside it.
  const { flujo, dueCount0 } = await withTenant(db, tenantId, async (tx) => ({
    flujo: await readFlujo(tx, tenantId),
    dueCount0: await countDue(tx, tenantId, now),
  }));
  if (dueCount0 === 0) return;

  const gateOpen = flujo.proximoEnvioEn === null || flujo.proximoEnvioEn.getTime() <= now.getTime();
  // The race (spec §7.2, art. 16.4): send if the gate is open OR a full envío has already
  // accumulated. Otherwise defer this tenant entirely — nothing claimed, nothing sent.
  if (!gateOpen && dueCount0 < MAX_REGISTROS_POR_ENVIO) {
    bumpNextDue(result, flujo.proximoEnvioEn);
    return;
  }

  let t = flujo.tiempoEsperaSeg || TIEMPO_ESPERA_INICIAL_SEG;
  let dueCount = dueCount0;
  while (dueCount > 0) {
    // T1 — claim in its own transaction; ≤1000 due pending rows, ordered by chain sequence
    // within each SIF. Any claimed row whose chain already carries an open `rechazado`/
    // `detenido` envío (Task 9's Incidencia-while-open rule, `haltOpenChainClaims`'s own doc
    // comment) is redirected straight to `detenido` here, in the SAME transaction as the claim —
    // never handed to AEAT, since submitting over an unresolved gap would be submitting out of
    // chain order.
    const batch = await withTenant(db, tenantId, async (tx) => {
      const claimed = await claimBatch(tx, tenantId, now);
      return haltOpenChainClaims(tx, claimed, result);
    });
    // Defensive only: EITHER the countDue/claimBatch race this function's own doc comment
    // describes, OR every row claimed this round was redirected to `detenido` by
    // `haltOpenChainClaims` above (all due work this round sat on already-halted chains). Either
    // way nothing here is submittable; the tenant is deferred to its next gated pass rather than
    // re-attempting immediately, exactly like the race case.
    if (batch.length === 0) break;

    const cabecera = cabeceraFor(batch[0]!);
    const registros: EnvioRegistro[] = batch.map(toEnvioRegistro);
    try {
      // Network — OUTSIDE any transaction, so T1's claim is already committed and no lock/
      // connection is held while waiting on AEAT.
      const respuesta = await client.submit(cabecera, registros);

      // T2 — persist the response (CSV + estados) atomically, then recount what's still due.
      dueCount = await withTenant(db, tenantId, async (tx) => {
        await persistResponse(tx, client, batch, respuesta, now, result);
        return countDue(tx, tenantId, now);
      });
      t = respuesta.TiempoEsperaEnvio;
      // A chunk was just sent this pass; if fewer than a full envío's worth remain due, that
      // tail is neither a full batch nor `t`-elapsed — stop here and defer it to the NEXT pass
      // (gated on `t`, via `bumpNextDue` below), rather than riding back-to-back in this pass.
      if (dueCount < MAX_REGISTROS_POR_ENVIO) break;
    } catch {
      // Scope boundary (Task 8): this catches `client.submit` THROWING — a transient network/
      // transport failure. It does NOT catch a successful response carrying per-record
      // rejections/AceptadoConErrores/error-3000 (Task 9/10's resolution, `persistResponse`'s own
      // scope note) — `persistResponse` never throws on those; it always returns normally.
      //
      // T1 already committed this batch's claim, so nothing here is lost: back it off (->
      // pendiente, incidencia, an exponentially later proximo_intento_en per row) rather than
      // leave it stuck `enviando`, and stop this tenant's loop — the retry is scheduled via each
      // row's own `proximo_intento_en`, not retried immediately against a server that just failed.
      await withTenant(db, tenantId, (tx) => backoffBatch(tx, batch, now, result));
      break;
    }
  }

  // Persist the server's latest wait `t` as this tenant's gate for its NEXT pass — never an
  // in-memory timer (envio-flujo.ts's own doc comment).
  const proximoEnvioEn = new Date(now.getTime() + t * 1000);
  await withTenant(db, tenantId, (tx) => upsertFlujo(tx, tenantId, proximoEnvioEn, t));
  // `dueCount > 0` here only via the defensive break above; see this function's own doc comment.
  if (dueCount > 0) bumpNextDue(result, proximoEnvioEn);
}

/** Current flow-control state for a tenant. No row yet = never sent = "may send now" (the gate
 * reads open) — `envio-flujo.ts`'s own doc comment on why the row is lazily created. */
async function readFlujo(
  tx: Transaction,
  tenantId: string,
): Promise<{ proximoEnvioEn: Date | null; tiempoEsperaSeg: number }> {
  const rows = await tx.execute<{ proximo_envio_en: string; tiempo_espera_seg: number }>(sql`
    select proximo_envio_en, tiempo_espera_seg from envio_flujo where tenant_id = ${tenantId}
  `);
  const row = rows.rows[0];
  return row
    ? { proximoEnvioEn: new Date(row.proximo_envio_en), tiempoEsperaSeg: row.tiempo_espera_seg }
    : { proximoEnvioEn: null, tiempoEsperaSeg: 0 };
}

/** How many of this tenant's rows are due right now — the SAME predicate `claimBatch` re-runs a
 * moment later, so it can also be used to decide whether more work remains after a chunk. */
async function countDue(tx: Transaction, tenantId: string, now: Date): Promise<number> {
  const rows = await tx.execute<{ count: string }>(sql`
    select count(*)::text as count from envios
    where tenant_id = ${tenantId} and estado = 'pendiente' and proximo_intento_en <= ${now.toISOString()}
  `);
  return Number(rows.rows[0]!.count);
}

/** Upserts this tenant's flow-control row: when its next envío may go, and the `t` that produced
 * that gate — persisted, never an in-memory timer. */
async function upsertFlujo(
  tx: Transaction,
  tenantId: string,
  proximoEnvioEn: Date,
  t: number,
): Promise<void> {
  await tx.execute(sql`
    insert into envio_flujo (tenant_id, proximo_envio_en, tiempo_espera_seg)
    values (${tenantId}, ${proximoEnvioEn.toISOString()}, ${t})
    on conflict (tenant_id) do update set
      proximo_envio_en = excluded.proximo_envio_en, tiempo_espera_seg = excluded.tiempo_espera_seg
  `);
}

/** Folds one tenant's gate time into `result.nextDueAt` — the earliest instant ANY drained
 * tenant needs `drain` called again, per `DrainResult`'s own doc comment. */
function bumpNextDue(result: DrainResult, at: Date | null): void {
  if (at === null) return;
  result.nextDueAt =
    result.nextDueAt === null ? at : new Date(Math.min(result.nextDueAt.getTime(), at.getTime()));
}

/**
 * Resets a tenant's timed-out `enviando` rows back to `pendiente`, raising `incidencia` — the
 * signal that this record needed operator attention, even though the happy path below will most
 * likely resubmit and accept it within the same pass. Runs BEFORE `claimBatch`, in its own
 * committed transaction (`drainTenant`'s own doc comment on the split), so a row it recovers here
 * is an ordinary committed `pendiente` row by the time `countDue`/`claimBatch` look at this
 * tenant — no special-casing needed anywhere else.
 *
 * `incidencia = true` is deliberately NOT paired with an `incidents` table row here — the
 * boolean flag is this task's whole scope; the incident RECORD is Task 9 (see this file's own
 * scope note, `drain.test.ts`, and the Task 8 brief).
 */
async function recoverStaleClaims(tx: Transaction, tenantId: string, now: Date): Promise<void> {
  const cutoff = new Date(now.getTime() - RECUPERACION_ENVIANDO_MS).toISOString();
  await tx.execute(sql`
    update envios set estado = 'pendiente', incidencia = true, proximo_intento_en = ${now.toISOString()}
    where tenant_id = ${tenantId} and estado = 'enviando' and enviado_en < ${cutoff}
  `);
}

/**
 * Claim due pending rows → `enviando`, incrementing `intentos` and stamping `enviado_en` at claim
 * time (not at persist time) — `enviado_en` is what `recoverStaleClaims` above measures staleness
 * from, and `intentos` (returned already incremented) is what `backoffBatch` computes THIS
 * attempt's wait from if the submit below fails.
 *
 * `FOR UPDATE OF e SKIP LOCKED`: two tenants' claims never contend (each `drainTenant` call is
 * scoped to one `tenantId`, so this WHERE never matches another tenant's rows), but two concurrent
 * drainers racing the SAME tenant do — e.g. two scheduler instances, or a retried call overlapping
 * a slow one. Without row locking here, both transactions' plain `SELECT` would each see the same
 * `pendiente` rows (READ COMMITTED takes a fresh per-statement snapshot, but neither SELECT blocks
 * on the other), and both would go on to submit the SAME batch to AEAT — a genuine duplicate
 * submission, not merely a wasted query. `FOR UPDATE` alone would already prevent this (the second
 * transaction would block, then re-check its WHERE clause against the now-`enviando` row and
 * exclude it) but would serialise the two claims; `SKIP LOCKED` instead lets the second transaction
 * immediately move past whatever the first already has locked and claim only what remains — the
 * concurrency this drainer needs when scaled beyond one process. Proven under REAL contention (not
 * PGlite, which serialises everything onto one backend) by `drain.concurrency.test.ts`.
 */
async function claimBatch(tx: Transaction, tenantId: string, now: Date): Promise<DueRow[]> {
  const rows = await tx.execute<DueRow>(sql`
    select r.*, e.intentos from envios e
    join registros_facturacion r on r.id = e.registro_id
    where e.tenant_id = ${tenantId} and e.estado = 'pendiente' and e.proximo_intento_en <= ${now.toISOString()}
    order by r.sif_id, r.secuencia
    limit ${MAX_REGISTROS_POR_ENVIO}
    for update of e skip locked
  `);
  if (rows.rows.length > 0) {
    const ids = rows.rows.map((r) => r.id);
    // NOT `= any(${ids})`, and NOT `in (${ids})` either: drizzle-orm's `sql` tag expands a JS
    // array parameter into an ALREADY-PARENTHESISED placeholder list — `($1, $2, $3)` — for
    // exactly this `IN` shape, not a single Postgres array value. `any(${ids})` sends
    // `any(($1, $2, $3))`, which Postgres rejects (42809, "op ANY/ALL (array) requires array on
    // right side"); `in (${ids})` double-wraps into `in (($1, $2, $3))`, a one-element list
    // containing a ROW, not three scalars, which fails with 42883 ("operator does not exist: uuid
    // = record"). Both confirmed live against PGlite while implementing this task. `in ${ids}`,
    // with no extra parens of our own, is the form drizzle's own expansion is already shaped for.
    await tx.execute(sql`
      update envios set estado = 'enviando', enviado_en = ${now.toISOString()}, intentos = intentos + 1
      where registro_id in ${ids}
    `);
  }
  // `r.intentos + 1` reflects the UPDATE just committed above — the SELECT ran before it, so its
  // own `e.intentos` is still the PRE-increment value. Returned already incremented so
  // `backoffBatch` (if the submit below fails) computes THIS attempt's wait, not the previous one's.
  return rows.rows.map((r) => ({ ...r, intentos: r.intentos + 1 }));
}

/**
 * Task 9's "Incidencia-while-open" rule. A row `claimBatch` just claimed (now `enviando`) is
 * redirected straight to `detenido` + `incidencia = true`, and dropped from what is returned, if
 * its OWN chain (`sif_id`) already carries an open `rechazado`/`detenido` envío — i.e. an earlier
 * rejection this drainer has not yet resolved. Runs in the SAME T1 transaction as the claim, so a
 * row this catches never reaches `client.submit` at all.
 *
 * Why this can only ever catch a NEW gap, never one `haltSuccessors` already covered at rejection
 * time: submission (and therefore claiming) always proceeds in ascending `secuencia` order within
 * one chain (`claimBatch`'s own `order by r.sif_id, r.secuencia`), so any row still `pendiente`
 * at the moment a predecessor is rejected is, by construction, a SUCCESSOR — exactly what
 * `haltSuccessors` (called from `applyOutcome`'s `"rejected"` branch) already swept to `detenido`
 * there and then. A row this function halts is therefore always one that did not exist yet at
 * rejection time — e.g. a sale recorded (and its `envios` row inserted) AFTER the rejection, on a
 * chain the local write path has no reason to block (the local hash chain does not depend on
 * AEAT's verdict — spec's own art. 16.4 framing is "keep issuing, keep trying to report") but the
 * drainer must still never submit over the resulting gap.
 *
 * Deliberately does NOT raise a fresh `incidents` row: the rejection that opened this chain's gap
 * already raised one (`applyOutcome`), and it is still unresolved — a second row per newly-
 * enqueued successor would spam duplicate incidents for one still-open condition. Only the
 * boolean flag is set here, mirroring `recoverStaleClaims`'s identical precedent and doc comment
 * (a few functions above) for the same "flag, don't duplicate the incident record" reasoning.
 */
async function haltOpenChainClaims(
  tx: Transaction,
  claimed: DueRow[],
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
    // Same `in ${ids}` shape as claimBatch's own claim UPDATE above — see that function's own
    // doc comment for why neither `any(${ids})` nor `in (${ids})` works against drizzle's array
    // parameter expansion.
    await tx.execute(sql`
      update envios set estado = 'detenido', incidencia = true where registro_id in ${haltedIds}
    `);
    result.recordsHalted += haltedIds.length;
  }
  return kept;
}

/**
 * Backs a transiently-failed batch off: `enviando` -> `pendiente`, `incidencia = true`, and each
 * row's OWN `proximo_intento_en` pushed out by `backoffMs(row.intentos)` — per-row rather than a
 * single batch-wide delay, so a row that has failed more times than its batch-mates (impossible
 * within one batch today, since a batch's rows share one claim, but true across passes once a row
 * survives into a later batch after other rows' `intentos` have diverged) waits accordingly.
 *
 * Scope boundary (Task 8, see this file's own top-level note): this ALWAYS treats the whole batch
 * as "failed, retry later" — it does not distinguish per-record acceptance/rejection, because it
 * is only ever reached when `client.submit` THREW (no response to read per-line state from at
 * all). A successful response with per-line rejections is Task 9/10's `persistResponse` scope,
 * not this function's.
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
  // RefExterna = our registro id (spec §10). Derived, not stored; not a huella input, so safe to
  // attach after hashing. row.id is the registros_facturacion UUID.
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
 * Task 9: resolves EACH response line via `resolveEstadoEfectivo` (`@waitron/verifactu`) and
 * matches it to its claimed batch row by `RefExterna` (= `row.id` — every line this package ever
 * sends carries it, stamped by `toEnvioRegistro`, spec §10), rather than assuming the happy-path
 * "every claimed row accepted" Task 6 through 8 got away with.
 *
 * `client` is threaded through to `applyOutcome`/`handleDuplicate` even though nothing in THIS
 * task reads it — Task 10's Route B (`duplicate_unknown`) needs `client.consultar`, and there is
 * no module-global client this function could reach for instead; wiring the parameter through now
 * avoids a second signature churn across every call site in this chain later.
 *
 * `halted` tracks registro ids halted as a SUCCESSOR earlier in THIS SAME response (`applyOutcome`'s
 * `"rejected"` branch adds to it via `haltSuccessors`) — confirmed live while implementing this
 * task: a >1-record batch that rejects one line and accepts a LATER line on the SAME chain (e.g.
 * secuencia 1 accepted, 2 rejected, 3 accepted — the fake AEAT has no chain awareness at all and
 * happily reports "Correcto" for 3 even though its own predecessor, 2, was just rejected in the
 * SAME envío) would otherwise process secuencia 3's own "accepted" line AFTER `haltSuccessors`
 * already moved it to `detenido`, and silently overwrite the halt back to `aceptado` — response
 * lines are applied in the order AEAT returned them (mirroring submission order, ascending
 * `secuencia` within a chain — `claimBatch`'s own `order by`), not re-sorted so a rejection is
 * guaranteed to be seen before its successors', but a fake (or real) AEAT's own per-line verdict
 * for an already-halted successor must never be allowed to win over our own halt regardless of
 * ordering.
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
  // `respuesta.CSV` is only ever undefined for a wholesale-rejected envío (`RespuestaSuministro`'s
  // own doc comment, packages/verifactu/src/xml/parse-suministro.ts) — not reachable through this
  // package's own fake AEAT (`createFakeAeat` always returns a CSV, per-line rejections included;
  // see its own `handleEnvio` doc comment), so the `?? null` fallback stays unexercised by this
  // task's tests too, same as Task 6's original note here.
  const csv = respuesta.CSV ?? null;
  const byId = new Map(batch.map((row) => [row.id, row]));
  const halted = new Set<string>();

  for (const linea of respuesta.RespuestaLinea) {
    // `RefExterna` is our own registro id, stamped on every outgoing line by `toEnvioRegistro` —
    // always present in practice for a response to OUR OWN submission. Skipped defensively rather
    // than throwing: a line this batch cannot match would otherwise crash the whole T2 over one
    // unparseable line, leaving every OTHER line in this same response unpersisted too. A row that
    // is skipped here simply stays `enviando` — recovered by `recoverStaleClaims` on a later pass,
    // the same recovery path a crash mid-T2 already relies on.
    const row = linea.RefExterna !== undefined ? byId.get(linea.RefExterna) : undefined;
    if (row === undefined) continue;
    // Already halted as a successor of an earlier rejection IN THIS SAME RESPONSE — see this
    // function's own doc comment on `halted`. AEAT's own verdict for this specific line must not
    // un-halt it.
    if (halted.has(row.id)) continue;
    const efectivo = resolveEstadoEfectivo(linea);
    await applyOutcome(tx, client, row, efectivo, linea, csv, now, result, halted);
  }
}

/** Routes one resolved line to its estado transition + side effects. `halted` collects any
 * SUCCESSOR ids this call halts, so `persistResponse`'s own loop skips them if their own response
 * line arrives later in the SAME response — see `persistResponse`'s doc comment on `halted`. */
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
      // CSV is written in the SAME transaction as the response — the highest-consequence line in
      // the outbox (spec §7). Dropping this write must fail drain.test.ts's TEETH test.
      await setEstado(tx, row.id, "aceptado", { csv, confirmadoEn: now });
      result.recordsAccepted += 1;
      return;
    case "accepted_with_errors": {
      // Still an accept — DrainResult.recordsAccepted's own doc comment: "includes
      // accepted-with-errors — still counts as accepted". The record IS stored by AEAT; only a
      // warning incident distinguishes this from a clean accept.
      await setEstado(tx, row.id, "aceptado_con_errores", { csv, confirmadoEn: now });
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
      await setEstado(tx, row.id, "rechazado", {
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
      // 1 (this record) + however many still-pending/in-flight successors on the SAME chain this
      // rejection just orphaned. Their ids are folded into `halted` (not just counted) so
      // `persistResponse`'s own loop skips them if THEIR OWN response line also appears in this
      // same batch — see `persistResponse`'s doc comment on `halted` for why that matters.
      const haltedIds = await haltSuccessors(tx, row);
      for (const id of haltedIds) halted.add(id);
      result.recordsHalted += 1 + haltedIds.length;
      return;
    }
    // duplicate_annulled / duplicate_unknown — error-3000 Route A / Route B resolution; see
    // handleDuplicate's own doc comment. `halted` is threaded through for the same reason the
    // "rejected" branch above threads it: both of handleDuplicate's halting outcomes (Route A,
    // and Route B's mismatch) may ALSO halt successors claimed in this SAME batch/response.
    default:
      await handleDuplicate(tx, client, row, efectivo, csv, now, result, halted);
  }
}

/**
 * Writes one row's estado transition. `confirmadoEn`/`codigoError`/`mensajeError`/`incidencia` are
 * all optional because each `applyOutcome`/`handleDuplicate` branch supplies only what it has — an
 * accept has no error code, a rejection has no `confirmadoEn`. `csv` alone is REQUIRED, not
 * optional: every branch across `applyOutcome` and `handleDuplicate` (Task 9's accept/
 * accepted-with-errors/rejected, and Task 10's Route A/B) has the envío's own CSV in hand — even a
 * duplicate LINE's envío still returns one (AEAT's CSV is per-submission, not per-line), and Route
 * B's own `routeB` never needs to read one off its consulta response (which carries none at all —
 * `RegistroConsultado`'s own doc comment, @waitron/verifactu/src/xml/parse-consulta.ts) because it
 * reuses the SAME outer envío CSV every other branch already has. An earlier draft of this
 * function made `csv` optional and `coalesce`d it against the existing column, anticipating a
 * hypothetical future caller with no CSV to report at all — no such caller exists as of this
 * package's last drainer task, so a required parameter (TypeScript-enforced at every call site)
 * replaces a defensive branch nothing here exercises. A later caller with a genuine no-CSV
 * resolution (e.g. a stand-alone reconciliation sweep outside `persistResponse`'s own envío-response
 * flow) can reintroduce that shape then, with its own test proving it needed.
 *
 * `codigoError`/`mensajeError` are cast to `String(...)` explicitly rather than left as the raw
 * `number` `resolveEstadoEfectivo`'s caller reads off `RespuestaLinea.CodigoErrorRegistro` —
 * `codigo_error` (`./schema/envios.ts`) is a `text` column, and relying on whichever Postgres
 * driver happens to be underneath (PGlite here, `pg` in production) to stringify a bound numeric
 * parameter the same way for a `text` column is not a guarantee this file should lean on.
 */
async function setEstado(
  tx: Transaction,
  registroId: string,
  estado: string,
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
      incidencia = ${opts.incidencia ?? false} or incidencia
    where registro_id = ${registroId}
  `);
}

/**
 * Halts still-`pendiente`/`enviando` successors in the SAME chain (same `sif_id`, higher
 * `secuencia`) to `detenido`, flagging `incidencia` — so nothing later submits over the gap this
 * rejection just opened. Returns the halted registro ids (not merely a count): `applyOutcome`
 * folds them into `persistResponse`'s own `halted` set, because one of them may ALSO have its own
 * response line later in this SAME batch — see `persistResponse`'s doc comment on `halted` for
 * why that must not be allowed to overwrite the halt back to `aceptado`.
 *
 * No `WHERE ... AND e.registro_id <> ${row.id}` guard is needed: `row`'s own estado was already
 * moved to `rechazado` by `setEstado` (called by `applyOutcome` before this), so it can never
 * match this UPDATE's own `estado in ('pendiente', 'enviando')` filter a second time.
 */
async function haltSuccessors(tx: Transaction, row: DueRow): Promise<string[]> {
  const halted = await tx.execute<{ registro_id: string }>(sql`
    update envios e set estado = 'detenido', incidencia = true
    from registros_facturacion r
    where r.id = e.registro_id and r.sif_id = ${row.sif_id} and r.secuencia > ${row.secuencia}
      and e.estado in ('pendiente', 'enviando')
    returning e.registro_id
  `);
  return halted.rows.map((r) => r.registro_id);
}

/**
 * Raises a structured fiscal incident on THIS transaction — never a fresh connection, so an
 * incident can never commit while the estado update it describes rolls back alongside it.
 * Delegates to `@waitron/core`'s `recordIncident`, the same function `packages/core`'s
 * `record-sale.ts`/`record-void.ts` already use for `chain.verification_failed`, rather than a
 * second, hand-rolled `insert into incidents` here: one place owns the table's shape and the
 * "code + params from an `AppError`, never prose" rule (spec §9), and this drainer is simply
 * another caller of it, exactly like `packages/core`'s own incident sites.
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
    tenantId: row.tenant_id as TenantId,
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
 * holds (`resolveEstadoEfectivo`'s own doc comment on the "3000 inverts" rule) — a targeted
 * consulta for exactly this one record is how the ambiguity resolves. Comparing AEAT's stored
 * `Huella` against ours is deliberately the ONLY field compared: `RegistroConsultado`'s own doc
 * comment (@waitron/verifactu/src/xml/parse-consulta.ts) — "a single-field check equivalent to
 * diffing every hashed field" — the huella already IS the summary of every hashed field on the
 * record, so nothing else `DatosRegistroFacturacion` carries needs comparing.
 *
 * Period derivation: `Ejercicio`/`Periodo` come straight off the record's own
 * `fecha_expedicion_factura` (stored `YYYY-MM-DD`), never a separate `FechaOperacion` — our
 * records never carry one (`AltaInput.FechaOperacion` is optional and `toRegistroRow`,
 * ./registro-row.ts, never populates it), so operation month is always the expedition month
 * (spec §1), with no ambiguity about which period to query. `FechaExpedicionFactura` in the
 * filtro is `toAeatDate`'s `YYYY-MM-DD` -> `DD-MM-YYYY` flip (./registro-row.ts, exported for
 * this call site — the exact inverse of the `toIsoDate` transform that wrote this column in the
 * first place, so this is not a second, independently-drifting copy of that formatting).
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
 * Replaces Task 9's stub with the real error-3000 resolution for the two duplicate cases
 * `resolveEstadoEfectivo` can hand back (a plain accept never reaches here — that's the
 * `"accepted"`/`"accepted_with_errors"` branches in `applyOutcome` above):
 *
 *   - Route A (`duplicate_annulled`): AEAT's own copy of this identity is itself `Anulada`.
 *     Whatever produced that state, this record can never become a confirmed accept from our side
 *     under this identity — the invoice number is burned, and retrying changes nothing — so it
 *     halts visibly with its own incident (`fiscal.duplicado_anulado`) rather than looping on
 *     `proximo_intento_en` forever.
 *   - Route B (`duplicate_unknown`): resolved by `routeB` above. A matching huella means this IS
 *     our own record, already genuinely stored at AEAT (spec §7's own trap: "a naive reading of
 *     error 3000 marks an accepted record rejected") — resolves to `aceptado`, exactly like a
 *     plain accept. A differing huella means the identity collided with something AEAT holds that
 *     is NOT our record — halts with its own incident (`fiscal.huella_divergente`).
 *
 * Both halting branches (Route A, and Route B's mismatch) ALSO halt this chain's successors,
 * mirroring `applyOutcome`'s `"rejected"` branch and for the identical reason: in neither case
 * does THIS record end up a confirmed accept at AEAT, so a successor's own `RegistroAnterior`
 * pointer at this record's locally-computed huella is not something AEAT has actually confirmed
 * either — precisely the unresolved-predecessor gap `haltSuccessors`/`haltOpenChainClaims` exist
 * to stop a later submission from crossing. The halted ids are folded into `persistResponse`'s own
 * `halted` set for the same reason `applyOutcome`'s `"rejected"` branch does: a successor claimed
 * in this SAME batch may carry its own (chain-blind) "Correcto" response line later in this very
 * response, which must not be allowed to overwrite the halt back to `aceptado` — see
 * `persistResponse`'s doc comment on `halted`. Route B's MATCH branch does not halt anything,
 * matching the plain `"accepted"` branch above: the record IS a confirmed accept, so nothing
 * downstream is blocked.
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
    await setEstado(tx, row.id, "detenido", { csv, incidencia: true });
    await raiseIncident(
      tx,
      row,
      "error",
      new AppError("fiscal.duplicado_anulado", { registroId: row.id }),
      now,
      result,
    );
    const haltedIds = await haltSuccessors(tx, row);
    for (const id of haltedIds) halted.add(id);
    result.recordsHalted += 1 + haltedIds.length;
    return;
  }

  // duplicate_unknown -> Route B: consult, compare huella.
  const matched = await routeB(client, row);
  if (matched) {
    await setEstado(tx, row.id, "aceptado", { csv, confirmadoEn: now });
    result.recordsAccepted += 1;
    return;
  }
  await setEstado(tx, row.id, "detenido", { csv, incidencia: true });
  await raiseIncident(
    tx,
    row,
    "error",
    new AppError("fiscal.huella_divergente", { registroId: row.id }),
    now,
    result,
  );
  const haltedIds = await haltSuccessors(tx, row);
  for (const id of haltedIds) halted.add(id);
  result.recordsHalted += 1 + haltedIds.length;
}
