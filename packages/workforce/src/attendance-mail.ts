import { and, eq, gt, inArray, lte, or, type SQL } from "drizzle-orm";
import { newId, type Transaction } from "@waitron/db";
import { attendanceMail } from "./schema/attendance.js";

type MailClaim = { id: string; token: string };
type MailOutcome = "sent" | "rejected" | "unknown";

const RETRY_MS = 15 * 60_000;
const CLAIM_MS = 60_000;

const at = (ms: number) => new Date(ms).toISOString();

/** Due at its retry time, or once that lies further ahead than the retry's wait: a time stamped
 * before the clock stepped back. */
export function attendanceMailDue(now: Date): SQL {
  return or(
    lte(attendanceMail.nextAttemptAt, now.toISOString()),
    gt(attendanceMail.nextAttemptAt, at(now.getTime() + RETRY_MS)),
  )!;
}

export async function cancelUnclaimedAttendanceMail(
  tx: Transaction,
  questionId: string,
): Promise<void> {
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

export async function claimAttendanceMail(
  tx: Transaction,
  input: { id: string; holder: string; recipient: string; now: Date },
): Promise<MailClaim | null> {
  const token = `${input.holder}:${newId()}`;
  const rows = await tx
    .update(attendanceMail)
    .set({
      status: "sending",
      claimToken: token,
      claimedAt: input.now.toISOString(),
      recipient: input.recipient,
      outcome: null,
    })
    .where(
      and(
        eq(attendanceMail.id, input.id),
        inArray(attendanceMail.status, ["pending", "rejected"]),
        attendanceMailDue(input.now),
      ),
    )
    .returning({ id: attendanceMail.id });
  return rows.length === 0 ? null : { id: input.id, token };
}

export async function expireAttendanceMailClaims(tx: Transaction, now: Date): Promise<number> {
  const rows = await tx
    .update(attendanceMail)
    .set({ status: "unknown", outcome: "unknown" })
    .where(
      and(
        eq(attendanceMail.status, "sending"),
        or(
          lte(attendanceMail.claimedAt, at(now.getTime() - CLAIM_MS)),
          gt(attendanceMail.claimedAt, at(now.getTime() + CLAIM_MS)),
        ),
      ),
    )
    .returning({ id: attendanceMail.id });
  return rows.length;
}

export async function reportAttendanceMail(
  tx: Transaction,
  claim: MailClaim,
  outcome: MailOutcome,
  now: Date,
): Promise<boolean> {
  const rows = await tx
    .update(attendanceMail)
    .set({
      status: outcome,
      outcome,
      ...(outcome === "rejected" ? { nextAttemptAt: at(now.getTime() + RETRY_MS) } : {}),
    })
    .where(
      and(
        eq(attendanceMail.id, claim.id),
        eq(attendanceMail.status, "sending"),
        eq(attendanceMail.claimToken, claim.token),
      ),
    )
    .returning({ id: attendanceMail.id });
  return rows.length > 0;
}
