import { and, eq, isNotNull, sql } from "drizzle-orm";
import type { Transaction } from "@waitron/db";
import { persons, listActivePersonsWithPermission, type Permission } from "@waitron/identity";

export interface ManagerEmailRecipient {
  readonly personId: string;
  readonly email: string;
  readonly language: "en" | "es";
}

export async function readStaffEmailRecipients(
  tx: Transaction,
  venueLanguage: "en" | "es",
  permission: Permission,
  personId?: string,
): Promise<(ManagerEmailRecipient & { displayName: string })[]> {
  const admitted = new Map(
    (await listActivePersonsWithPermission(tx, permission)).map(({ personId, displayName }) => [
      personId,
      displayName,
    ]),
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
      displayName: admitted.get(person.id)!,
      email: person.email!.trim(),
      language:
        person.locale === "es-ES"
          ? ("es" as const)
          : person.locale === "en-GB"
            ? ("en" as const)
            : venueLanguage,
    }));
}

export async function readManagerEmailRecipients(
  tx: Transaction,
  venueLanguage: "en" | "es",
): Promise<ManagerEmailRecipient[]> {
  return (await readStaffEmailRecipients(tx, venueLanguage, "system.manage")).map(
    ({ personId, email, language }) => ({ personId, email, language }),
  );
}
export async function readManagerEmailRecipient(
  tx: Transaction,
  personId: string,
  venueLanguage: "en" | "es",
): Promise<ManagerEmailRecipient | undefined> {
  const [recipient] = await readStaffEmailRecipients(tx, venueLanguage, "system.manage", personId);
  if (!recipient) return undefined;
  const { email, language } = recipient;
  return { personId, email, language };
}
