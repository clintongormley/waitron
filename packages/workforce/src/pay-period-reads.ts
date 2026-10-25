import { and, eq, gt, lt } from "drizzle-orm";
import type { Database, Transaction } from "@waitron/db";
import type { Period } from "./projection.js";
import type { PayPeriodClosure, PayPeriodSnapshot } from "./record-types.js";
import { payPeriodClosures } from "./schema/pay-period-closures.js";

export async function readClosures(
  tx: Database | Transaction,
  input: { locationId?: string; period: Period; personId?: string },
): Promise<PayPeriodClosure[]> {
  const rows = await tx
    .select()
    .from(payPeriodClosures)
    .where(
      and(
        input.locationId === undefined
          ? undefined
          : eq(payPeriodClosures.locationId, input.locationId),
        lt(payPeriodClosures.periodStart, input.period.end),
        gt(payPeriodClosures.periodEnd, input.period.start),
      ),
    );
  const personId = input.personId;
  return rows.map(({ periodStart, periodEnd, snapshot, ...row }) => ({
    ...row,
    period: { start: periodStart, end: periodEnd },
    snapshot: personId === undefined ? snapshot : snapshotOf(snapshot, personId),
  }));
}

// Cut before projecting, so one person's record projects her rows, not every snapshot's whole
// venue. Cutting in SQL with json_each measured slower than decoding here (A980 S2b task 6c).
function snapshotOf(snapshot: PayPeriodSnapshot, personId: string): PayPeriodSnapshot {
  const ownEntries = snapshot.entries.filter((e) => e.entry.personId === personId);
  const ownIds = new Set(ownEntries.map((e) => e.entry.entryId));
  return {
    sessions: snapshot.sessions.filter((s) => s.personId === personId),
    entries: ownEntries,
    summaries: snapshot.summaries.filter((s) => s.personId === personId),
    markedAutomaticEntryIds: snapshot.markedAutomaticEntryIds.filter((id) => ownIds.has(id)),
  };
}
