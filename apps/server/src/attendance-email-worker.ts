import { and, asc, eq, inArray, isNotNull, isNull, lte, sql } from "drizzle-orm";
import { withTransaction, type Database } from "@waitron/db";
import { persons } from "@waitron/identity";
import {
  attendanceMail,
  attendanceQuestions,
  claimAttendanceMail,
  expireAttendanceMailClaims,
  reportAttendanceMail,
  retireObsoleteRotaQuestions,
  reconcileAttendanceResponses,
} from "@waitron/workforce";
import { reconcileAttendanceDay } from "./attendance-discovery.js";
import type { EmailDelivery } from "./email-delivery.js";
import type { AttendanceEmailSender, AttendanceMailOutcome } from "./attendance-email.js";
import { realSleep } from "./loop.js";

export type AttendanceEmailPassDeps = {
  db: Database;
  nodeId: string;
  locationId: string;
  holder: string;
  now: () => Date;
  isPrimary: () => boolean;
  signal: AbortSignal;
  venueLocale: "en" | "es";
  locationName: string;
  resolveDelivery: () => Promise<EmailDelivery>;
  send: AttendanceEmailSender;
};

export async function runAttendanceEmailLoop(
  deps: AttendanceEmailPassDeps & {
    onError: (error: unknown) => void;
    sleep?: (ms: number, signal: AbortSignal) => Promise<void>;
  },
): Promise<void> {
  const sleep = deps.sleep ?? realSleep;
  while (!deps.signal.aborted) {
    let processed = true;
    try {
      processed = (await runAttendanceEmailPass(deps)).processed;
    } catch (error) {
      deps.onError(error);
    }
    if (deps.signal.aborted) break;
    try {
      await sleep(processed ? 500 : 30_000, deps.signal);
    } catch (error) {
      deps.onError(error);
    }
  }
}

export async function runAttendanceEmailPass(
  deps: AttendanceEmailPassDeps,
): Promise<{ processed: boolean }> {
  const active = () => !deps.signal.aborted && deps.isPrimary();
  if (!active()) return { processed: false };
  const expired = await withTransaction(deps.db, async (tx) =>
    active() ? expireAttendanceMailClaims(tx, deps.now()) : 0,
  );
  if (!active()) return { processed: expired > 0 };
  const delivery = await deps.resolveDelivery();
  if (delivery.mode === "unconfigured" || !active()) return { processed: expired > 0 };
  // The claim must survive a crash during SMTP; its matching report is a separate write.
  const claimed = await withTransaction(deps.db, async (tx) => {
    if (!active()) return null;
    const now = deps.now();
    const eligible = and(
      eq(attendanceQuestions.locationId, deps.locationId),
      eq(attendanceQuestions.active, true),
      eq(attendanceQuestions.kind, "missing-times"),
      isNull(attendanceQuestions.resolvedByEntryId),
      isNull(attendanceQuestions.canonicalQuestionId),
      eq(persons.status, "active"),
      isNotNull(persons.email),
      sql`length(trim(${persons.email})) > 0`,
      inArray(attendanceMail.status, ["pending", "rejected"]),
      lte(attendanceMail.nextAttemptAt, now.toISOString()),
    );
    const candidates = () =>
      tx
        .select({ mail: attendanceMail, question: attendanceQuestions, person: persons })
        .from(attendanceMail)
        .innerJoin(attendanceQuestions, eq(attendanceQuestions.id, attendanceMail.questionId))
        .innerJoin(persons, eq(persons.id, attendanceQuestions.personId));
    const [candidate] = await candidates()
      .where(eligible)
      .orderBy(asc(attendanceMail.nextAttemptAt), asc(attendanceMail.id))
      .limit(1);
    if (!candidate) return null;
    await reconcileAttendanceResponses(tx, candidate.person.id);
    const day = {
      locationId: candidate.question.locationId,
      businessDay: candidate.question.businessDay,
      startAt: candidate.question.startAt,
      endAt: candidate.question.endAt,
    };
    await retireObsoleteRotaQuestions(tx, day);
    const latest = await reconcileAttendanceDay(
      tx,
      { nodeId: deps.nodeId, locationId: deps.locationId, personId: candidate.person.id, day },
      now,
    );
    const [current] = await candidates().where(
      and(eligible, eq(attendanceMail.id, candidate.mail.id)),
    );
    if (!current || !latest.questionIds.includes(current.question.id)) return null;
    const recipient = current.person.email!.trim();
    const claim = await claimAttendanceMail(tx, {
      id: current.mail.id,
      holder: deps.holder,
      recipient,
      now,
    });
    if (!claim) return null;
    return {
      claim,
      message: {
        smtp: delivery.smtp,
        recipient,
        locale:
          current.person.locale === "es-ES"
            ? ("es" as const)
            : current.person.locale === "en-GB"
              ? ("en" as const)
              : deps.venueLocale,
        businessDay: current.question.businessDay,
        locationName: deps.locationName,
        missingKinds:
          current.question.openEntryId === null ? current.question.missingKinds : ["out" as const],
      },
    };
  });
  if (!claimed) return { processed: expired > 0 };
  let outcome: AttendanceMailOutcome = "unknown";
  if (active()) {
    try {
      outcome = await deps.send(claimed.message);
    } catch {
      outcome = "unknown";
    }
  }
  await withTransaction(deps.db, (tx) =>
    reportAttendanceMail(tx, claimed.claim, outcome, deps.now()),
  );
  return { processed: true };
}
