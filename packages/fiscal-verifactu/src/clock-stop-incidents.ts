import "./errors.js";
import { and, asc, desc, eq, gt, lte, sql } from "drizzle-orm";
import type { SQL } from "drizzle-orm";
import { recordIncident, recordIncidentOnce } from "@waitron/core";
import { incidents } from "@waitron/db";
import type { Transaction } from "@waitron/db";
import { AppError, jobOrigin } from "@waitron/shared";
import type { ErrorParams, NodeId, SaleId } from "@waitron/shared";
import { chainHeads, storedHeads } from "./clock-behind.js";
import { clockStopRestarts } from "./schema/clock-stop-restarts.js";
import { registrosFacturacion } from "./schema/registros.js";

// Each restart's alerts carry its named record's sale, so the open-incident key (source, device,
// code, sale) keeps one restart's alerts apart from another's.
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
 * `bound`, any chain; a node either map leaves out counts from 0. Null when there are none. */
async function timesWrittenBetween(
  tx: Transaction,
  heads: Map<string, number>,
  bound: Map<string, number> | null,
): Promise<{ from: Date; to: Date } | null> {
  let from: Date | null = null;
  let to: Date | null = null;
  for (const node of Object.keys(await chainHeads(tx))) {
    const conditions: SQL[] = [
      eq(registrosFacturacion.nodeId, node as NodeId),
      gt(registrosFacturacion.secuencia, heads.get(node) ?? 0),
    ];
    if (bound !== null) conditions.push(lte(registrosFacturacion.secuencia, bound.get(node) ?? 0));
    const at = registrosFacturacion.fechaHoraHusoGenRegistro;
    const [earliest] = await tx
      .select({ at })
      .from(registrosFacturacion)
      .where(and(...conditions))
      .orderBy(asc(at), asc(registrosFacturacion.id))
      .limit(1);
    if (earliest === undefined) continue;
    const [latest] = await tx
      .select({ at })
      .from(registrosFacturacion)
      .where(and(...conditions))
      .orderBy(desc(at), desc(registrosFacturacion.id))
      .limit(1);
    if (from === null || earliest.at.getTime() < from.getTime()) from = earliest.at;
    if (to === null || latest!.at.getTime() > to.getTime()) to = latest!.at;
  }
  return from === null ? null : { from, to: to! };
}

/** For each restart in force at `trustedUntil` (`restarted_at ≤ trustedUntil < record_at`) with
 * no disproof alert yet, handled or not, records one naming the times written under it. A record
 * written after a later restart's stored heads belongs to that restart. A restart with no record
 * under it gets no alert and is answered in `unused`. */
export async function recordDisproofs(
  tx: Transaction,
  trustedUntil: Date,
): Promise<{ recorded: string[]; unused: string[] }> {
  const rows = await tx
    .select({
      id: clockStopRestarts.id,
      restartedAt: clockStopRestarts.restartedAt,
      recordAt: clockStopRestarts.recordAt,
      registroId: clockStopRestarts.registroId,
      proof: sql<string>`${clockStopRestarts.proof}`,
    })
    .from(clockStopRestarts)
    .orderBy(asc(clockStopRestarts.restartedAt), asc(clockStopRestarts.id));
  const withHeads = rows.map((row) => ({ ...row, heads: storedHeads(parsed(row.proof)) }));
  // Every restart writes its heads after the one before it, so the next by total is the next.
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
  const at = trustedUntil.getTime();
  const recorded: string[] = [];
  const unused: string[] = [];
  for (const restart of withHeads) {
    // Negated so that an unreadable stored time (NaN) is never in force.
    if (!(restart.restartedAt.getTime() <= at && at < restart.recordAt.getTime())) continue;
    if (disproved.has(restart.id)) continue;
    const heads = restart.heads;
    if (heads === null) {
      unused.push(restart.id);
      continue;
    }
    const own = total(heads);
    const next = byTotal.find((other) => other.sum > own)?.heads ?? null;
    const times = await timesWrittenBetween(tx, heads, next);
    if (times === null) {
      unused.push(restart.id);
      continue;
    }
    const inserted = await recordIncidentOnce(tx, {
      origin: jobOrigin("fiscal_filing"),
      saleId: await saleOf(tx, restart.registroId),
      error: new AppError("clock.behind_chain_disproved", {
        restartId: restart.id,
        from: times.from.toISOString(),
        to: times.to.toISOString(),
      }),
      severity: "error",
      detectedAt: trustedUntil,
    });
    if (inserted) recorded.push(restart.id);
  }
  return { recorded, unused };
}
