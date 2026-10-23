import { and, eq, isNotNull, sql } from "drizzle-orm";
import type { Transaction } from "@waitron/db";
import { persons, roleHasPermission } from "@waitron/identity";

export interface ManagerEmailRecipient {
  readonly personId: string;
  readonly email: string;
  readonly language: "en" | "es";
}

/** Every active person with an email address whose role holds `system.manage`: the address trimmed,
 * the language their own (`es-ES`, `en-GB`), else the venue's. */
export async function readManagerEmailRecipients(
  tx: Transaction,
  venueLanguage: "en" | "es",
): Promise<ManagerEmailRecipient[]> {
  const people = await tx
    .select({
      id: persons.id,
      email: persons.email,
      locale: persons.locale,
      role: persons.role,
    })
    .from(persons)
    .where(
      and(
        eq(persons.status, "active"),
        isNotNull(persons.email),
        sql`length(trim(${persons.email})) > 0`,
      ),
    );
  return people
    .filter((person) => roleHasPermission(person.role, "system.manage"))
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
