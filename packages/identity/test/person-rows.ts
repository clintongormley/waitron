import type { Database, Transaction } from "@waitron/db";
import { persons } from "@waitron/db";
import { eq } from "drizzle-orm";
import type { PersonRoleValue as BuiltInRoleKey } from "@waitron/shared";
export type PersonSeed = Omit<typeof persons.$inferInsert, "role"> & { role?: BuiltInRoleKey };
export async function seedPersons(
  db: Database | Transaction,
  values: PersonSeed | readonly PersonSeed[],
): Promise<(typeof persons.$inferSelect)[]> {
  return db
    .insert(persons)
    .values(Array.isArray(values) ? values : [values as PersonSeed])
    .returning();
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
