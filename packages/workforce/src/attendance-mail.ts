import {
  cancelMail,
  enqueueMail,
  MAIL_LIFETIME_MS,
  readMail,
  reopenMail,
  type OutgoingMail,
  type Transaction,
} from "@waitron/db";

export const attendanceMailKey = (questionId: string) => `attendance:${questionId}`;
export async function queueAttendanceReminder(
  tx: Transaction,
  question: { id: string; personId: string },
  at: Date,
): Promise<void> {
  await enqueueMail(tx, {
    kind: "attendance_question",
    dedupeKey: attendanceMailKey(question.id),
    subjectId: question.id,
    personId: question.personId,
    now: at,
    notAfter: new Date(at.getTime() + MAIL_LIFETIME_MS.attendance_question),
  });
}
export async function cancelUnclaimedAttendanceMail(
  tx: Transaction,
  questionId: string,
): Promise<void> {
  await cancelMail(tx, attendanceMailKey(questionId));
}
export async function reopenAttendanceMail(
  tx: Transaction,
  questionId: string,
  at: Date,
): Promise<void> {
  await reopenMail(tx, attendanceMailKey(questionId), {
    nextAttemptAt: at,
    notAfter: new Date(at.getTime() + MAIL_LIFETIME_MS.attendance_question),
  });
}
export async function attendanceMailAttempted(
  tx: Transaction,
  questionId: string,
): Promise<boolean> {
  const mail = await readMail(tx, attendanceMailKey(questionId));
  return mail !== undefined && ["sending", "sent", "unknown"].includes(mail.status);
}
export function attendanceMailOutcome(
  row: Pick<OutgoingMail, "status" | "attempts">,
): "sent" | "rejected" | "unknown" | null {
  if (row.status === "sent" || row.status === "unknown" || row.status === "rejected")
    return row.status;
  return (row.status === "cancelled" || row.status === "expired") && row.attempts > 0
    ? "rejected"
    : null;
}
