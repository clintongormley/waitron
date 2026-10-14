import { and, eq, gte, inArray, lt, sql } from "drizzle-orm";
import type { Transaction } from "@waitron/db";
import { AppError, jobOrigin } from "@waitron/shared";
import type {
  AttendanceDayInput,
  AttendanceDayResult,
  AttendanceFact,
  AttendanceQuestion,
} from "./attendance-types.js";
import { assertAttendanceDay } from "./attendance-state.js";
import { mergeAttendanceQuestions, upsertAttendanceQuestion } from "./attendance-questions.js";
import { attendanceDayWork, attendanceMail, attendanceQuestions } from "./schema/attendance.js";
import { timeEntries } from "./schema/time-entries.js";
import { WorkforceBackend } from "./clocking.js";
import { readRecordedEntries } from "./record-reads.js";
import { recordInstant } from "./corrections.js";
import {
  compareEvents,
  effectiveClockEntries,
  liveClockEntries,
  originalEntry,
} from "./effective-entries.js";
import type { TimeEntryRecord } from "./projection.js";
import "./errors.js";

type Interval = {
  start: TimeEntryRecord;
  effectiveStart: TimeEntryRecord;
  next?: TimeEntryRecord;
  effectiveEnd?: TimeEntryRecord;
};
const invalid = (reason: string) => new AppError("attendance.invalid", { reason });
const evidence = (facts: readonly AttendanceFact[]) => facts.map((f) => `${f.source}:${f.key}`);
const instant = (at: string) => Date.parse(at);

function intervalsFor(entries: readonly TimeEntryRecord[]): Interval[] {
  const live = liveClockEntries(entries).sort(compareEvents);
  const byId = new Map(entries.map((e) => [e.entryId, e]));
  const effective = new Map(
    effectiveClockEntries(entries).map((e) => [originalEntry(e, byId).entryId, e]),
  );
  return live
    .filter((e) => e.entryKind === "in")
    .map((start) => {
      const next = live
        .slice(live.indexOf(start) + 1)
        .find((e) => e.entryKind === "in" || e.entryKind === "out");
      return {
        start,
        effectiveStart: effective.get(start.entryId)!,
        next,
        effectiveEnd: next === undefined ? undefined : effective.get(next.entryId),
      };
    });
}

async function cancelReminder(tx: Transaction, questionId: string): Promise<void> {
  await tx
    .update(attendanceMail)
    .set({ status: "cancelled" })
    .where(
      and(
        eq(attendanceMail.questionId, questionId),
        inArray(attendanceMail.status, ["pending", "rejected"]),
      ),
    );
}

async function retainQuestion(
  tx: Transaction,
  input: Omit<AttendanceQuestion, "id" | "createdAt">,
  at: Date,
): Promise<string> {
  const [old] = await tx
    .select()
    .from(attendanceQuestions)
    .where(
      and(
        eq(attendanceQuestions.personId, input.personId),
        eq(attendanceQuestions.locationId, input.day.locationId),
        eq(attendanceQuestions.shiftKey, input.shiftKey),
      ),
    );
  if (old?.inactiveReason === "rota_superseded" && old.resolvedByEntryId === null) {
    await tx
      .update(attendanceQuestions)
      .set({ active: true, inactiveReason: null })
      .where(eq(attendanceQuestions.id, old.id));
    // A cancelled, never-claimed reminder can follow a restored obligation; attempted delivery cannot.
    await tx
      .update(attendanceMail)
      .set({ status: "pending", nextAttemptAt: at.toISOString() })
      .where(
        and(
          eq(attendanceMail.questionId, old.id),
          eq(attendanceMail.status, "cancelled"),
          sql`${attendanceMail.claimToken} is null`,
        ),
      );
  }
  return upsertAttendanceQuestion(tx, input, at);
}

