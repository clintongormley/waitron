import { desc, eq, max } from "drizzle-orm";
import type { Transaction } from "@waitron/db";
import type { BootReading } from "@waitron/fiscal";
import type { NodeId } from "@waitron/shared";
import { chainHeads, clockBehindChain, latestRecord, storedHeads } from "./clock-behind.js";
import { isBeforeFirstIssueDate } from "./first-issue-date.js";
import { clockChecks } from "./schema/clock-checks.js";
import { clockConfirmations } from "./schema/clock-confirmations.js";

export interface OpenCheck {
  id: string;
  reason: (typeof clockChecks.$inferSelect)["reason"];
  detail: unknown;
}

/** The open check: the one with the largest `seq`, while no confirmation names it. At most one
 * check is open, because a check opens only while none is. */
export async function openCheck(tx: Transaction): Promise<OpenCheck | null> {
  const [last] = await tx
    .select({ id: clockChecks.id, reason: clockChecks.reason, detail: clockChecks.detail })
    .from(clockChecks)
    .orderBy(desc(clockChecks.seq))
    .limit(1);
  if (last === undefined) return null;
  const [closing] = await tx
    .select({ id: clockConfirmations.id })
    .from(clockConfirmations)
    .where(eq(clockConfirmations.checkId, last.id))
    .limit(1);
  return closing === undefined ? last : null;
}

/** The `seq` the next check takes, read in the writing transaction (see the column's comment). */
export async function nextCheckSeq(tx: Transaction): Promise<number> {
  const [row] = await tx.select({ seq: max(clockChecks.seq) }).from(clockChecks);
  return (row?.seq ?? 0) + 1;
}

/** The `seq` the next confirmation takes, read in the writing transaction. */
export async function nextConfirmationSeq(tx: Transaction): Promise<number> {
  const [row] = await tx.select({ seq: max(clockConfirmations.seq) }).from(clockConfirmations);
  return (row?.seq ?? 0) + 1;
}

/** When the stop a check records began: the closing's time less the boot-time clock's elapsed time
 * since the check opened, when both ends read the same boot; otherwise the closing's time, flagged
 * `partial`. */
export function correctedStart(
  check: { detail: unknown },
  closing: { confirmedAt: Date; bootMs: number; bootId: string | null },
): { correctedStart: string; partial: boolean } {
  const detail = (check.detail ?? {}) as { bootMs?: unknown; bootId?: unknown };
  const elapsedMs = typeof detail.bootMs === "number" ? closing.bootMs - detail.bootMs : Number.NaN;
  // Negated so that an unreadable reading (NaN) takes the fallback.
  const sameBoot = closing.bootId !== null && detail.bootId === closing.bootId;
  if (!sameBoot || !(elapsedMs >= 0))
    return { correctedStart: closing.confirmedAt.toISOString(), partial: true };
  return {
    correctedStart: new Date(closing.confirmedAt.getTime() - elapsedMs).toISOString(),
    partial: false,
  };
}

/** Whether a record was written since the check opened: a node's head past its stored entry, or a
 * node missing from it. Heads a correct writer never stores count as moved. */
function headsMoved(detail: unknown, current: Record<string, number>): boolean {
  const stored = storedHeads(detail);
  if (stored === null) return true;
  return Object.entries(current).some(([node, head]) => head > (stored.get(node) ?? 0));
}

/** Opens a `behind_chain` check while the stop proper holds (a covering confirmation lifts it) and
 * none is open, and answers it; answers the open check while the chain has not moved past it.
 * When it has, a record was written at a reading the stop proper did not hold, so that stop ended
 * and a new one began: the old check closes `elapsed`, unconfirmed, and a new one opens. Null, and
 * nothing written, while the stop proper does not hold. */
export async function openClockCheck(
  tx: Transaction,
  input: {
    reading: { instant: Date; offsetMinutes: number };
    boot: BootReading;
    nodeId: string;
  },
): Promise<{ id: string } | null> {
  const { reading, boot } = input;
  const nodeId = input.nodeId as NodeId;
  if (isBeforeFirstIssueDate(reading)) return null;
  if ((await clockBehindChain(tx, reading)) === null) return null;
  const heads = await chainHeads(tx);
  const open = await openCheck(tx);
  if (open !== null) {
    if (!headsMoved(open.detail, heads)) return { id: open.id };
    await tx.insert(clockConfirmations).values({
      seq: await nextConfirmationSeq(tx),
      nodeId,
      boxClockAt: reading.instant,
      confirmedAt: reading.instant,
      stepMs: 0,
      source: "elapsed",
      personId: null,
      reason: open.reason,
      proof: {
        authority: null,
        devices: [],
        admin: null,
        closing: {
          bootMs: boot.ms,
          bootId: boot.id,
          ...correctedStart(open, {
            confirmedAt: reading.instant,
            bootMs: boot.ms,
            bootId: boot.id,
          }),
          unconfirmed: true,
        },
      },
      checkId: open.id,
      registroId: null,
      recordAt: null,
    });
  }
  // The stop proper holds, so a latest record exists.
  const latest = (await latestRecord(tx))!;
  const [row] = await tx
    .insert(clockChecks)
    .values({
      seq: await nextCheckSeq(tx),
      nodeId,
      openedAt: reading.instant,
      reason: "behind_chain",
      detail: {
        clockAt: reading.instant.toISOString(),
        bootMs: boot.ms,
        bootId: boot.id,
        lastRecordAt: latest.at.toISOString(),
        lastRecordId: latest.id,
        heads,
      },
    })
    .returning({ id: clockChecks.id });
  return { id: row!.id };
}
