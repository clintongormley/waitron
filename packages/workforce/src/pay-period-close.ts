import type { PaidBreakPolicy } from "./ruleset.js";
import { and, desc, eq, gte, isNull, lt, or } from "drizzle-orm";
import { newId, type Database, type Transaction } from "@waitron/db";
import {
  AppError,
  businessDayBoundaryAt,
  SOURCES,
  type BusinessDayClock,
  type JobOrigin,
  type Origin,
} from "@waitron/shared";
import { computeClosureHash } from "./pay-period-chain.js";
import { readClosures } from "./pay-period-reads.js";
import { invalidPeriod, readPayPeriodSettings, resolvePayPeriod } from "./pay-periods.js";
import { isRecordDate } from "./record-dates.js";
import { recordInPeriod } from "./record-period.js";
import { projectTimeRecord } from "./record-projection.js";
import { readPeriodEntries } from "./record-reads.js";
import { automaticEntryIdsWithoutMarker } from "./effective-entries.js";
import { dailyContractedTargetMinutes, summarisePeriod, type Period } from "./projection.js";
import type { PayPeriodClosure } from "./record-types.js";
import type { WorkSummaryRuleset } from "./clocking.js";
import { payPeriodClosures } from "./schema/pay-period-closures.js";
import { employments } from "./schema/employments.js";

function validatePeriod(period: Period): void {
  if (
    period === null ||
    typeof period !== "object" ||
    !isRecordDate(period.start) ||
    !isRecordDate(period.end) ||
    period.start >= period.end
  )
    invalidPeriod("period");
}
export async function readPayPeriodClosures(
  tx: Database | Transaction,
  input: { period: Period },
): Promise<PayPeriodClosure[]> {
  validatePeriod(input.period);
  return readClosures(tx, { period: input.period });
}
export async function closePayPeriod(
  tx: Transaction,
  input: {
    nodeId: string;
    period: Period;
    clock: BusinessDayClock;
    now: string;
    scheduledCloseAt?: string;
    ruleset: WorkSummaryRuleset | null;
    paidBreakPolicy: PaidBreakPolicy | null;
    origin: JobOrigin;
  },
): Promise<PayPeriodClosure> {
  validatePeriod(input.period);
  const existing = await readClosures(tx, { period: input.period });
  const replay = existing.find(
    (row) => row.period.start === input.period.start && row.period.end === input.period.end,
  );
  if (replay !== undefined) return replay;
  if (existing.length) invalidPeriod("overlap");
  const expected = resolvePayPeriod(await readPayPeriodSettings(tx), input.period.start);
  if (expected.start !== input.period.start || expected.end !== input.period.end)
    invalidPeriod("cadence");
  if (
    input.origin === null ||
    typeof input.origin !== "object" ||
    (input.origin as Origin).source === "device" ||
    input.origin.deviceId !== null ||
    !SOURCES.includes(input.origin.source)
  )
    invalidPeriod("origin");
  const nowMs = typeof input.now === "string" ? Date.parse(input.now) : NaN;
  if (!Number.isFinite(nowMs)) invalidPeriod("now");
  const closedAt = new Date(nowMs).toISOString();
  const scheduledCloseAt =
    input.scheduledCloseAt ?? businessDayBoundaryAt(input.clock, input.period.end);
  if (closedAt < scheduledCloseAt)
    throw new AppError("pay_period.not_due", { closeAt: scheduledCloseAt });
  const entries = await readPeriodEntries(tx, { period: input.period });
  const closureId = newId();
  const record = recordInPeriod(
    projectTimeRecord(entries, [], input.paidBreakPolicy),
    input.period,
  );
  const unmarked = automaticEntryIdsWithoutMarker(entries);
  const snapshot: PayPeriodClosure["snapshot"] = {
    sessions: record.sessions,
    entries: record.entries,
    summaries: [],
    markedAutomaticEntryIds: entries
      .filter(
        (entry) =>
          unmarked.has(entry.entryId) &&
          record.sessions.some(
            (session) => session.personId === entry.personId && session.endedAt === entry.eventAt,
          ),
      )
      .map((entry) => entry.entryId)
      .sort(),
    ...(input.paidBreakPolicy === null ? {} : { paidBreakPolicy: input.paidBreakPolicy }),
  };
  const people = [...new Set(snapshot.entries.map((e) => e.entry.personId))].sort();
  const { ruleset } = input;
  for (const personId of people) {
    if (ruleset === null) {
      snapshot.summaries.push({ personId, summary: null });
      continue;
    }
    const [employment] = await tx
      .select()
      .from(employments)
      .where(
        and(
          eq(employments.personId, personId),
          lt(employments.startDate, input.period.end),
          or(isNull(employments.endDate), gte(employments.endDate, input.period.start)),
        ),
      )
      .orderBy(desc(employments.startDate))
      .limit(1);
    snapshot.summaries.push({
      personId,
      summary:
        employment === undefined
          ? null
          : summarisePeriod(
              record.sessions.filter((s) => s.personId === personId),
              input.period,
              {
                periodMinutes: Math.round(
                  (employment.contractedMinutesPerWeek *
                    (Date.parse(input.period.end) - Date.parse(input.period.start))) /
                    86400000 /
                    7,
                ),
                dailyTargetMinutes:
                  ruleset.dailyTargetMinutes ??
                  dailyContractedTargetMinutes(
                    employment.contractedMinutesPerWeek,
                    ruleset.workingDaysPerWeek,
                  ),
              },
              ruleset.overtimeModel,
            ),
    });
  }
  const [previous] = await tx
    .select()
    .from(payPeriodClosures)
    .where(eq(payPeriodClosures.nodeId, input.nodeId))
    .orderBy(desc(payPeriodClosures.sequenceNo))
    .limit(1);
  const value: Omit<PayPeriodClosure, "closureHash"> = {
    id: closureId,
    nodeId: input.nodeId,
    period: input.period,
    clock: structuredClone(input.clock),
    scheduledCloseAt,
    closedAt,
    snapshot,
    sequenceNo: (previous?.sequenceNo ?? 0) + 1,
    prevClosureHash: previous?.closureHash ?? null,
  };
  const closure = { ...value, closureHash: computeClosureHash(value) };
  await tx
    .insert(payPeriodClosures)
    .values({ ...closure, periodStart: input.period.start, periodEnd: input.period.end });
  return closure;
}
