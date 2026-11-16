import { seedPersons, type PersonSeed } from "@waitron/identity/test/person-rows.js";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { personRoles, roles, withTransaction, type Database } from "@waitron/db";
import { startManagementSession } from "@waitron/identity";
import { MANAGEMENT_COOKIE } from "@waitron/server-kit";

/** Replaces every role `personId` holds with one custom role granting `permissions`. */
export function confineTo(db: Database, personId: string, permissions: string[]): Promise<void> {
  return withTransaction(db, async (tx) => {
    const name = `Only ${randomUUID()}`;
    await tx.delete(personRoles).where(eq(personRoles.personId, personId));
    const [role] = await tx
      .insert(roles)
      .values({ name, nameFolded: name.toLowerCase(), permissions })
      .returning({ id: roles.id });
    await tx.insert(personRoles).values({ personId, roleId: role!.id });
  });
}

/** A new person whose one role is a custom role granting `permissions`. */
export async function personHolding(
  db: Database,
  permissions: string[],
  seed: Partial<PersonSeed> = {},
): Promise<string> {
  const [person] = await withTransaction(db, (tx) =>
    seedPersons(tx, { displayName: `Only ${randomUUID()}`, ...seed }),
  );
  await confineTo(db, person!.id, permissions);
  return person!.id;
}

/** A dashboard session for a new person whose one role is a custom role granting `permissions`. */
export async function sessionHolding(
  db: Database,
  permissions: string[],
): Promise<{ cookie: string; personId: string }> {
  const personId = await personHolding(db, permissions);
  const session = await withTransaction(db, (tx) => startManagementSession(tx, { personId }));
  return { cookie: `${MANAGEMENT_COOKIE}=${session.token}`, personId };
}
