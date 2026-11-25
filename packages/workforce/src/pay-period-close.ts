import { setImmediate } from "node:timers/promises";
import type { PaidBreakPolicy } from "./ruleset.js";
import { and, desc, eq, gte, isNull, lt, or, sql } from "drizzle-orm";
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
import { readPeriodEntries, readTimeRecord } from "./record-reads.js";
import { automaticEntryIdsWithoutMarker } from "./effective-entries.js";
import { dailyContractedTargetMinutes, summarisePeriod, type Period } from "./projection.js";
import type { PayPeriodAdjustment, PayPeriodClosure } from "./record-types.js";
import type { WorkSummaryRuleset } from "./clocking.js";
import { payPeriodClosures } from "./schema/pay-period-closures.js";
import { employments } from "./schema/employments.js";
import { timeEntries } from "./schema/time-entries.js";

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
async function readAdjustments(
  tx: Transaction,
  closingPeriod: Period,
): Promise<PayPeriodAdjustment[]> {
  const earlier = await readClosures(tx, { endingBy: closingPeriod.start });
  const balances = new Map<string, Map<string, number>>();
  for (const closure of earlier) {
    for (const adjustment of closure.snapshot.adjustments ?? []) {
      const { sourcePeriodStart, personId, workedMinutes } = adjustment;
      const people = balances.get(sourcePeriodStart) ?? new Map<string, number>();
      people.set(personId, (people.get(personId) ?? 0) - workedMinutes);
      balances.set(sourcePeriodStart, people);
    }
  }
  const adjustments: PayPeriodAdjustment[] = [];
  for (const closure of earlier.sort((a, b) => a.period.start.localeCompare(b.period.start))) {
    await setImmediate();
    const sourcePeriodStart = closure.period.start;
    const people = balances.get(sourcePeriodStart) ?? new Map<string, number>();
    const { closedPeriodImpacts } = await readTimeRecord(tx, { period: closure.period }, null, [
      closure,
    ]);
    for (const { personId, deltaWorkedMinutes } of closedPeriodImpacts)
      people.set(personId, (people.get(personId) ?? 0) + deltaWorkedMinutes);
    for (const [personId, workedMinutes] of people)
      if (workedMinutes !== 0) adjustments.push({ personId, sourcePeriodStart, workedMinutes });
  }
  return adjustments;
}

async function adjustmentRevision(tx: Transaction): Promise<string> {
  // Both tables are append-only, so a committed addition changes this revision.
  const { rows } = await tx.execute<{ revision: string }>(sql`
    select (select count(*) from ${timeEntries}) || ':' ||
           (select count(*) from ${payPeriodClosures}) as revision
  `);
  return rows[0]!.revision;
}
export async function preparePayPeriodAdjustments(db: Database, period: Period) {
  return {
    periodStart: period.start,
    revision: await adjustmentRevision(db),
    rows: await readAdjustments(db, period),
  };
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
    preparedAdjustments?: Awaited<ReturnType<typeof preparePayPeriodAdjustments>>;
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
  const settings = await readPayPeriodSettings(tx);
  const expected = resolvePayPeriod(settings, input.period.start);
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
  let adjustments: PayPeriodAdjustment[] = [];
  if (settings.frequency === "monthly") {
    const prepared = input.preparedAdjustments;
    adjustments =
      prepared?.periodStart === input.period.start &&
      prepared.revision === (await adjustmentRevision(tx))
        ? prepared.rows
        : await readAdjustments(tx, input.period);
  }
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
    ...(adjustments.length === 0 ? {} : { adjustments }),
  };
  const people = [...new Set(snapshot.entries.map((e) => e.entry.personId))].sort();
  const { ruleset } = input;
  const dayMs = 86400000;
  const lastDay = new Date(Date.parse(input.period.end) - dayMs).toISOString().slice(0, 10);
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
        employment === undefined ||
        employment.startDate > input.period.start ||
        (employment.endDate !== null && employment.endDate < lastDay)
          ? null
          : summarisePeriod(
              record.sessions.filter((s) => s.personId === personId),
              input.period,
              {
                periodMinutes: Math.round(
                  (employment.contractedMinutesPerWeek *
                    (Date.parse(input.period.end) - Date.parse(input.period.start))) /
                    dayMs /
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
