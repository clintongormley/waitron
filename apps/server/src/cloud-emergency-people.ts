import { inArray, sql } from "drizzle-orm";
import type { Transaction } from "@waitron/db";
import { persons, listActivePersonsWithPermission } from "@waitron/identity";

export async function readEmergencyPeople(tx: Transaction) {
  const admitted = await listActivePersonsWithPermission(tx, "node.manage");
  const people = await tx
    .select({
      personId: persons.id,
      hasAuthenticator: sql<boolean>`${persons.totpSecret} is not null`.mapWith(Boolean),
    })
    .from(persons)
    .where(
      inArray(
        persons.id,
        admitted.map((p) => p.personId),
      ),
    );
  const presence = new Map(people.map((p) => [p.personId, p.hasAuthenticator]));
  return admitted.map((p) => ({ ...p, hasAuthenticator: presence.get(p.personId) === true }));
}
