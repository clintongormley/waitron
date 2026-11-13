import { and, eq, isNotNull, sql } from "drizzle-orm";
import type { Transaction } from "@waitron/db";
import { persons, listActivePersonsWithPermission } from "@waitron/identity";

export interface ManagerEmailRecipient {
  readonly personId: string;
  readonly email: string;
  readonly language: "en" | "es";
}

async function recipients(
  tx: Transaction,
  venueLanguage: "en" | "es",
  personId?: string,
): Promise<ManagerEmailRecipient[]> {
  const admitted = new Set(
    (await listActivePersonsWithPermission(tx, "system.manage")).map((person) => person.personId),
  );
  const people = await tx
    .select({
      id: persons.id,
      email: persons.email,
      locale: persons.locale,
    })
    .from(persons)
    .where(
      and(
        personId === undefined ? undefined : eq(persons.id, personId),
        eq(persons.status, "active"),
        isNotNull(persons.email),
        sql`length(trim(${persons.email})) > 0`,
      ),
    );
  return people
    .filter((person) => admitted.has(person.id))
    .map((person) => ({
      personId: person.id,
      email: person.email!.trim(),
      language:
        person.locale === "es-ES"
          ? ("es" as const)
          : person.locale === "en-GB"
            ? ("en" as const)
            : venueLanguage,
    }));
}

export function readManagerEmailRecipients(
  tx: Transaction,
  venueLanguage: "en" | "es",
): Promise<ManagerEmailRecipient[]> {
  return recipients(tx, venueLanguage);
}
export async function readManagerEmailRecipient(
  tx: Transaction,
  personId: string,
  venueLanguage: "en" | "es",
): Promise<ManagerEmailRecipient | undefined> {
  return (await recipients(tx, venueLanguage, personId))[0];
}
