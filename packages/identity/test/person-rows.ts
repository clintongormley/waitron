import { ensureFixtureJobRole } from "@waitron/db/testing/seed.js";
import type { Database, Transaction } from "@waitron/db";
import { insertInChunks, personStaffRoles, persons } from "@waitron/db";
import { eq } from "drizzle-orm";
import type { PersonRoleValue as BuiltInRoleKey } from "@waitron/shared";
export type PersonSeed = Omit<typeof persons.$inferInsert, "role"> & {
  role?: BuiltInRoleKey;
  jobRoles?: readonly string[];
};
export async function seedPersons(
  db: Database | Transaction,
  values: PersonSeed | readonly PersonSeed[],
): Promise<(typeof persons.$inferSelect)[]> {
  const seeds = [values].flat();
  const rows = await db.insert(persons).values(seeds).returning();
  const fixtureRole = seeds.some((seed) => seed.jobRoles === undefined)
    ? await ensureFixtureJobRole(db)
    : null;
  const memberships = rows.flatMap((person, index) =>
    (seeds[index]!.jobRoles ?? [fixtureRole!]).map((staffRoleId) => ({
      personId: person.id,
      staffRoleId,
    })),
  );
  if (memberships.length > 0) await insertInChunks(db, personStaffRoles, memberships);
  return rows;
}
export async function setBuiltInRoleForTest(
  db: Database | Transaction,
  personId: string,
  role: BuiltInRoleKey,
): Promise<void> {
  await db.update(persons).set({ role }).where(eq(persons.id, personId));
}
export async function builtInRoleForTest(
  db: Database | Transaction,
  personId: string,
): Promise<BuiltInRoleKey | null> {
  const [person] = await db
    .select({ role: persons.role })
    .from(persons)
    .where(eq(persons.id, personId));
  return person?.role ?? null;
}
