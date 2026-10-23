import "./errors.js";
import { and, desc, eq, gt, max, sql } from "drizzle-orm";
import type { Transaction } from "@waitron/db";
import type { ClockBehindLatestRecord } from "@waitron/fiscal";
import { AppError } from "@waitron/shared";
import type { NodeId } from "@waitron/shared";
import { refuseBeforeFirstIssueDate } from "./first-issue-date.js";
import { clockStopRestarts } from "./schema/clock-stop-restarts.js";
import { registrosFacturacion } from "./schema/registros.js";

/** A reading exactly this much earlier than the latest record still sells. */
export const CLOCK_BEHIND_MARGIN_MS = 60_000;

/** No restart is offered for, or covers, a gap wider than this, whatever gap it accepted. */
export const RESTART_CAP_MS = 86_400_000;

export interface LatestRecord {
  id: string;
  at: Date;
  offsetMinutes: number;
}

/** The latest record in any chain, ties broken by the larger id. Every caller that needs "the
 * latest record" reads it here, so a restart names the same record the stop compares against. */
export async function latestRecord(tx: Transaction): Promise<LatestRecord | undefined> {
  const [latest] = await tx
    .select({
      id: registrosFacturacion.id,
      at: registrosFacturacion.fechaHoraHusoGenRegistro,
      offsetMinutes: registrosFacturacion.offsetMinutos,
    })
    .from(registrosFacturacion)
    .orderBy(desc(registrosFacturacion.fechaHoraHusoGenRegistro), desc(registrosFacturacion.id))
    .limit(1);
  return latest;
}

/** Every chain's node and the largest `secuencia` it holds now. */
export async function chainHeads(tx: Transaction): Promise<Record<string, number>> {
  const rows = await tx
    .select({ node: registrosFacturacion.nodeId, head: max(registrosFacturacion.secuencia) })
    .from(registrosFacturacion)
    .groupBy(registrosFacturacion.nodeId);
  return Object.fromEntries(rows.map((row) => [row.node, Number(row.head)]));
}

/** The chain heads a restart stored in its proof, or null for anything a correct writer never
 * stores. Never throws. */
export function storedHeads(proof: unknown): Map<string, number> | null {
  if (typeof proof !== "object" || proof === null || Array.isArray(proof)) return null;
  const heads = (proof as { heads?: unknown }).heads;
  if (typeof heads !== "object" || heads === null || Array.isArray(heads)) return null;
  const out = new Map<string, number>();
  for (const [node, value] of Object.entries(heads)) {
    if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) return null;
    out.set(node, value);
  }
  return out;
}

function headOf(current: Record<string, number>, node: string): number {
  return Object.hasOwn(current, node) ? current[node]! : 0;
}

/** A stored proof read as text and parsed here, so text that is not JSON reads as null rather than
 * throwing from the stop. */
function parsedProof(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
}

/** The record with the latest generation time among those written after `heads`, any chain; a
 * node `heads` leaves out counts from 0. By time, not write order: a later write can carry an
 * earlier time. */
export async function latestWrittenAfter(
  tx: Transaction,
  heads: Map<string, number>,
  current: Record<string, number>,
): Promise<{ at: Date; offsetMinutes: number } | null> {
  let latest: { at: Date; offsetMinutes: number } | null = null;
  for (const [node, head] of Object.entries(current)) {
    const from = heads.get(node) ?? 0;
    if (head <= from) continue;
    const [row] = await tx
      .select({
        at: registrosFacturacion.fechaHoraHusoGenRegistro,
        offsetMinutes: registrosFacturacion.offsetMinutos,
      })
      .from(registrosFacturacion)
      .where(
        and(
          eq(registrosFacturacion.nodeId, node as NodeId),
          gt(registrosFacturacion.secuencia, from),
        ),
      )
      .orderBy(desc(registrosFacturacion.fechaHoraHusoGenRegistro), desc(registrosFacturacion.id))
      .limit(1);
    // `head > from`, so a record past `from` exists.
    if (latest === null || row!.at.getTime() > latest.at.getTime()) latest = row!;
  }
  return latest;
}

/** Null when the restart naming `latest` covers the reading; otherwise the record the refusal
 * names: the latest one written under the restart when that is what the reading falls behind. */
async function uncoveredBy(
  tx: Transaction,
  latest: LatestRecord,
  reading: { instant: Date },
): Promise<{ at: Date; offsetMinutes: number } | null> {
  const [restart] = await tx
    .select({
      clockAt: clockStopRestarts.clockAt,
      recordAt: clockStopRestarts.recordAt,
      proof: sql<string>`${clockStopRestarts.proof}`,
    })
    .from(clockStopRestarts)
    .where(eq(clockStopRestarts.registroId, latest.id));
  if (restart === undefined) return latest;
  const heads = storedHeads(parsedProof(restart.proof));
  if (heads === null) return latest;
  const current = await chainHeads(tx);
  for (const [node, head] of heads) if (head > headOf(current, node)) return latest;
  if (restart.recordAt.getTime() !== latest.at.getTime()) return latest;
  const accepted = restart.recordAt.getTime() - restart.clockAt.getTime();
  const gap = latest.at.getTime() - reading.instant.getTime();
  // Negated so that an unreadable stored time (NaN) covers nothing.
  if (!(gap <= Math.min(accepted + CLOCK_BEHIND_MARGIN_MS, RESTART_CAP_MS))) return latest;
  const under = await latestWrittenAfter(tx, heads, current);
  if (under !== null && reading.instant.getTime() < under.at.getTime() - CLOCK_BEHIND_MARGIN_MS)
    return under;
  return null;
}

/** Reads every chain, not the reading's node's: a restored database may hold only an older
 * chain's records, and a new chain must not start before them. */
export async function clockBehindChain(
  tx: Transaction,
  reading: { instant: Date; offsetMinutes: number },
): Promise<ClockBehindLatestRecord | null> {
  const latest = await latestRecord(tx);
  if (
    latest === undefined ||
    reading.instant.getTime() >= latest.at.getTime() - CLOCK_BEHIND_MARGIN_MS
  )
    return null;
  const named = await uncoveredBy(tx, latest, reading);
  if (named === null) return null;
  return {
    clockAt: reading.instant.toISOString(),
    offsetMinutes: reading.offsetMinutes,
    lastRecordAt: named.at.toISOString(),
    lastRecordOffsetMinutes: named.offsetMinutes,
  };
}

/** `clock.unusable` before 28-10-2024, else `clock.behind_chain` while `clockBehindChain` answers. */
export async function refuseWhileClockBehind(
  tx: Transaction,
  reading: { instant: Date; offsetMinutes: number },
): Promise<void> {
  refuseBeforeFirstIssueDate(reading);
  const behind = await clockBehindChain(tx, reading);
  if (behind !== null) throw new AppError("clock.behind_chain", behind);
}
