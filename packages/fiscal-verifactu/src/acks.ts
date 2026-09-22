import { sql } from "drizzle-orm";
import { nowIso, withTransaction } from "@waitron/db";
import type { Database, Transaction } from "@waitron/db";
import type { AckState } from "@waitron/fiscal";

/**
 * The ack contract, its durable-table transport, and the in-process consumer that projects an
 * unsent count from a stream of acks (plan 3b design §7).
 *
 * The load-bearing invariant lives in `acks` (schema/acks.ts): "an ack never disagrees with the
 * committed `envios.estado`/`csv` it reflects." `writeAck` is the sole producer, always called in
 * the SAME transaction as the estado write it reflects (the drainer's persist tx, reconcile's
 * correction tx), and it derives the ack from the row that transaction just wrote — so the two
 * commit together and can never diverge. `ackStateOf` is the ONE place the estado→AckState mapping
 * lives; `writeAck` reads the row, computes the state in TypeScript, and upserts, so the mapping is
 * never re-expressed in SQL where it could drift.
 */

/** One ack as it crosses to a downstream consumer. Regime-neutral: `state` is the settled
 * `AckState`, not a raw envío estado. */
export interface Ack {
  recordId: string;
  submittedAt: Date;
  csv: string | null;
  state: AckState;
}

/**
 * The SINGLE source of truth for the envío-estado → `AckState` mapping. Every terminal estado maps
 * to the settled state a downstream consumer acts on; every non-terminal estado (`pendiente` /
 * `enviando`) yields `null` — there is nothing to acknowledge yet, so `writeAck` no-ops on it.
 */
export function ackStateOf(estado: string): AckState | null {
  switch (estado) {
    case "aceptado":
      return "accepted";
    case "aceptado_con_errores":
      return "accepted_with_errors";
    case "rechazado":
      return "rejected";
    case "detenido":
      return "halted";
    default:
      return null; // pendiente / enviando — not yet terminal
  }
}

/**
 * Upserts the ack for `registroId`, derived from the `envios` row THIS transaction just wrote — so
 * the ack and the estado it reflects commit atomically and can never disagree. A no-op when the
 * estado is non-terminal (`ackStateOf` returns null): there is nothing to acknowledge yet.
 *
 * `submitted_at` coalesces `envios.enviado_en` to `now` because the column is NOT NULL and a
 * lost-ack row reconcile corrects may never have been claimed (no `enviado_en`). `csv` rides
 * straight off the row (null for a reconcile correction — consulta can never return it). The
 * upsert resets `delivered_at` to null on conflict, so a corrected state re-delivers downstream.
 *
 * The fallback binds `now.toISOString()` with NO cast. It used to carry `::timestamptz`, which
 * SQLite refuses at prepare time — it reads the first colon as the start of a bind parameter and
 * rejects the whole statement with `unrecognized token: ":"`. The cast has nothing left to do:
 * both `envios.enviado_en` and `acks.submitted_at` are `ts` columns, which on this engine hold the
 * exact output of `Date.prototype.toISOString` as text (`packages/db/src/schema/columns.ts`'s
 * `isoTimestamp`), so the two `coalesce` arms are already the same type and the same encoding.
 * Measured 2026-09-22 on Node v26.7.0 against `node:sqlite`, with the identical statement minus
 * the cast as the control: the cast threw, and the control returned the row's own
 * `2026-07-21T00:00:00.000Z` where `enviado_en` was set and the bound fallback where it was null.
 * Guard: the `takes the envío's own enviado_en when it has one, and the passed instant when it
 * does not` case in `acks.test.ts`, which reaches this function directly rather than through the
 * drainer. Proven by deletion the same day, in both directions: putting the cast back left it red
 * on `unrecognized token: ":"`, and dropping the `e.enviado_en` arm left it red on the claimed
 * row's own instant.
 *
 * The estado→state mapping is computed once in TypeScript (`ackStateOf`) and only the resulting
 * `state` is bound into SQL; every other column flows from the committed row, so the mapping is
 * never duplicated in raw SQL where the two could drift.
 */
