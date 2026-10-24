import "./errors.js";
import { and, asc, eq, gt, isNotNull, lte, sql } from "drizzle-orm";
import type { SQL } from "drizzle-orm";
import { recordIncident, recordIncidentOnce } from "@waitron/core";
import { incidents } from "@waitron/db";
import type { Transaction } from "@waitron/db";
import { AppError, jobOrigin } from "@waitron/shared";
import type { ErrorParams, NodeId, SaleId } from "@waitron/shared";
import { chainHeads, storedHeads } from "./clock-behind.js";
import { misdatedRecords } from "./clock-misdated.js";
import { clockConfirmations } from "./schema/clock-confirmations.js";
import { registrosFacturacion } from "./schema/registros.js";

// Each lift's alerts carry its named record's sale, so the open-incident key (source, device, code,
// sale) keeps one lift's alerts apart from another's.
async function saleOf(tx: Transaction, recordId: string): Promise<SaleId> {
  const [row] = await tx
    .select({ saleId: registrosFacturacion.saleId })
    .from(registrosFacturacion)
    .where(eq(registrosFacturacion.id, recordId));
  return row!.saleId as SaleId;
}

export async function recordRestarted(
  tx: Transaction,
  input: {
    recordId: string;
    detectedAt: Date;
    params: ErrorParams["clock.behind_chain_restarted"];
  },
): Promise<void> {
  await recordIncident(tx, {
    origin: jobOrigin("dashboard"),
    saleId: await saleOf(tx, input.recordId),
    error: new AppError("clock.behind_chain_restarted", input.params),
    severity: "warning",
    detectedAt: input.detectedAt,
  });
}

/** Records `clock.records_misdated` for the closing just written as `confirmationId`, when
 * `misdatedRecords` finds any record or cannot tell; a closing that finds none records nothing.
 * Its sale is the earliest listed record's, or, when it cannot tell, the latest record's when the
 * check opened, so a second such closing on the same sale folds into the open alert. */
export async function recordMisdated(
  tx: Transaction,
  input: {
    confirmationId: string;
    check: { openedAt: Date; detail: unknown };
    partial: boolean;
    reading: { instant: Date; offsetMinutes: number };
  },
): Promise<void> {
  const { confirmationId, partial, reading } = input;
  // The caller has just written the confirmation, so the answer is never null.
  const answer = (await misdatedRecords(tx, confirmationId))!;
  let saleId: SaleId | undefined;
  let params: ErrorParams["clock.records_misdated"];
  if (answer.known) {
    const first = answer.records[0];
    if (first === undefined) return;
    const last = answer.records.at(-1)!;
    saleId = await saleOf(tx, first.recordId);
    params = {
      confirmationId,
      count: answer.records.length,
      from: first.generatedAt,
      fromOffsetMinutes: first.offsetMinutes,
      to: last.generatedAt,
      toOffsetMinutes: last.offsetMinutes,
      partial,
      unconfirmed: false,
    };
  } else {
    const opening = (input.check.detail as { lastRecordId?: unknown } | null)?.lastRecordId;
    saleId = typeof opening === "string" ? await saleOf(tx, opening) : undefined;
    params = {
      confirmationId,
      count: 0,
      from: input.check.openedAt.toISOString(),
      fromOffsetMinutes: reading.offsetMinutes,
      partial,
      unconfirmed: true,
    };
  }
  await recordIncident(tx, {
    origin: jobOrigin("dashboard"),
    saleId,
    error: new AppError("clock.records_misdated", params),
    severity: "error",
    detectedAt: reading.instant,
  });
}

function parsed(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
}

function total(heads: Map<string, number>): number {
  let sum = 0;
  for (const head of heads.values()) sum += head;
  return sum;
}

/** The earliest and latest generation times among the records past `heads` and at or before
 * `bound`, on the chains `current` names; a node either map leaves out counts from 0. Null when
 * there are none. */
