import { and, eq, inArray, lte } from "drizzle-orm";
import { newId, type Transaction } from "@waitron/db";
import { attendanceMail } from "./schema/attendance.js";

type MailClaim = { id: string; token: string };
type MailOutcome = "sent" | "rejected" | "unknown";

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
        lte(attendanceMail.nextAttemptAt, input.now.toISOString()),
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
        lte(attendanceMail.claimedAt, new Date(now.getTime() - 60_000).toISOString()),
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
      ...(outcome === "rejected"
        ? { nextAttemptAt: new Date(now.getTime() + 15 * 60_000).toISOString() }
        : {}),
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
