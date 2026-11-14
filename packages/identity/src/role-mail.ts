import { enqueueMail, MAIL_LIFETIME_MS, persons, type Transaction } from "@waitron/db";
import { eq } from "drizzle-orm";
import type { BuiltInRoleKey } from "./permissions.js";
export async function queueRoleMembershipMail(
  tx: Transaction,
  input: {
    activityId: string;
    personId: string;
    actorId: string | null;
    change: "added" | "removed";
    roleId: string;
    builtInKey: BuiltInRoleKey | null;
    roleName: string | null;
    editorName: string;
    at: Date;
  },
): Promise<void> {
  const [person] = await tx
    .select({ email: persons.email, status: persons.status })
    .from(persons)
    .where(eq(persons.id, input.personId));
  if (person?.email == null || person.status === "pending") return;
  await enqueueMail(tx, {
    kind: "role_membership_changed",
    dedupeKey: `role-membership:${input.activityId}`,
    subjectId: input.activityId,
    personId: input.personId,
    requestedBy: input.actorId,
    params: {
      change: input.change,
      builtInKey: input.builtInKey,
      roleName: input.roleName,
      editorName: input.editorName,
      at: input.at.toISOString(),
    },
    now: input.at,
    notAfter: new Date(input.at.getTime() + MAIL_LIFETIME_MS.role_membership_changed),
  });
}
