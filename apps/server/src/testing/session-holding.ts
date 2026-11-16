import { seedPersons } from "@waitron/identity/test/person-rows.js";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { personRoles, roles, withTransaction, type Database } from "@waitron/db";
import { startManagementSession } from "@waitron/identity";
import { MANAGEMENT_COOKIE } from "@waitron/server-kit";

/** A dashboard session for a new person whose one role is a custom role granting `permissions`. */
export function sessionHolding(
  db: Database,
  permissions: string[],
): Promise<{ cookie: string; personId: string }> {
  return withTransaction(db, async (tx) => {
    const name = `Only ${randomUUID()}`;
    const [person] = await seedPersons(tx, { displayName: name });
    await tx.delete(personRoles).where(eq(personRoles.personId, person!.id));
    const [role] = await tx
      .insert(roles)
      .values({ name, nameFolded: name.toLowerCase(), permissions })
      .returning({ id: roles.id });
    await tx.insert(personRoles).values({ personId: person!.id, roleId: role!.id });
    const session = await startManagementSession(tx, { personId: person!.id });
    return { cookie: `${MANAGEMENT_COOKIE}=${session.token}`, personId: person!.id };
  });
}
