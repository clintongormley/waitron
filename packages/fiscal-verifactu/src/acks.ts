import { sql } from "drizzle-orm";
import { withTenant } from "@waitron/db";
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
    insert into acks (registro_id, tenant_id, submitted_at, csv, state, delivered_at)
    select
      e.registro_id,
      e.tenant_id,
      coalesce(e.enviado_en, ${now.toISOString()}::timestamptz),
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

/** Every undelivered ack for the tenant, oldest submission first — the transport read side. Runs
 * inside `withTenant`, so the acks tenant-isolation policy matches under a non-superuser role. */
export async function pendingAcks(db: Database, tenantId: string): Promise<Ack[]> {
  return withTenant(db, tenantId, async (tx) => {
    const { rows } = await tx.execute<{
      registro_id: string;
      submitted_at: string | Date;
      csv: string | null;
      state: string;
    }>(sql`
      select registro_id, submitted_at, csv, state
      from acks
      where tenant_id = ${tenantId} and delivered_at is null
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

/** Marks one ack delivered, so `pendingAcks` stops returning it. Runs inside `withTenant`. */
export async function markDelivered(
  db: Database,
  tenantId: string,
  recordId: string,
): Promise<void> {
  await withTenant(db, tenantId, (tx) =>
    tx.execute(
      sql`update acks set delivered_at = now() where tenant_id = ${tenantId} and registro_id = ${recordId}`,
    ),
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
