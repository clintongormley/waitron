import { and, eq, isNotNull, sql } from "drizzle-orm";
import type { Transaction } from "@waitron/db";
import { persons, holds, readPersonAuthority } from "@waitron/identity";

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
  const admitted = [];
  for (const person of people) {
    if (holds(await readPersonAuthority(tx, person.id), "system.manage")) admitted.push(person);
  }
  return admitted.map((person) => ({
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