async function timesWrittenBetween(
  tx: Transaction,
  current: readonly string[],
  heads: Map<string, number>,
  bound: Map<string, number> | null,
): Promise<{ from: Date; to: Date } | null> {
  let from = Infinity;
  let to = -Infinity;
  const at = registrosFacturacion.fechaHoraHusoGenRegistro;
  for (const node of current) {
    const conditions: SQL[] = [
      eq(registrosFacturacion.nodeId, node as NodeId),
      gt(registrosFacturacion.secuencia, heads.get(node) ?? 0),
    ];
    if (bound !== null) conditions.push(lte(registrosFacturacion.secuencia, bound.get(node) ?? 0));
    // Compared as stored text, as the stop's own `orderBy` on this column does.
    const [span] = await tx
      .select({ earliest: sql<string | null>`min(${at})`, latest: sql<string | null>`max(${at})` })
      .from(registrosFacturacion)
      .where(and(...conditions));
    // An aggregate answers one row, and both ends are null together when no record matches.
    if (span!.earliest === null) continue;
    from = Math.min(from, Date.parse(span!.earliest));
    to = Math.max(to, Date.parse(span!.latest!));
  }
  return from === Infinity ? null : { from: new Date(from), to: new Date(to) };
}

/** For each lift in force at `trustedUntil` (`confirmed_at ≤ trustedUntil < record_at`) with no
 * disproof alert yet, handled or not, records one naming the times written under it. A record
 * written after a later lift's stored heads belongs to that lift. A lift with no record under it
 * gets no alert and is answered in `unused`; one whose alert another open incident on the same sale
 * keeps out is answered in `held`. Each alert is dated `observedAt`, when the disproof was noticed,
 * never by the clock it disproves. A confirmation naming no record lifted nothing and is passed
 * over. */
export async function recordDisproofs(
  tx: Transaction,
  input: { trustedUntil: Date; observedAt: Date },
): Promise<{ recorded: string[]; unused: string[]; held: string[] }> {
  const rows = (
    await tx
      .select({
        id: clockConfirmations.id,
        confirmedAt: clockConfirmations.confirmedAt,
        recordAt: clockConfirmations.recordAt,
        registroId: clockConfirmations.registroId,
        proof: sql<string>`${clockConfirmations.proof}`,
      })
      .from(clockConfirmations)
      .where(isNotNull(clockConfirmations.registroId))
      .orderBy(asc(clockConfirmations.seq))
  )
    // A CHECK keeps `record_at` set wherever `registro_id` is.
    .map((row) => ({ ...row, registroId: row.registroId!, recordAt: row.recordAt! }));
  const withHeads = rows.map((row) => ({ ...row, heads: storedHeads(parsed(row.proof)) }));
  // Every lift writes its heads after the one before it, so the next by total is the next.
  const byTotal: { sum: number; heads: Map<string, number> }[] = [];
  for (const row of withHeads)
    if (row.heads !== null) byTotal.push({ sum: total(row.heads), heads: row.heads });
  byTotal.sort((a, b) => a.sum - b.sum);
  const disproved = new Set(
    (
      await tx
        .select({ restartId: sql<string>`json_extract(${incidents.params}, '$.restartId')` })
        .from(incidents)
        .where(eq(incidents.code, "clock.behind_chain_disproved"))
    ).map((row) => row.restartId),
  );
  const current = Object.keys(await chainHeads(tx));
  const at = input.trustedUntil.getTime();
  const recorded: string[] = [];
  const unused: string[] = [];
  const held: string[] = [];
  for (const lift of withHeads) {
    // Negated so that an unreadable stored time (NaN) is never in force.
    if (!(lift.confirmedAt.getTime() <= at && at < lift.recordAt.getTime())) continue;
    if (disproved.has(lift.id)) continue;
    const heads = lift.heads;
    if (heads === null) {
      unused.push(lift.id);
      continue;
    }
    const own = total(heads);
    const next = byTotal.find((other) => other.sum > own)?.heads ?? null;
    const times = await timesWrittenBetween(tx, current, heads, next);
    if (times === null) {
      unused.push(lift.id);
      continue;
    }
    const inserted = await recordIncidentOnce(tx, {
      origin: jobOrigin("fiscal_filing"),
      saleId: await saleOf(tx, lift.registroId),
      error: new AppError("clock.behind_chain_disproved", {
        restartId: lift.id,
        from: times.from.toISOString(),
        to: times.to.toISOString(),
      }),
      severity: "error",
      detectedAt: input.observedAt,
    });
    (inserted ? recorded : held).push(lift.id);
  }
  return { recorded, unused, held };
}
