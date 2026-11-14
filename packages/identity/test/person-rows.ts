import { ensureFixtureJobRole } from "@waitron/db/testing/seed.js";
import type { Database, Transaction } from "@waitron/db";
import { insertInChunks, personStaffRoles, persons, personRoles, roles } from "@waitron/db";
import { ensureBuiltInRoles } from "../src/roles.js";
import { and, desc, eq, inArray, isNotNull } from "drizzle-orm";
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
    .values(
      seeds.map((seed) => {
        const person = { ...seed };
        delete person.role;
        delete person.jobRoles;
        return person;
      }),
    )
    .returning();
  for (const [index, row] of rows.entries())
    await setBuiltInRoleForTest(db, row.id, seeds[index]!.role ?? "staff");
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
  const builtIns = await ensureBuiltInRoles(db as Transaction);
  await db.delete(personRoles).where(and(eq(personRoles.personId, personId), inArray(personRoles.roleId, Object.values(builtIns))));
  await db.insert(personRoles).values({ personId, roleId: builtIns[role] });
}
export async function builtInRoleForTest(
  db: Database | Transaction,
  personId: string,
): Promise<BuiltInRoleKey | null> {
  const [row] = await db.select({ key: roles.builtInKey }).from(personRoles)
    .innerJoin(roles, eq(roles.id, personRoles.roleId))
    .where(and(eq(personRoles.personId, personId), isNotNull(roles.builtInKey)))
    .orderBy(desc(eq(roles.builtInKey, "admin")));
  return row?.key ?? null;
}
