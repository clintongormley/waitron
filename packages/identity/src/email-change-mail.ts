import { enqueueMail, MAIL_LIFETIME_MS, type Transaction } from "@waitron/db";

export async function queueEmailChangedNotice(
  tx: Transaction,
  input: {
    activityId: string;
    personId: string;
    actorId: string;
    oldEmail: string;
    editorName: string;
    at: Date;
  },
): Promise<void> {
  await enqueueMail(tx, {
    kind: "email_changed",
    dedupeKey: `email-changed:${input.activityId}`,
    subjectId: input.activityId,
    personId: input.personId,
    requestedBy: input.actorId,
    params: { oldEmail: input.oldEmail, editorName: input.editorName, at: input.at.toISOString() },
    now: input.at,
    notAfter: new Date(input.at.getTime() + MAIL_LIFETIME_MS.email_changed),
  });
}
