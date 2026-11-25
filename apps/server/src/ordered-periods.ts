import { billOrderedPeriods, statementChunks, type Transaction } from "@waitron/db";
import { eq, sql } from "drizzle-orm";
import { VENUE_SERVICE } from "./modules.js";

export async function recordOrderedPeriods(
  tx: Transaction,
  billId: string,
  placedAt: Date,
  draftAddTimes: readonly string[] = [],
): Promise<void> {
  const context = await VENUE_SERVICE.findOrderContext(tx, billId);
  if (context === null) return;
  const keys = new Set<string>();
  const recordAt = async (at: Date) => {
    const { periodOccurrenceKey } = await VENUE_SERVICE.resolveDepartmentService(
      tx,
      context.departmentId,
      at,
    );
    if (periodOccurrenceKey !== null) keys.add(periodOccurrenceKey);
  };
  // The timetable resolves whole minutes. Several saved dishes can share one lookup.
  const draftMinutes = new Set(draftAddTimes.map((at) => at.slice(0, 16)));
  for (const minute of draftMinutes) await recordAt(new Date(`${minute}:00Z`));
  if (keys.size === 0 && !draftMinutes.has(placedAt.toISOString().slice(0, 16))) {
    await recordAt(placedAt);
  }
  const rows = [...keys].map((occurrenceKey) => ({ billId, occurrenceKey }));
  for (const chunk of statementChunks(billOrderedPeriods, rows)) {
    await tx
      .insert(billOrderedPeriods)
      .values(chunk)
      .onConflictDoNothing({
        target: [billOrderedPeriods.billId, billOrderedPeriods.occurrenceKey],
      });
  }
}

// A moved dish takes the bill's period history, including any periods its other dishes earned.
export async function carryOrderedPeriods(
  tx: Transaction,
  from: string,
  to: string,
): Promise<void> {
  await tx
    .insert(billOrderedPeriods)
    .select(
      tx
        .select({
          billId: sql<string>`${to}`.as("bill_id"),
          occurrenceKey: billOrderedPeriods.occurrenceKey,
        })
        .from(billOrderedPeriods)
        .where(eq(billOrderedPeriods.billId, from)),
    )
    .onConflictDoNothing({ target: [billOrderedPeriods.billId, billOrderedPeriods.occurrenceKey] });
}