export async function writeAck(tx: Transaction, registroId: string, now: Date): Promise<void> {
  const { rows } = await tx.execute<{ estado: string }>(
    sql`select estado from envios where registro_id = ${registroId}`,
  );
  const estado = rows[0]?.estado;
  if (estado === undefined) return; // no envío row — nothing to acknowledge
  const state = ackStateOf(estado);
  if (state === null) return; // non-terminal estado — no ack yet

  await tx.execute(sql`
    insert into acks (registro_id, submitted_at, csv, state, delivered_at)
    select
      e.registro_id,
      coalesce(e.enviado_en, ${now.toISOString()}),
      e.csv,
      ${state},
      null
    from envios e
    where e.registro_id = ${registroId}
    on conflict (registro_id) do update set
      state = excluded.state,
      csv = excluded.csv,
      submitted_at = excluded.submitted_at,
      delivered_at = null
  `);
}

/** Removes a record's ack row. Used when reconcile resets an `aceptado` record to `pendiente` (a
 * `noTrace` remediation): `ackStateOf('pendiente')` is null, so the record must carry NO ack, or the
 * committed ack would disagree with the estado (the acks invariant). The drainer writes a fresh ack
 * when it re-accepts the record. Idempotent — deleting an absent ack is a no-op. */
export async function deleteAck(tx: Transaction, registroId: string): Promise<void> {
  await tx.execute(sql`delete from acks where registro_id = ${registroId}`);
}

/** Every undelivered ack, oldest submission first. */
export async function pendingAcks(db: Database): Promise<Ack[]> {
  return withTransaction(db, async (tx) => {
    const { rows } = await tx.execute<{
      registro_id: string;
      submitted_at: string | Date;
      csv: string | null;
      state: string;
    }>(sql`
      select registro_id, submitted_at, csv, state
      from acks
      where delivered_at is null
      order by submitted_at, registro_id
    `);
    return rows.map((r) => ({
      recordId: r.registro_id,
      submittedAt: new Date(r.submitted_at),
      csv: r.csv,
      state: r.state as AckState,
    }));
  });
}

/**
 * Marks one ack delivered, so `pendingAcks` stops returning it. Runs inside `withTransaction`.
 *
 * The clock is read in JavaScript and bound: `now()` is a PostgreSQL function this engine does not
 * have, and the statement was refused at PREPARE with `no such function: now` before any row was
 * touched. `nowIso` rather than `now` because raw SQL never reaches the column's own write mapping,
 * which is what turns a `Date` into the ISO string a `ts` column stores.
 */
export async function markDelivered(db: Database, recordId: string): Promise<void> {
  await withTransaction(db, (tx) =>
    tx.execute(sql`update acks set delivered_at = ${nowIso()} where registro_id = ${recordId}`),
  );
}

/**
 * The in-memory unsent-count projection the in-process consumer drives. `counted` is the set of
 * records the till still counts as unsent (not yet accepted by AEAT); `flagged` is the subset a
 * `rejected`/`halted` ack marked for operator attention. A record leaves `counted` only when an
 * accepting ack confirms it — so a record that never receives one (cert expired before submission)
 * stays counted, exactly as the till must keep reporting it.
 */
export interface UnsentProjection {
  readonly counted: Set<string>;
  readonly flagged: Set<string>;
}

/** Seeds the projection with the records currently believed unsent (every submitted-but-unconfirmed
 * record). Acks then move records out of `counted` as they confirm. */
export function newProjection(recordIds: Iterable<string>): UnsentProjection {
  return { counted: new Set(recordIds), flagged: new Set() };
}

/** The unsent count the till reports downstream: records still counted, none of them yet confirmed
 * by an accepting ack. */
export function unsentCount(projection: UnsentProjection): number {
  return projection.counted.size;
}

/**
 * The state machine: fold one ack into the projection. `accepted`/`accepted_with_errors` confirm
 * the record — drop it from the count and clear any stale flag (a correction re-accepting a
 * previously-rejected record un-flags it). `rejected`/`halted` keep it counted AND flag it: a
 * refused or halted record is still unsent and now needs attention.
 */
export function applyAck(projection: UnsentProjection, ack: Ack): void {
  switch (ack.state) {
    case "accepted":
    case "accepted_with_errors":
      projection.counted.delete(ack.recordId);
      projection.flagged.delete(ack.recordId);
      return;
    case "rejected":
    case "halted":
      projection.counted.add(ack.recordId);
      projection.flagged.add(ack.recordId);
      return;
  }
}
