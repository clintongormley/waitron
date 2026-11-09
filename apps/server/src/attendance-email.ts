import { eq } from "drizzle-orm";
import { MAIL_LIFETIME_MS, readMail, readVenue, type Transaction } from "@waitron/db";
import { persons } from "@waitron/identity";
import {
  attendanceQuestions,
  reconcileAttendanceResponses,
  retireObsoleteRotaQuestions,
} from "@waitron/workforce";
import { reconcileAttendanceDay } from "./attendance-discovery.js";
import { ATTENDANCE_EMAIL_WORDS } from "./i18n/attendance-email.js";
import type { MailKindOwner, MailMessage } from "./mail-sender.js";

export interface AttendanceReminder {
  locale: "en" | "es";
  businessDay: string;
  venueName: string;
  missingKinds: readonly ("in" | "out")[];
}
export function attendanceReminderMessage({
  locale,
  businessDay,
  venueName,
  missingKinds,
}: AttendanceReminder): MailMessage {
  const copy = locale === "es" ? ATTENDANCE_EMAIL_WORDS.es : ATTENDANCE_EMAIL_WORDS.en;
  const missing =
    missingKinds.length === 2
      ? copy.missingBoth
      : missingKinds[0] === "in"
        ? copy.missingIn
        : copy.missingOut;
  return { subject: copy.subject(businessDay), text: copy.text(businessDay, venueName, missing) };
}
export const ATTENDANCE_RETRY_MS = 15 * 60_000;
export function attendanceReminderMail(deps: {
  nodeId: string;
  venueLanguage: "en" | "es";
}): MailKindOwner<AttendanceReminder> {
  async function readQuestion(tx: Transaction, id: string | null) {
    if (id === null) return undefined;
    return (
      await tx
        .select({ question: attendanceQuestions, person: persons })
        .from(attendanceQuestions)
        .innerJoin(persons, eq(persons.id, attendanceQuestions.personId))
        .where(eq(attendanceQuestions.id, id))
    )[0];
  }
  const eligible = ({ question, person }: NonNullable<Awaited<ReturnType<typeof readQuestion>>>) =>
    question.active &&
    question.kind === "missing-times" &&
    question.resolvedByEntryId === null &&
    question.canonicalQuestionId === null &&
    person.status === "active" &&
    !!person.email?.trim();
  return {
    kind: "attendance_question",
    deliveryRule: "notice",
    retryDelaysMs: Array.from(
      { length: MAIL_LIFETIME_MS.attendance_question / ATTENDANCE_RETRY_MS },
      () => ATTENDANCE_RETRY_MS,
    ),
    longestWaitMs: ATTENDANCE_RETRY_MS,
    async claim(tx, mail, now) {
      const candidate = await readQuestion(tx, mail.subjectId);
      if (!candidate) return null;
      const later = { later: new Date(now.getTime() + ATTENDANCE_RETRY_MS) };
      if (!eligible(candidate)) return later;
      await reconcileAttendanceResponses(tx, candidate.person.id);
      const day = {
        businessDay: candidate.question.businessDay,
        startAt: candidate.question.startAt,
        endAt: candidate.question.endAt,
      };
      await retireObsoleteRotaQuestions(tx, day);
      const latest = await reconcileAttendanceDay(
        tx,
        { nodeId: deps.nodeId, personId: candidate.person.id, day },
        now,
      );
      if ((await readMail(tx, mail.dedupeKey))?.status === "cancelled") return null;
      const current = await readQuestion(tx, mail.subjectId);
      if (!current || !eligible(current) || !latest.questionIds.includes(current.question.id))
        return later;
      return {
        recipient: current.person.email!.trim(),
        prepared: {
          locale:
            current.person.locale === "es-ES"
              ? "es"
              : current.person.locale === "en-GB"
                ? "en"
                : deps.venueLanguage,
          businessDay: current.question.businessDay,
          venueName: (await readVenue(tx)).name,
          missingKinds:
            current.question.openEntryId === null ? current.question.missingKinds : ["out"],
        },
      };
    },
    async compose(prepared) {
      return attendanceReminderMessage(prepared);
    },
    async settle() {},
  };
}
