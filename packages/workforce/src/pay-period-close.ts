import { and, desc, eq } from "drizzle-orm";
import { newId, type Database, type Transaction } from "@waitron/db";
import {
  AppError,
  businessDayBoundaryAt,
  SOURCES,
  type BusinessDayClock,
  type JobOrigin,
  type Origin,
} from "@waitron/shared";
import { appendToChain } from "./chain.js";
import { computeClosureHash } from "./pay-period-chain.js";
import { readClosures } from "./pay-period-reads.js";
import { invalidPeriod, readPayPeriodSettings, resolvePayPeriod } from "./pay-periods.js";
import { isRecordDate } from "./record-dates.js";
import { recordInPeriod } from "./record-period.js";
import { projectTimeRecord } from "./record-projection.js";
import { readRecordedEntries } from "./record-reads.js";
import { automaticEntryIdsWithoutMarker } from "./effective-entries.js";
import {
  dailyContractedTargetMinutes,
  summarisePeriod,
  type Period,
  type TimeEntryRecord,
} from "./projection.js";
import type { PayPeriodClosure } from "./record-types.js";
import type { WorkSummaryRuleset } from "./clocking.js";
import { payPeriodClosures } from "./schema/pay-period-closures.js";
import { employments } from "./schema/employments.js";

export async function appendClosureMarker(
  tx: Transaction,
  nodeId: string,
  target: TimeEntryRecord,
  closureId: string,
  origin: JobOrigin,
): Promise<void> {
  await appendToChain(
    tx,
    { nodeId, locationId: target.locationId },
    {
      personId: target.personId,
      entryKind: "confirmation",
      eventAt: target.eventAt,
      eventOffsetMinutes: target.offsetMinutes,
      recordedByPersonId: null,
      origin,
      extension: {
        authorKind: "automatic",
        direction: null,
        missingEntryKind: null,
        respondsToEntryId: target.entryId,
        payPeriodClosureId: closureId,
      },
    },
  );
}
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
  input: { locationId: string; period: Period },
): Promise<PayPeriodClosure[]> {
  validatePeriod(input.period);
  if (typeof input.locationId !== "string" || !input.locationId) invalidPeriod("location");
  return readClosures(tx, input);
}
export async function closePayPeriod(
  tx: Transaction,
  input: {
    nodeId: string;
    locationId: string;
    period: Period;
    clock: BusinessDayClock;
    now: string;
    ruleset: WorkSummaryRuleset;
    origin: JobOrigin;
  },
): Promise<PayPeriodClosure> {
  validatePeriod(input.period);
  const existing = await readClosures(tx, input);
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
  const scheduledCloseAt = businessDayBoundaryAt(input.clock, input.period.end);
  if (closedAt < scheduledCloseAt)
    throw new AppError("pay_period.not_due", { closeAt: scheduledCloseAt });
  const entries = await readRecordedEntries(tx, { locationId: input.locationId });
  const closureId = newId();
  const unmarked = automaticEntryIdsWithoutMarker(entries);
  const candidates = entries.filter((e) => unmarked.has(e.entryId));
  const virtual = candidates.map((e) => ({
    ...e,
    entryId: `count:${e.entryId}`,
    entryKind: "confirmation" as const,
    extension: {
      authorKind: "automatic" as const,
      direction: null,
      missingEntryKind: null,
      respondsToEntryId: e.entryId,
      payPeriodClosureId: closureId,
    },
  }));
  const counted = recordInPeriod(projectTimeRecord([...entries, ...virtual]), input.period);
  const eligible = candidates.filter((e) =>
    counted.sessions.some(
      (s) => s.personId === e.personId && s.locationId === e.locationId && s.endedAt === e.eventAt,
    ),
  );
  const eligibleIds = new Set(eligible.map((e) => e.entryId));
  const markers = virtual.filter((e) => eligibleIds.has(e.extension.respondsToEntryId));
  const record = recordInPeriod(projectTimeRecord([...entries, ...markers]), input.period);
  const markerIds = new Set(markers.map((e) => e.entryId));
  const snapshot: PayPeriodClosure["snapshot"] = {
    sessions: record.sessions,
    entries: record.entries.filter((e) => !markerIds.has(e.entry.entryId)),
    summaries: [],
    markedAutomaticEntryIds: eligible.map((e) => e.entryId).sort(),
  };
  const people = [...new Set(snapshot.entries.map((e) => e.entry.personId))].sort();
  for (const personId of people) {
    const [employment] = await tx
      .select()
      .from(employments)
      .where(eq(employments.personId, personId))
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
                  input.ruleset.dailyTargetMinutes ??
                  dailyContractedTargetMinutes(
                    employment.contractedMinutesPerWeek,
                    input.ruleset.workingDaysPerWeek,
                  ),
              },
              input.ruleset.overtimeModel,
            ),
    });
  }
  const [previous] = await tx
    .select()
    .from(payPeriodClosures)
    .where(
      and(
        eq(payPeriodClosures.nodeId, input.nodeId),
        eq(payPeriodClosures.locationId, input.locationId),
      ),
    )
    .orderBy(desc(payPeriodClosures.sequenceNo))
    .limit(1);
  const value: Omit<PayPeriodClosure, "closureHash"> = {
    id: closureId,
    nodeId: input.nodeId,
    locationId: input.locationId,
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
  for (const entry of eligible)
    await appendClosureMarker(tx, input.nodeId, entry, closureId, input.origin);
  return closure;
}