export async function processAttendanceDay(
  tx: Transaction,
  input: AttendanceDayInput,
): Promise<AttendanceDayResult> {
  const { day, nodeId, now } = input;
  assertAttendanceDay(day);
  const startAt = new Date(day.startAt).toISOString(),
    endAt = new Date(day.endAt).toISOString();
  if (!nodeId || !Number.isFinite(now.getTime()) || now.getTime() < instant(endAt))
    throw invalid("attendance day not due");
  const [work] = await tx
    .select()
    .from(attendanceDayWork)
    .where(
      and(
        eq(attendanceDayWork.locationId, day.locationId),
        eq(attendanceDayWork.businessDay, day.businessDay),
      ),
    );
  if (!work || work.startAt !== startAt || work.endAt !== endAt)
    throw invalid("saved attendance day mismatch");
  const facts = input.facts
    .filter((f) => f.locationId === day.locationId)
    .map((f) => ({
      ...f,
      at: recordInstant(f.at, f.offsetMinutes, "attendance"),
    }))
    .filter((f) => f.at >= startAt && f.at < endAt);
  const planned = input.planned
    .filter(
      (p) =>
        p.locationId === day.locationId &&
        instant(p.startsAt) >= instant(startAt) &&
        instant(p.startsAt) < instant(endAt),
    )
    .sort(
      (a, b) =>
        instant(a.startsAt) - instant(b.startsAt) ||
        instant(a.endsAt) - instant(b.endsAt) ||
        a.id.localeCompare(b.id),
    );
  const subjects = await tx
    .selectDistinct({ personId: timeEntries.personId })
    .from(timeEntries)
    .where(
      and(
        eq(timeEntries.locationId, day.locationId),
        gte(timeEntries.eventAt, startAt),
        lt(timeEntries.eventAt, endAt),
      ),
    );
  const people =
    input.personId === undefined
      ? [
          ...new Set([
            ...subjects.map((s) => s.personId),
            ...facts.map((f) => f.personId),
            ...planned.map((p) => p.personId),
          ]),
        ].sort()
      : [input.personId];
  const result: AttendanceDayResult = { automaticEntryIds: [], questionIds: [] };
  const deferred: { id: string; at: string }[] = [];
  const backend = new WorkforceBackend();
  const mergeResult = async (canonical: string, duplicate: string) => {
    if (canonical === duplicate) return;
    await mergeAttendanceQuestions(tx, canonical, duplicate);
    result.questionIds = [
      ...new Set(result.questionIds.map((id) => (id === duplicate ? canonical : id))),
    ];
  };
  const addQuestion = async (
    personId: string,
    shiftKey: string,
    ownFacts: readonly AttendanceFact[],
    openEntryId: string | null = null,
    automaticEntryId: string | null = null,
  ) => {
    const prior = await tx
      .select()
      .from(attendanceQuestions)
      .where(
        and(
          eq(attendanceQuestions.personId, personId),
          eq(attendanceQuestions.locationId, day.locationId),
          eq(attendanceQuestions.businessDay, day.businessDay),
          sql`${attendanceQuestions.resolvedByEntryId} is null`,
        ),
      );
    const keys = new Set(evidence(ownFacts));
    const retired = prior.filter(
      (q) => q.inactiveReason === "rota_superseded" && q.evidenceKeys.some((key) => keys.has(key)),
    );
    let id = await retainQuestion(
      tx,
      {
        personId,
        day,
        shiftKey,
        kind: automaticEntryId === null ? "missing-times" : "automatic-out",
        missingKinds:
          automaticEntryId !== null ? [] : openEntryId === null ? ["in", "out"] : ["out"],
        openEntryId,
        automaticEntryId,
        evidenceKeys: [...new Set([...keys, ...retired.flatMap((q) => q.evidenceKeys)])],
      },
      now,
    );
    const related = prior.filter(
      (q) =>
        q.active &&
        q.id !== id &&
        q.openEntryId === null &&
        q.shiftKey.startsWith("activity:") &&
        q.evidenceKeys.some((key) => keys.has(key)),
    );
    for (const q of related) {
      await mergeResult(q.id, id);
      id = q.id;
    }
    for (const q of retired) {
      const [attempted] = await tx
        .select({ id: attendanceMail.id })
        .from(attendanceMail)
        .where(
          and(
            eq(attendanceMail.questionId, q.id),
            inArray(attendanceMail.status, ["sending", "sent", "unknown"]),
          ),
        );
      if (attempted) await cancelReminder(tx, id);
    }
    if (!result.questionIds.includes(id)) result.questionIds.push(id);
    return id;
  };
  for (const personId of people) {
    const entries = await readRecordedEntries(tx, { personId });
    const live = liveClockEntries(entries).sort(compareEvents);
    const effective = effectiveClockEntries(entries)
      .filter((e) => e.locationId === day.locationId)
      .sort(compareEvents);
    const intervals = intervalsFor(entries).filter((i) => i.start.locationId === day.locationId);
    const ownFacts = facts.filter((f) => f.personId === personId);
    const covered = new Set<AttendanceFact>();
    const matched = new Set<Interval>();
    for (const interval of intervals) {
      const { start, next } = interval;
      const automatic = next?.entryKind === "out" && next.extension?.authorKind === "automatic";
      // Later evidence can extend this day's question, but later days remain separate gaps.
      const limit =
        automatic && start.eventAt >= startAt && start.eventAt < endAt
          ? (intervals.find((i) => compareEvents(i.start, next) > 0)?.start.eventAt ?? endAt)
          : (next?.eventAt ?? endAt);
      const intervalFacts = ownFacts.filter(
        (f) => instant(f.at) >= instant(start.eventAt) && instant(f.at) < instant(limit),
      );
      for (const f of intervalFacts) covered.add(f);
      if (start.eventAt < startAt || start.eventAt >= endAt) continue;
      const key = `in:${start.entryId}`;
      if (next?.entryKind === "out" && !automatic) {
        const existing = await tx
          .select()
          .from(attendanceQuestions)
          .where(
            and(
              eq(attendanceQuestions.personId, personId),
              eq(attendanceQuestions.locationId, day.locationId),
              eq(attendanceQuestions.businessDay, day.businessDay),
              eq(attendanceQuestions.active, true),
              eq(attendanceQuestions.kind, "missing-times"),
              sql`${attendanceQuestions.resolvedByEntryId} is null`,
            ),
          );
        const keys = new Set(evidence(intervalFacts));
        for (const q of existing.filter(
          (q) =>
            q.openEntryId === start.entryId ||
            (q.shiftKey.startsWith("activity:") &&
              q.evidenceKeys.length > 0 &&
              q.evidenceKeys.every((k) => keys.has(k))),
        )) {
          await tx
            .update(attendanceQuestions)
            .set({ resolvedByEntryId: next.entryId })
            .where(eq(attendanceQuestions.id, q.id));
          await cancelReminder(tx, q.id);
        }
        continue;
      }
      const breaks: AttendanceFact[] = live
        .filter(
          (e) =>
            e.locationId === day.locationId &&
            (e.entryKind === "break_start" || e.entryKind === "break_end") &&
            compareEvents(e, start) > 0 &&
            e.eventAt < endAt &&
            (next === undefined || compareEvents(e, next) < 0),
        )
        .map((e) => ({
          source: "clock",
          kind: "break",
          key: e.entryId,
          personId,
          locationId: day.locationId,
          at: e.eventAt,
          offsetMinutes: e.offsetMinutes,
        }));
      const eligible = [...intervalFacts, ...breaks];
      if (automatic) {
        await addQuestion(personId, key, eligible, start.entryId, next.entryId);
        continue;
      }
      const last = eligible
        .filter((f) => f.at > start.eventAt)
        .sort(
          (a, b) =>
            instant(a.at) - instant(b.at) ||
            a.source.localeCompare(b.source) ||
            a.key.localeCompare(b.key),
        )
        .at(-1);
      const effectiveLatest = effective.at(-1),
        liveLatest = live.at(-1);
      // Historical conflicts stay questions: the existing writer admits only the current live interval.
      const canClose =
        next === undefined &&
        last !== undefined &&
        effectiveLatest !== undefined &&
        liveLatest !== undefined &&
        last.at > interval.effectiveStart.eventAt &&
        (effectiveLatest.entryKind === "in"
          ? last.at > effectiveLatest.eventAt
          : last.at >= effectiveLatest.eventAt) &&
        last.at >= liveLatest.eventAt &&
        liveLatest.locationId === day.locationId;
      let end: string | null = null;
      if (canClose) {
        end = await backend.recordAutomaticClose(tx, {
          nodeId,
          personId,
          locationId: day.locationId,
          openEntryId: start.entryId,
          at: last.at,
          offsetMinutes: last.offsetMinutes,
          origin: jobOrigin("dashboard"),
        });
        result.automaticEntryIds.push(end);
      }
      await addQuestion(personId, key, eligible, start.entryId, end);
    }
    for (const p of planned.filter((p) => p.personId === personId)) {
      const match = intervals
        .filter(
          (i) =>
            !matched.has(i) &&
            instant(i.effectiveStart.eventAt) < instant(p.endsAt) &&
            instant(i.effectiveEnd?.eventAt ?? endAt) > instant(p.startsAt),
        )
        .sort((a, b) => compareEvents(a.effectiveStart, b.effectiveStart))[0];
      if (match) {
        matched.add(match);
        const [rotaQuestion] = await tx
          .select()
          .from(attendanceQuestions)
          .where(
            and(
              eq(attendanceQuestions.personId, personId),
              eq(attendanceQuestions.locationId, day.locationId),
              eq(attendanceQuestions.shiftKey, `rota:${p.id}`),
              eq(attendanceQuestions.active, true),
              sql`${attendanceQuestions.resolvedByEntryId} is null`,
            ),
          );
        if (rotaQuestion) {
          const [clockQuestion] = await tx
            .select()
            .from(attendanceQuestions)
            .where(
              and(
                eq(attendanceQuestions.personId, personId),
                eq(attendanceQuestions.locationId, day.locationId),
                eq(attendanceQuestions.shiftKey, `in:${match.start.entryId}`),
              ),
            );
          if (clockQuestion)
            await mergeResult(
              rotaQuestion.id,
              clockQuestion.canonicalQuestionId ?? clockQuestion.id,
            );
          else if (match.next?.entryKind === "out") {
            await tx
              .update(attendanceQuestions)
              .set({ resolvedByEntryId: match.next.entryId })
              .where(eq(attendanceQuestions.id, rotaQuestion.id));
            await cancelReminder(tx, rotaQuestion.id);
          }
        }
        continue;
      }
      const rotaFacts = ownFacts.filter(
        (f) =>
          !covered.has(f) &&
          instant(f.at) >= instant(p.startsAt) &&
          instant(f.at) < instant(p.endsAt),
      );
      for (const f of rotaFacts) covered.add(f);
      if (now.getTime() < instant(p.endsAt)) {
        deferred.push({ id: p.id, at: new Date(p.endsAt).toISOString() });
        continue;
      }
      await addQuestion(personId, `rota:${p.id}`, rotaFacts);
    }
    const gaps = new Map<string, AttendanceFact[]>();
    for (const f of ownFacts.filter((f) => !covered.has(f))) {
      const preceding = intervals
        .filter((i) => i.next !== undefined && instant(i.next.eventAt) <= instant(f.at))
        .sort((a, b) => compareEvents(a.next!, b.next!))
        .at(-1);
      const key = `activity:${day.businessDay}:after:${preceding?.next?.entryId ?? "start"}`;
      const group = gaps.get(key) ?? [];
      group.push(f);
      gaps.set(key, group);
    }
    for (const [key, gapFacts] of gaps) await addQuestion(personId, key, gapFacts);
  }
  if (input.personId === undefined)
    await tx
      .update(attendanceDayWork)
      .set({
        evaluatedRevision: work.dirtyRevision,
        deferredShiftIds: deferred.map((d) => d.id).sort(),
        nextDueAt: deferred.map((d) => d.at).sort()[0] ?? endAt,
      })
      .where(eq(attendanceDayWork.id, work.id));
  return result;
}
