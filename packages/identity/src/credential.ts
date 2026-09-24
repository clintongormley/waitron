import "./errors.js";
import { eq } from "drizzle-orm";
import type { Transaction } from "@waitron/db";
import { AppError } from "@waitron/shared";
import { persons } from "./schema/persons.js";
import { verifyPin } from "./verify-pin.js";
import type { PersonRoleValue } from "./permissions.js";

/**
 * Both `loginWithPin` and `authorize`'s OVERRIDE branch call this, so the guard ORDER and its error
 * codes are declared in exactly one place. Throws `person.not_found`, `person.suspended`,
 * `pin.invalid`.
 */
export async function verifyPersonCredential(
  tx: Transaction,
  personId: string,
  pin: string,
): Promise<{ role: PersonRoleValue; locale: string | null }> {
  const [person] = await tx
    .select({
      role: persons.role,
      status: persons.status,
      pinHash: persons.pinHash,
      locale: persons.locale,
    })
    .from(persons)
    .where(eq(persons.id, personId));
  if (person === undefined) throw new AppError("person.not_found", { personId });
  if (person.status === "suspended") throw new AppError("person.suspended", { personId });
  if (person.status === "pending" || person.pinHash === null || !verifyPin(pin, person.pinHash)) {
    throw new AppError("pin.invalid", {});
  }
  return { role: person.role as PersonRoleValue, locale: person.locale };
}
