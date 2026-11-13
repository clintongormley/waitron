import { ensureFixtureJobRole } from "@waitron/db/testing/seed.js";
import type { Database, Transaction } from "@waitron/db";
import { insertInChunks, personStaffRoles, persons } from "@waitron/db";
import { heldBuiltInKey, setBuiltInMembership } from "../src/roles.js";
import type { BuiltInRoleKey } from "../src/permissions.js";
export type PersonSeed = Omit<typeof persons.$inferInsert, "role"> & {
  role?: BuiltInRoleKey;
  jobRoles?: readonly string[];
};
export async function seedPersons(
  db: Database | Transaction,
  values: PersonSeed | readonly PersonSeed[],
): Promise<(typeof persons.$inferSelect)[]> {
  const seeds = [values].flat();
  const rows = await db
    .insert(persons)
    .values(seeds.map(({ role: _role, jobRoles: _jobs, ...person }) => person))
    .returning();
  for (const [index, row] of rows.entries())
    await setBuiltInMembership(db, row.id, seeds[index]!.role ?? "staff");
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
  await setBuiltInMembership(db, personId, role);
}
export async function builtInRoleForTest(
  db: Database | Transaction,
  personId: string,
): Promise<BuiltInRoleKey | null> {
  return heldBuiltInKey(db, personId);
}
