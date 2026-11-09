import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import type { Transaction } from "./client.js";
import { outgoingMail, type OutgoingMail, type OutgoingMailKind } from "./schema/outgoing-mail.js";

export const MAIL_LIFETIME_MS: Readonly<
  Record<Exclude<OutgoingMailKind, "account_action">, number>
> = {
  invoice: 604800000,
  attendance_question: 604800000,
  certificate_reminder: 604800000,
  box_alert: 86400000,
  role_membership_changed: 86400000,
};
export interface MailRequest {
  kind: OutgoingMailKind;
  dedupeKey: string;
  subjectId?: string | null;
  personId?: string | null;
  requestedBy?: string | null;
  params?: Record<string, string | number | boolean | null>;
  notAfter: Date;
  nextAttemptAt?: Date;
  now?: Date;
}
export async function enqueueMail(
  tx: Transaction,
  request: MailRequest,
): Promise<{ id: string; queued: boolean }> {
  const now = request.now ?? new Date();
  const [row] = await tx
    .insert(outgoingMail)
    .values({
      kind: request.kind,
      dedupeKey: request.dedupeKey,
      subjectId: request.subjectId,
      personId: request.personId,
      requestedBy: request.requestedBy,
      params: request.params,
      queuedAt: now.toISOString(),
      notAfter: request.notAfter.toISOString(),
      nextAttemptAt: (request.nextAttemptAt ?? now).toISOString(),
      seq: sql`(select coalesce(max(seq), 0) + 1 from outgoing_mail)`,
    })
    .onConflictDoNothing({ target: outgoingMail.dedupeKey })
    .returning({ id: outgoingMail.id });
  if (row !== undefined) return { ...row, queued: true };
  return { id: (await readMail(tx, request.dedupeKey))!.id, queued: false };
}
export async function cancelMail(
  tx: Transaction,
  dedupeKey: string,
  now = new Date(),
): Promise<boolean> {
  const rows = await tx
    .update(outgoingMail)
    .set({ status: "cancelled", finishedAt: now.toISOString() })
    .where(
      and(
        eq(outgoingMail.dedupeKey, dedupeKey),
        inArray(outgoingMail.status, ["pending", "rejected"]),
        isNull(outgoingMail.finishedAt),
      ),
    )
    .returning({ id: outgoingMail.id });
  return rows.length !== 0;
}
export async function readMail(
  tx: Transaction,
  dedupeKey: string,
): Promise<OutgoingMail | undefined> {
  return (await tx.select().from(outgoingMail).where(eq(outgoingMail.dedupeKey, dedupeKey)))[0];
}
